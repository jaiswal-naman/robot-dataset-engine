# AutoEgoLab v3.0 — End-to-End Execution Flow
**Document owner:** AI Systems Engineering  
**Revision:** 2.0 | **Date:** 2026-03-16 | **Status:** Build-Ready

---

## 4.1 Job State Machine (FSM)

Every job progresses through a strictly ordered set of terminal and in-progress states. The `processing_jobs.status` column is the single authoritative state store; UI, metrics, and alerts are derived entirely from it.

### State Sequence (Happy Path)
```
UPLOADED
  │ (user triggers POST /api/process)
QUEUED
  │ (Modal webhook received, pipeline starts)
VIDEO_AGENT_RUNNING
  │ (Video Agent succeeds)
QUALITY_AGENT_RUNNING
  │ (Quality Agent succeeds)
PERCEPTION_AGENT_RUNNING
  │ (all 3 Perception sub-branches complete)
SEGMENTATION_AGENT_RUNNING
  │ (Segmentation Agent succeeds)
ACTION_AGENT_RUNNING
  │ (Action Agent succeeds)
TASK_GRAPH_AGENT_RUNNING
  │ (Task Graph Agent succeeds)
DATASET_BUILDER_RUNNING
  │ (Dataset Builder succeeds)
COMPLETED
```

### Terminal Failure States
Each agent has a typed failure state. This is critical for debugging — you can see exactly *which* agent failed without reading logs.

```
FAILED_VALIDATION           ← file rejected before any processing
FAILED_VIDEO_AGENT          ← corrupt video / bad codec
FAILED_QUALITY_AGENT        ← zero clean frames after filtering
FAILED_PERCEPTION_AGENT     ← all perception branches failed
FAILED_SEGMENTATION_AGENT   ← (rare, fallback segment always provided)
FAILED_ACTION_AGENT         ← >50% of segments unresolvable
FAILED_TASK_GRAPH_AGENT     ← Gemini exhausted + template fallback failed
FAILED_DATASET_BUILDER      ← no valid export produced
FAILED_ORCHESTRATOR         ← heartbeat timeout / unexpected crash
CANCELLED                   ← user-initiated or admin cancellation
EXPIRED                     ← job not triggered within TTL window
```

### Progress Percent Mapping (for UI progress bar)
```python
STATUS_TO_PROGRESS = {
    "UPLOADED":                  0,
    "QUEUED":                    2,
    "VIDEO_AGENT_RUNNING":      10,
    "QUALITY_AGENT_RUNNING":    22,
    "PERCEPTION_AGENT_RUNNING": 35,
    "SEGMENTATION_AGENT_RUNNING": 62,
    "ACTION_AGENT_RUNNING":     72,
    "TASK_GRAPH_AGENT_RUNNING": 86,
    "DATASET_BUILDER_RUNNING":  94,
    "COMPLETED":               100,
}
```

---

## 4.2 Step-by-Step Lifecycle — Every Action Explained

### Step 1: User Selects Video File

**Location:** Browser on `/demo` page  
**File:** `app/demo/page.tsx` → `components/demo/UploadZone.tsx`

The UploadZone component uses `react-dropzone` to accept drag-and-drop or click-to-browse MP4 files. Before any network call, the component performs client-side pre-validation:

```typescript
// components/demo/UploadZone.tsx
function validateFile(file: File): ValidationError | null {
  if (!file.name.endsWith('.mp4') && file.type !== 'video/mp4') {
    return { code: 'INVALID_FORMAT', message: 'Only .mp4 files accepted' };
  }
  if (file.size > 300 * 1024 * 1024) {  // 300MB
    return { code: 'FILE_TOO_LARGE', message: 'File exceeds 300MB limit' };
  }
  return null;
}
```

This prevents wasted upload bandwidth and API calls for obviously invalid files.

---

### Step 2: POST /api/upload — Job Initialization

**Location:** `app/api/upload/route.ts`  
**Auth:** None required (public endpoint, IP rate-limited to 5/hour)  
**Side effects:** Creates `processing_jobs` row, `job_tokens` row, generates signed upload URL

**Request** (sent by browser):
```json
{
  "file_name": "factory_assembly.mp4",
  "file_size_bytes": 128456789,
  "mime_type": "video/mp4",
  "sha256": "abc123..."
}
```

**Server-side actions** (in this exact order):
```typescript
// app/api/upload/route.ts
export async function POST(req: Request) {
  // 1. Rate limit check (Upstash Redis)
  const ip = getClientIP(req);
  await checkRateLimit('upload', ip, limit=5, window='1h');

  // 2. Parse and validate body
  const body = UploadRequestSchema.parse(await req.json());
  assertValidMimeType(body.mime_type);
  assertSizeLimit(body.file_size_bytes);

  // 3. Generate IDs
  const jobId = randomUUID();
  const traceId = `trc_${nanoid(21)}`;
  const objectKey = `jobs/${jobId}/RAW_VIDEO/v1/input.mp4`;
  const idempotencyKey = `upload:${body.sha256}`;

  // 4. Create job row (UPLOADED state)
  const supabase = createServiceClient();
  await supabase.from('processing_jobs').insert({
    id: jobId,
    trace_id: traceId,
    status: 'UPLOADED',
    input_bucket: 'raw-videos',
    input_object_key: objectKey,
    idempotency_key: idempotencyKey,
  });

  // 5. Mint job access token
  const rawToken = `ael_jt_${randomBytes(32).toString('hex')}`;
  const tokenHash = hmacSHA256(process.env.JOB_TOKEN_SIGNING_SECRET!, rawToken);
  await supabase.from('job_tokens').insert({
    job_id: jobId,
    token_hash: tokenHash,
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h
  });

  // 6. Generate Supabase Storage signed upload URL
  const { data: signedUrl } = await supabase.storage
    .from('raw-videos')
    .createSignedUploadUrl(objectKey, { expiresIn: 900 }); // 15min TTL

  // 7. Return to client
  return Response.json({
    job_id: jobId,
    job_access_token: rawToken,
    upload: { bucket: 'raw-videos', object_key: objectKey, signed_url: signedUrl, expires_in_sec: 900 },
    limits: { max_duration_sec: 360, max_size_bytes: 314572800 },
  }, { status: 201 });
}
```

**Database state after this step:**
- `processing_jobs`: 1 new row with `status=UPLOADED`
- `job_tokens`: 1 new row referencing the job

---

### Step 3: Client Direct Upload to Supabase Storage

**Location:** Browser  
**File:** `components/demo/UploadZone.tsx` → calls `lib/api/upload.ts`

The browser performs a direct PUT to the Supabase Storage signed URL. This bypasses Next.js entirely — the video bytes never touch Vercel servers, which prevents Vercel's 4.5MB body limit from blocking large files.

```typescript
// lib/api/upload.ts
export async function uploadVideoToStorage(signedUrl: string, file: File, onProgress: (pct: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    });
    xhr.onload = () => xhr.status === 200 ? resolve() : reject(new Error(`Upload failed: ${xhr.status}`));
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.open('PUT', signedUrl);
    xhr.setRequestHeader('Content-Type', 'video/mp4');
    xhr.send(file);
  });
}
```

The UI shows `UploadProgressBar` updating in real-time from the XHR `progress` event.

---

### Step 4: POST /api/process — Pipeline Trigger

**Location:** `app/api/process/route.ts`  
**Auth:** `Authorization: Bearer <job_access_token>` required  
**Side effects:** Updates job to `QUEUED`, sends webhook to Modal

This endpoint must be **idempotent** — safe to call multiple times if the client retries. If the job is already `QUEUED` or `*_RUNNING`, it returns 202 immediately without re-triggering Modal.

```typescript
// app/api/process/route.ts
export async function POST(req: Request) {
  const { job_id } = await req.json();

  // 1. Validate job-scoped bearer token
  const token = parseBearerToken(req);
  await requireJobToken(job_id, token);

  // 2. Load job and assert safe state to trigger
  const job = await supabase.from('processing_jobs').select().eq('id', job_id).single();
  if (!['UPLOADED', 'QUEUED'].includes(job.status)) {
    // Already running or completed — return current state
    return Response.json({ job_id, status: job.status }, { status: 202 });
  }

  // 3. Transition to QUEUED (atomic update)
  await supabase.from('processing_jobs').update({
    status: 'QUEUED',
    queued_at: new Date().toISOString(),
  }).eq('id', job_id).eq('status', 'UPLOADED');  // optimistic lock

  // 4. Trigger Modal webhook
  const modalSecret = process.env.MODAL_WEBHOOK_SECRET!;
  await fetch(process.env.MODAL_WEBHOOK_URL!, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${modalSecret}`,
    },
    body: JSON.stringify({ job_id, trace_id: job.trace_id }),
  });

  return Response.json({ job_id, status: 'QUEUED', trace_id: job.trace_id }, { status: 202 });
}
```

---

### Step 5: Modal Receives Webhook — LangGraph Pipeline Starts

**Location:** `modal_backend/app.py`  
**File:** `modal_backend/pipeline.py`

The Modal webhook endpoint validates the `Authorization: Bearer` secret, then calls `execute_pipeline()` asynchronously.

```python
# modal_backend/app.py
import modal
from pipeline import execute_pipeline

app = modal.App("autoegolab")

@app.function(cpu=2, memory=2048, timeout=1200)
@modal.web_endpoint(method="POST")
def process_webhook(body: dict, authorization: str = modal.Header("Authorization")):
    if authorization != f"Bearer {os.environ['MODAL_WEBHOOK_SECRET']}":
        raise modal.web_endpoint.HTTPException(status_code=401, detail="Unauthorized")
    
    job_id = body["job_id"]
    trace_id = body["trace_id"]
    
    # Run pipeline asynchronously (returns immediately, pipeline runs in background)
    execute_pipeline.spawn(job_id=job_id, trace_id=trace_id)
    return {"accepted": True, "job_id": job_id}
```

---

### Step 6: Each Agent Executes (State Transition Pattern)

Every agent follows this **exact pattern** for reliability and observability:

```python
# modal_backend/pipeline.py - shared agent wrapper
def run_agent_node(agent_name: str, node_fn, state: PipelineState) -> PipelineState:
    job_id = state["job_id"]
    attempt = state["attempt_map"].get(agent_name, 0) + 1
    
    # 1. Write agent_runs row (RUNNING)
    agent_run_id = supabase.table("agent_runs").insert({
        "job_id": job_id,
        "agent": agent_name,
        "attempt": attempt,
        "status": "RUNNING",
        "started_at": now_iso(),
    }).execute().data[0]["id"]
    
    # 2. Transition job status (RUNNING)
    transition_job(job_id, f"{agent_name}_RUNNING", agent_name)
    
    try:
        # 3. Run agent function (throws on failure)
        result = node_fn(state)
        
        # 4. Persist agent artifacts + domain rows (in transaction order)
        persist_agent_outputs(job_id, agent_name, result)
        
        # 5. Update agent_runs to SUCCEEDED
        supabase.table("agent_runs").update({
            "status": "SUCCEEDED",
            "output_count": result.output_count,
            "duration_ms": result.duration_ms,
            "finished_at": now_iso(),
        }).eq("id", agent_run_id).execute()
        
        # 6. Update PipelineState with new refs
        return merge_state(state, result.state_updates)
    
    except Exception as e:
        # 7. Update agent_runs to FAILED
        supabase.table("agent_runs").update({
            "status": "FAILED",
            "error_code": classify_error(e),
            "error_message": str(e),
            "finished_at": now_iso(),
        }).eq("id", agent_run_id).execute()
        raise  # Propagate to LangGraph for retry/failure routing


def transition_job(job_id: str, status: str, agent: str | None, payload: dict = {}):
    """Atomic status update + event append"""
    # In a real transaction these would be in a DB function/transaction
    supabase.table("processing_jobs").update({
        "status": status,
        "current_agent": agent,
        "progress_percent": STATUS_TO_PROGRESS.get(status, 0),
        "updated_at": now_iso(),
    }).eq("id", job_id).execute()
    
    supabase.table("job_events").insert({
        "job_id": job_id,
        "event_type": "job_status_updated",
        "payload": {
            "status": status,
            "current_agent": agent,
            "progress_percent": STATUS_TO_PROGRESS.get(status, 0),
            **payload,
        },
    }).execute()
```

---

### Step 7: Supabase Realtime Broadcasts Updates to Browser

**How it works:**
1. Postgres triggers fire on every `UPDATE` to `processing_jobs`
2. Supabase Realtime (built-in CDC) captures these WAL events
3. Events are broadcast over WebSocket to any client subscribed to that table with matching filter

**Client subscription setup:**
```typescript
// lib/realtime/subscribe.ts
export function subscribeToJobUpdates(jobId: string, onUpdate: (event: JobEvent) => void) {
  const supabase = createBrowserClient();
  
  const channel = supabase
    .channel(`job:${jobId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'processing_jobs',
        filter: `id=eq.${jobId}`,
      },
      (payload) => {
        const newRow = payload.new as ProcessingJob;
        onUpdate({
          jobId: newRow.id,
          status: newRow.status,
          progressPercent: newRow.progress_percent,
          currentAgent: newRow.current_agent,
          updatedAt: newRow.updated_at,
        });
      }
    )
    .subscribe();
  
  // Fallback polling if WebSocket disconnects
  let pollInterval: ReturnType<typeof setInterval> | null = null;
  channel.on('system', ({ status }) => {
    if (status === 'CHANNEL_ERROR') {
      pollInterval = setInterval(() => {
        fetch(`/api/job/${jobId}`)
          .then(r => r.json())
          .then(job => onUpdate(job));
      }, 5000);
    }
    if (status === 'SUBSCRIBED' && pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  });
  
  return () => {
    supabase.removeChannel(channel);
    if (pollInterval) clearInterval(pollInterval);
  };
}
```

**UI reaction to updates (PipelineTracker):**
```typescript
// components/demo/PipelineTracker.tsx
const STEPS = [
  { key: 'VIDEO_AGENT', label: 'Extracting Keyframes', icon: '🎬', runningStatus: 'VIDEO_AGENT_RUNNING' },
  { key: 'QUALITY_AGENT', label: 'Quality Filtering', icon: '✨', runningStatus: 'QUALITY_AGENT_RUNNING' },
  { key: 'PERCEPTION_AGENT', label: 'Visual Perception', icon: '👁️', runningStatus: 'PERCEPTION_AGENT_RUNNING' },
  { key: 'SEGMENTATION_AGENT', label: 'Skill Segmentation', icon: '✂️', runningStatus: 'SEGMENTATION_AGENT_RUNNING' },
  { key: 'ACTION_AGENT', label: 'Action Labeling', icon: '🏷️', runningStatus: 'ACTION_AGENT_RUNNING' },
  { key: 'TASK_GRAPH_AGENT', label: 'Task Graph', icon: '🗺️', runningStatus: 'TASK_GRAPH_AGENT_RUNNING' },
  { key: 'DATASET_BUILDER', label: 'Building Dataset', icon: '📦', runningStatus: 'DATASET_BUILDER_RUNNING' },
];

function getStepState(step: Step, currentStatus: string): 'pending' | 'running' | 'done' | 'error' {
  const runningIdx = STEPS.findIndex(s => s.runningStatus === currentStatus);
  const stepIdx = STEPS.indexOf(step);
  if (currentStatus === step.runningStatus) return 'running';
  if (currentStatus.startsWith(`FAILED_${step.key}`)) return 'error';
  if (runningIdx > stepIdx || currentStatus === 'COMPLETED') return 'done';
  return 'pending';
}
```

---

### Step 8: Results Available — COMPLETED State

When `COMPLETED` status arrives via Realtime:
1. UI shows `ResultsTabs` component
2. `TaskGraphView` fetches `task_graphs` data and renders interactive flow graph (React Flow)
3. `SkillSegmentsTable` fetches `skill_segments` with timestamps and primary object
4. `ActionTimeline` renders chronological action records with confidence scores
5. `DownloadPanel` calls `GET /api/job/:id/dataset` to get signed download URLs (300s TTL)
6. Semantic search enabled via `POST /api/search`

---

## 4.3 Database Write Sequence Per Stage

**Critical rule:** Always write in this order. If the status update fails, domain rows are still valid; if domain rows fail, status update must not proceed.

```
For each agent completion:
  1. Write artifact rows (INSERT INTO artifacts ...)
  2. Write domain rows (INSERT INTO skill_segments / actions / task_graphs ...)
  3. Write agent_run update (UPDATE agent_runs SET status='SUCCEEDED' ...)
  4. Write job_event (INSERT INTO job_events ...)
  5. Write processing_jobs status update (UPDATE processing_jobs SET status=... ...)
```

If step 5 fails due to a transient DB error:
- The job remains in the previous status
- The domain data is already written and valid
- The next heartbeat from the watchdog will retry the status push
- Realtime will eventually broadcast the correct state

---

## 4.4 Realtime Event Payload Contract

All Realtime events from the `processing_jobs` table must carry these fields. Any code consuming events must tolerate missing optional fields gracefully.

```typescript
interface JobStatusEvent {
  job_id: string;              // uuid
  status: JobStatus;           // enum string
  progress_percent: number;    // 0-100
  current_agent: AgentName | null;
  updated_at: string;          // ISO8601
  failure_code: string | null; // set only on FAILED_* states
  trace_id: string;            // for LangSmith correlation
}
```

---

## 4.5 State Recovery Scenarios

### Scenario A: Browser Reconnects Mid-Run
```
User closes tab → reopens /demo/{jobId}
  ↓
DemoJobPage reads jobId from URL
  ↓
Fetch GET /api/job/{jobId} with stored bearer token (localStorage)
  ↓
Server returns current status and progress
  ↓
UI renders correct step as active
  ↓
Subscribe to Realtime channel — catches any missed events from polling reconciliation
```

### Scenario B: Process Trigger Fires Twice (Double Click)
```
First POST /api/process → status: UPLOADED → updated to QUEUED → Modal triggered
Second POST /api/process → status: QUEUED → no-op → returns 202 with current status
```
The `UPDATE ... WHERE status='UPLOADED'` optimistic lock on step 4 ensures only one trigger goes through.

### Scenario C: Modal Container Crash Mid-Pipeline
```
Watchdog runs every 60s
  ↓
Detects job with status=PERCEPTION_AGENT_RUNNING and updated_at > 3 minutes ago
  ↓
Checks if active Modal task running → None found
  ↓
Attempts resume from last checkpoint:
  - Loads PipelineState from processing_jobs + agent_runs (SUCCEEDED rows)
  - Rebuilds state from completed stages
  - Re-triggers pipeline starting from failed stage
```
If resume not possible (state corrupted): marks `FAILED_ORCHESTRATOR`.

---
