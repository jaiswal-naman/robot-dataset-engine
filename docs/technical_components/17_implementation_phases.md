# AutoEgoLab v3.0 — Phase by Phase Implementation Plan
**Document owner:** AI Systems Engineering  
**Revision:** 2.0 | **Date:** 2026-03-16 | **Status:** Build-Ready

---

## Overview

The project is implemented in **5 sequential phases**. Each phase must be fully complete and verified before the next begins. Each phase has a deployable checkpoint so partial work is always demoed.

**Total estimated engineering time: 10-14 days (1 engineer)**

```
Phase 1: Infrastructure Foundation       Days 1-2
Phase 2: Pipeline Skeleton + Realtime    Days 3-4
Phase 3: Agent Integration               Days 5-9
Phase 4: Frontend Productization         Days 10-12
Phase 5: Deployment + Hardening          Days 13-14
```

---

## Phase 1 — Infrastructure Foundation

**Objective:** Every service is initialized, connected, and testable. An empty pipeline runs end-to-end (upload → job creation → placeholder webhook → realtime ping).

---

### Task 1.1 — Initialize Next.js Project

```bash
# From the autoegolab/ root
npx create-next-app@latest . --typescript --tailwind --app --src-dir=no --import-alias="@/*"
```

Install additional dependencies:
```bash
npm install @supabase/supabase-js @supabase/ssr zustand @tanstack/react-query \
  react-dropzone nanoid @upstash/ratelimit @upstash/redis
npm install -D @types/node typescript eslint
```

Set up `next.config.ts`:
```typescript
// next.config.ts
import type { NextConfig } from 'next';

const config: NextConfig = {
  experimental: { serverActions: { allowedOrigins: ['localhost:3000'] } },
  // Prevent Vercel from buffering large upload bodies (they go directly to Supabase Storage)
  api: { bodyParser: false },
};

export default config;
```

**Files created:**
- `app/layout.tsx` — root layout with font imports
- `app/page.tsx` — placeholder landing page
- `next.config.ts`
- `tsconfig.json`
- `.env.local` (from `.env.example`)

---

### Task 1.2 — Initialize Supabase Project

1. Go to [supabase.com](https://supabase.com) → New Project → name: `autoegolab`
2. Note: `Project URL`, `anon key`, `service_role key`, `JWT secret`
3. Enable pgvector: Dashboard → Database → Extensions → enable `vector`
4. Apply migrations (Section 8):

```bash
# Apply all 3 migration files in order
npx supabase db push --db-url postgresql://postgres:[password]@[host]:5432/postgres \
  < supabase/migrations/0001_init.sql

npx supabase db push ... < supabase/migrations/0002_indexes.sql
npx supabase db push ... < supabase/migrations/0003_rls.sql
```

5. Create storage buckets (via Supabase dashboard or SQL):
```sql
-- Create private buckets
insert into storage.buckets (id, name, public) values
  ('raw-videos', 'raw-videos', false),
  ('frames', 'frames', false),
  ('intermediate', 'intermediate', false),
  ('datasets', 'datasets', false),
  ('thumbnails', 'thumbnails', false);
```

6. Enable Realtime on job tables:
```sql
alter publication supabase_realtime add table public.processing_jobs;
alter publication supabase_realtime add table public.agent_runs;
alter publication supabase_realtime add table public.job_events;
```

**Validation test:**
```bash
# Insert a test job row, verify Realtime fires in browser console
curl -X POST https://[project].supabase.co/rest/v1/processing_jobs \
  -H "apikey: [service_role_key]" \
  -H "Content-Type: application/json" \
  -d '{"trace_id":"test","input_bucket":"raw-videos","input_object_key":"test"}'
```

---

### Task 1.3 — Initialize Modal Project

```bash
pip install modal
modal setup  # Opens browser for authentication
modal token new --profile default
```

Create `modal_backend/app.py` skeleton:
```python
# modal_backend/app.py
import modal
import os

app = modal.App("autoegolab")

SUPABASE_SECRET = modal.Secret.from_name("supabase-keys")
GEMINI_SECRET   = modal.Secret.from_name("gemini-keys")

BASE_IMAGE = modal.Image.debian_slim().pip_install(
    "supabase", "pydantic", "tenacity", "langgraph", "langchain"
)

@app.function(cpu=2, memory=2048, timeout=30, image=BASE_IMAGE, secrets=[SUPABASE_SECRET])
@modal.web_endpoint(method="POST")
def process_webhook(body: dict):
    """Placeholder webhook — just returns 200 for now."""
    print(f"[Webhook] Received job_id: {body.get('job_id')}")
    return {"accepted": True, "job_id": body.get("job_id")}

if __name__ == "__main__":
    modal.runner.deploy_stub(app)
```

Deploy:
```bash
modal deploy modal_backend/app.py
# Note the webhook URL printed by Modal
```

Store webhook URL as `MODAL_WEBHOOK_URL` environment variable in Vercel and `.env.local`.

---

### Task 1.4 — Environment Variables Setup

Create `.env.local` with all required variables:
```bash
# .env.local

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://[project].supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SUPABASE_JWT_SECRET=[your-jwt-secret]

# Modal
MODAL_WEBHOOK_URL=https://[team]--autoegolab-process-webhook.modal.run
MODAL_WEBHOOK_SECRET=[generate-with: openssl rand -hex 32]
MODAL_TOKEN_ID=[from modal token list]
MODAL_TOKEN_SECRET=[from modal token list]

# Google Gemini
GOOGLE_API_KEY=[from Google AI Studio]

# LangSmith
LANGCHAIN_API_KEY=[from LangSmith settings]
LANGCHAIN_PROJECT=autoegolab

# Security
JOB_TOKEN_SIGNING_SECRET=[generate-with: openssl rand -hex 32]

# Rate Limiting (optional - Upstash)
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

Create `lib/supabase/server.ts` and `lib/supabase/client.ts`:
```typescript
// lib/supabase/server.ts
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

export function createServiceClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

// lib/supabase/client.ts — browser-side (anon key only)
import { createBrowserClient as _createBrowserClient } from '@supabase/ssr';
export function createBrowserClient() {
  return _createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

---

### Phase 1 Validation Tests

```bash
# Test 1: Supabase migration integrity
npx supabase db diff --db-url [url]  # Should show no drift

# Test 2: Storage bucket accessibility
node -e "
const {createClient} = require('@supabase/supabase-js');
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
sb.storage.from('raw-videos').list().then(console.log);"

# Test 3: Modal webhook reachable
curl -X POST $MODAL_WEBHOOK_URL \
  -H "Authorization: Bearer $MODAL_WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"job_id":"test-uuid","trace_id":"trc_test"}'
# Expected: {"accepted": true, "job_id": "test-uuid"}

# Test 4: Next.js builds without type errors
npm run build
```

**Phase 1 Deliverable:** All services initialized and connected. `npm run dev` starts without errors. Modal webhook returns 200. Supabase schema applied.

---

## Phase 2 — Pipeline Skeleton + Realtime

**Objective:** A full job lifecycle (UPLOADED → COMPLETED) runs end-to-end with mock agents. Realtime updates reach the browser. No real model inference yet.

---

### Task 2.1 — Implement Upload API

File: `app/api/upload/route.ts`

Implement the full `POST /api/upload` endpoint per Section 4.2 Step 2:
- Rate limit check (skip if Upstash not configured)
- Body validation with Zod schema
- Create `processing_jobs` row
- Create `job_tokens` row
- Generate Supabase Storage signed upload URL
- Return `{job_id, job_access_token, upload, limits}`

```typescript
// Zod schema for upload request validation
import { z } from 'zod';

export const UploadRequestSchema = z.object({
  file_name: z.string().min(1).max(255),
  file_size_bytes: z.number().int().positive().max(314_572_800),  // 300MB
  mime_type: z.literal("video/mp4"),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
```

---

### Task 2.2 — Implement Process API

File: `app/api/process/route.ts`

Implement `POST /api/process` per Section 4.2 Step 4:
- Validate job-scoped bearer token
- Assert job is in UPLOADED/QUEUED state
- Transition to QUEUED (optimistic lock)
- Send webhook to Modal

```typescript
// Token validation utility — used by all protected endpoints
export async function requireJobToken(req: Request, jobId: string): Promise<void> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) throw new ApiError(401, 'MISSING_TOKEN');
  
  const rawToken = authHeader.slice(7);
  const tokenHash = createHmac('sha256', process.env.JOB_TOKEN_SIGNING_SECRET!)
    .update(rawToken).digest('hex');
  
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('job_tokens')
    .select('id, expires_at, revoked_at')
    .eq('job_id', jobId)
    .eq('token_hash', tokenHash)
    .single();
  
  if (!data) throw new ApiError(401, 'INVALID_JOB_TOKEN');
  if (new Date(data.expires_at) < new Date()) throw new ApiError(401, 'TOKEN_EXPIRED');
  if (data.revoked_at) throw new ApiError(401, 'TOKEN_REVOKED');
}
```

---

### Task 2.3 — Implement Job Status API

File: `app/api/job/[id]/route.ts`

```typescript
export async function GET(req: Request, { params }: { params: { id: string } }) {
  await requireJobToken(req, params.id);
  const supabase = createServiceClient();
  
  const { data: job } = await supabase
    .from('processing_jobs')
    .select('id, status, progress_percent, current_agent, queued_at, started_at, updated_at, failure_code')
    .eq('id', params.id)
    .single();
  
  if (!job) return Response.json({ error: { code: 'JOB_NOT_FOUND' } }, { status: 404 });
  
  return Response.json({
    job_id: job.id,
    status: job.status,
    progress_percent: job.progress_percent,
    current_agent: job.current_agent,
    timings: { queued_at: job.queued_at, started_at: job.started_at, updated_at: job.updated_at },
    last_error: job.failure_code ? { code: job.failure_code } : null,
  });
}
```

---

### Task 2.4 — Mock Pipeline in Modal

Update `modal_backend/app.py` with mock pipeline that progresses through all 7 stages using `time.sleep`:

```python
# modal_backend/app.py (Phase 2 mock pipeline)
import time, os
from supabase import create_client

@app.function(cpu=2, memory=2048, timeout=120, image=BASE_IMAGE, secrets=[SUPABASE_SECRET])
@modal.web_endpoint(method="POST")
def process_webhook(body: dict, authorization: str = modal.Header("Authorization")):
    if authorization != f"Bearer {os.environ['MODAL_WEBHOOK_SECRET']}":
        raise modal.web_endpoint.HTTPException(status_code=401)
    
    job_id = body["job_id"]
    trace_id = body.get("trace_id", "mock-trace")
    
    run_mock_pipeline.spawn(job_id=job_id, trace_id=trace_id)
    return {"accepted": True}

@app.function(cpu=2, memory=512, timeout=120, secrets=[SUPABASE_SECRET])
def run_mock_pipeline(job_id: str, trace_id: str):
    sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
    
    stages = [
        ("VIDEO_AGENT_RUNNING",        "VIDEO_AGENT",        10, 3),
        ("QUALITY_AGENT_RUNNING",      "QUALITY_AGENT",      22, 2),
        ("PERCEPTION_AGENT_RUNNING",   "PERCEPTION_MERGE",   35, 5),
        ("SEGMENTATION_AGENT_RUNNING", "SEGMENTATION_AGENT", 62, 2),
        ("ACTION_AGENT_RUNNING",       "ACTION_AGENT",       72, 3),
        ("TASK_GRAPH_AGENT_RUNNING",   "TASK_GRAPH_AGENT",   86, 2),
        ("DATASET_BUILDER_RUNNING",    "DATASET_BUILDER",    94, 2),
    ]
    
    for status, agent, progress, sleep_sec in stages:
        sb.table("processing_jobs").update({
            "status": status,
            "current_agent": agent,
            "progress_percent": progress,
            "started_at": now_iso() if status == "VIDEO_AGENT_RUNNING" else None,
        }).eq("id", job_id).execute()
        time.sleep(sleep_sec)
    
    sb.table("processing_jobs").update({
        "status": "COMPLETED",
        "progress_percent": 100,
        "current_agent": None,
        "completed_at": now_iso(),
    }).eq("id", job_id).execute()
```

---

### Task 2.5 — Frontend UploadZone + PipelineTracker

**Files to create:**
- `components/demo/UploadZone.tsx` — drag & drop with react-dropzone
- `components/demo/PipelineTracker.tsx` — 7-step vertical stepper
- `lib/realtime/subscribe.ts` — Supabase Realtime subscription
- `lib/store.ts` — Zustand store with sessionSlice + jobSlice
- `app/demo/page.tsx` — demo page assembling all components

The `PipelineTracker` should show:
- Each of the 7 agents as a step
- ✅ green checkmark for completed steps
- 🔄 pulsing spinner for active step
- ⏸️ grey for pending steps
- ❌ red for failed steps

---

### Phase 2 Validation Tests

```bash
# Test 1: Full upload → process → complete cycle (mock)
# Manual: Open localhost:3000/demo, upload a test video, watch stepper progress to COMPLETED

# Test 2: State transition contract test  
node tests/integration/pipeline_state_machine.test.ts
# Tests: UPLOADED → QUEUED, QUEUED → VIDEO_AGENT_RUNNING, etc.

# Test 3: Realtime disconnect + reconnect
# Manual: Connect, disconnect network, reconnect — UI should resume polling and show correct state

# Test 4: Double process trigger (idempotency)
curl -X POST /api/process -d '{"job_id":"same-id","upload_complete":true}'  # First call → 202 QUEUED
curl -X POST /api/process -d '{"job_id":"same-id","upload_complete":true}'  # Second call → 202 QUEUED (no-op)
```

**Phase 2 Deliverable:** Full UI works with mock pipeline. Realtime updates pipeline steps in real time. Upload → COMPLETED cycle works without any AI models.

---

## Phase 3 — Agent Integration

**Objective:** Replace mock pipeline with real model inference. Each agent is implemented, tested with sample video, and produces real artifacts.

---

### Task 3.1 — Model Image Setup in Modal

Define separate Modal images per model to enable parallel image builds and caching:

```python
# modal_backend/app.py — image definitions

DINOV2_IMAGE = (
    modal.Image.debian_slim()
    .apt_install("libgl1", "libglib2.0-0", "ffmpeg")
    .pip_install("torch==2.2.0", "torchvision", "pillow", "numpy", "sklearn-extra")
    .run_commands("python -c \"import torch; torch.hub.load('facebookresearch/dinov2', 'dinov2_vitb14')\"")
)

YOLOE_IMAGE = (
    modal.Image.debian_slim()
    .apt_install("libgl1", "libglib2.0-0")
    .pip_install("ultralytics", "torch==2.2.0", "torchvision")
)

SAM2_IMAGE = (
    modal.Image.debian_slim()
    .apt_install("libgl1")
    .pip_install("torch==2.2.0", "torchvision", "sam2", "pillow")
    .run_commands("python -c \"import sam2\"")  # Pre-warm import
)

HAWOR_IMAGE = (
    modal.Image.debian_slim()
    .pip_install("torch==2.2.0", "torchvision", "hawor")
)

EGO_VLM_IMAGE = (
    modal.Image.debian_slim()
    .pip_install("torch==2.2.0", "transformers>=4.40", "accelerate", "pillow", "instructor")
    .run_commands("pip install flash-attn --no-build-isolation")
)

CPU_IMAGE = (
    modal.Image.debian_slim()
    .apt_install("ffmpeg", "libgl1")
    .pip_install("opencv-python-headless", "numpy", "scipy", "supabase",
                 "pydantic>=2.0", "tenacity", "langgraph", "instructor",
                 "google-generativeai")
)
```

**Important:** Images are built once and cached by content hash. Always specify exact package versions to prevent cache busting.

---

### Task 3.2 — Implement Video Agent

File: `modal_backend/agents/video_agent.py`

Implement `VideoAgent` per Section 6.2 of the agent specifications document. 

**Key implementation details:**
1. Use `tempfile.TemporaryDirectory()` as context manager — all temp files cleaned up even on failure
2. DINOv2 is loaded with `torch.hub.load` with `force_reload=False` for consistent caching
3. k-medoids `n_clusters` must be clamped to `min(target_keyframes, len(available_frames))`
4. Each frame is uploaded with metadata `{frame_index, ts_ms}` in `artifacts.metadata`

**Validation:**
```bash
# Test with 30-second fixture video
python -m pytest modal_backend/tests/test_video_agent.py -v
# Assert: at least 10 CLEAN_FRAME artifacts created
# Assert: all artifact UUIDs present in PipelineState
```

---

### Task 3.3 — Implement Quality Agent

File: `modal_backend/agents/quality_agent.py`

Implement per Section 6.3. Pure CPU/NumPy — no model loading.

**Validation:**
```bash
python -m pytest modal_backend/tests/test_quality_agent.py -v
# Assert: blur-only test frame gets rejected
# Assert: good frame gets CLEAN_FRAME artifact_type
# Assert: QualityMetrics written to processing_jobs.failure_details
```

---

### Task 3.4 — Implement Perception Agent (3 branches + merge)

Files:
- `modal_backend/agents/perception_object.py` — YOLOE-26x-seg
- `modal_backend/agents/perception_mask.py` — SAM 2.1
- `modal_backend/agents/perception_hand.py` — HaWoR
- `modal_backend/agents/perception_merge.py` — Contact fusion

**Model download commands (run in Modal image build):**
```python
# YOLOE model (auto-downloaded on first run by ultralytics)
# SAM 2.1 checkpoint
# modal_backend/app.py — download at image build time:
SAM2_IMAGE = SAM2_IMAGE.run_commands(
    "mkdir -p /model-cache && "
    "wget -q -O /model-cache/sam2.1_hiera_large.pt "
    "https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_large.pt"
)
```

**Validation:**
```bash
python -m pytest modal_backend/tests/test_perception_agent.py -v
# Assert: object_detections.json artifact created
# Assert: sam_masks.json artifact created  
# Assert: hand_poses.json artifact created
# Assert: perception_merged.json artifact created with contact events
```

---

### Task 3.5 — Implement Segmentation Agent

File: `modal_backend/agents/segmentation_agent.py`

Implement dual-signal boundary detection per Section 6.5 of agent specs.

**Validation:**
```bash
python -m pytest modal_backend/tests/test_segmentation_agent.py -v
# Assert: at least 1 skill_segment row written for test clip
# Assert: no segments with duration < MIN_SEGMENT_DURATION_MS (unless fallback)
# Assert: all trigger_types are valid enum values
```

---

### Task 3.6 — Implement Action Agent

File: `modal_backend/agents/action_agent.py`

Implement EgoVLM-3B + Gemini fallback per Section 6.6.

**Critical:** EgoVLM-3B requires A10G GPU with `torch.bfloat16` dtype. Load with `device_map="auto"` to handle memory automatically.

**Validation:**
```bash
python -m pytest modal_backend/tests/test_action_agent.py -v
# Assert: all segment_ids have corresponding actions rows
# Assert: action.verb is non-empty for every action
# Assert: fallback_used=True for known low-quality test clips
```

---

### Task 3.7 — Implement Task Graph Agent

File: `modal_backend/agents/task_graph_agent.py`

Implement Gemini + instructor structured output per Section 6.7.

**Critical:** Always use `instructor.from_gemini` with `response_model=TaskGraph`. Never parse raw Gemini text manually.

**Validation:**
```bash
python -m pytest modal_backend/tests/test_task_graph_agent.py -v
# Assert: task_graphs row written with valid graph_json
# Assert: graph_json.root_node_id is "goal" type
# Assert: every action_index appears in exactly one graph node
```

---

### Task 3.8 — Implement Dataset Builder

File: `modal_backend/agents/dataset_builder.py`

Implement per Section 6.8. Validate using Pydantic v2 `model_validate()`.

**RLDS implementation:**
```python
import tensorflow as tf

def build_rlds_bundle(dataset: VLADataset, state: PipelineState) -> bytes:
    """Build TensorFlow Records for RLDS format."""
    buffer = io.BytesIO()
    writer = tf.io.TFRecordWriter(buffer)
    
    for record in dataset.records:
        # Download observation image
        frame_bytes = download_artifact(record.observation_image_artifact_id)
        
        feature = tf.train.Features(feature={
            'observation/image': tf.train.Feature(
                bytes_list=tf.train.BytesList(value=[frame_bytes])
            ),
            'language_instruction': tf.train.Feature(
                bytes_list=tf.train.BytesList(value=[record.language_instruction.encode()])
            ),
            'action/verb': tf.train.Feature(
                bytes_list=tf.train.BytesList(value=[record.action_verb.encode()])
            ),
            'timestamp/start_ms': tf.train.Feature(
                int64_list=tf.train.Int64List(value=[record.timestamp_start_ms])
            ),
        })
        writer.write(tf.train.Example(features=feature).SerializeToString())
    
    writer.close()
    return buffer.getvalue()
```

---

### Task 3.9 — Wire Real Pipeline in Modal

Replace mock pipeline in `modal_backend/app.py` with real LangGraph pipeline from `pipeline.py`.

Update the `process_webhook` to call `execute_pipeline.spawn()` instead of `run_mock_pipeline.spawn()`.

**End-to-end validation with real video:**
```bash
# Use provided 30-second test clip (factory assembly footage)
python modal_backend/tests/test_full_pipeline.py --video tests/fixtures/factory_clip_30s.mp4
# Assert: status reaches COMPLETED
# Assert: dataset.json artifact exists and is valid
# Assert: at least 1 VLA record in manifest
# Assert: LangSmith trace URL stored in agent_runs
```

**Phase 3 Deliverable:** Real pipeline processes sample factory video end-to-end. All 7 agents produce real output. LangSmith traces visible.

---

## Phase 4 — Frontend Productization

**Objective:** Build the complete, production-quality demo UI. Every screen is polished. Results are visualized. Downloads work. Search works.

---

### Task 4.1 — Landing Page (`app/page.tsx`)

Design a high-impact landing page that demonstrates the value proposition in 30 seconds:

**Sections:**
1. **Hero**: "From Factory Video to Robot Training Data. Automatically." — with animated pipeline diagram
2. **How It Works**: 3-step illustration (Upload → AI Processes → Download Dataset)
3. **Demo CTA**: Large button → `/demo`
4. **Tech Stack**: Model logos (YOLOE, SAM, HaWoR, EgoVLM, Gemini)
5. **Sample Output**: Static preview of a task graph and skill segments table

Use `Inter` font from Google Fonts. Primary color: `#6366f1` (indigo). Background: `#0f0f13` (near-black). Cards: `rgba(255,255,255,0.04)` glassmorphism.

---

### Task 4.2 — Upload + Demo Page (`app/demo/page.tsx`)

**Component hierarchy:**
```
DemoPage
├── UploadZone (reactive — shows if status === null)
├── UploadProgressBar (shows during file PUT to storage)
├── PipelineTracker (shows during QUEUED → COMPLETED/FAILED)
│   ├── Step × 7 (each with icon, label, duration, status indicator)
│   └── ElapsedTimer (increments every second while *_RUNNING)
├── ResultsTabs (shows when COMPLETED)
│   ├── TaskGraphView (React Flow graph — nodes + edges)
│   ├── SkillSegmentsTable (start_ts, end_ts, primary_object, confidence)
│   ├── ActionTimeline (chronological action records with bars)
│   └── DownloadPanel (JSON + RLDS download buttons)
└── ErrorBanner (shows on FAILED_* states)
```

**TaskGraphView implementation:**
```typescript
// components/demo/TaskGraphView.tsx
import ReactFlow, { Node, Edge } from 'reactflow';

function buildFlowNodes(graphJson: TaskGraph): { nodes: Node[], edges: Edge[] } {
  const nodes = graphJson.nodes.map(n => ({
    id: n.id,
    type: n.type === 'goal' ? 'input' : n.type === 'action' ? 'output' : 'default',
    data: { label: n.label },
    position: autoLayout(n.id, graphJson.edges),  // use dagre for auto-layout
    style: {
      background: n.type === 'goal' ? '#6366f1' : n.type === 'action' ? '#10b981' : '#374151',
      color: 'white', borderRadius: 8,
    },
  }));
  const edges = graphJson.edges.map(e => ({
    id: `${e.from}-${e.to}`, source: e.from, target: e.to,
    label: e.relation,
    style: { stroke: '#6b7280' },
  }));
  return { nodes, edges };
}
```

Install: `npm install reactflow dagre @dagrejs/dagre`

---

### Task 4.3 — Resumable Job Page (`app/demo/[jobId]/page.tsx`)

When user navigates to `/demo/[jobId]`:
1. Read `jobId` from URL params
2. Check localStorage for stored `job_access_token` matching this jobId
3. If found: fetch `GET /api/job/:id`, restore UI state, subscribe to Realtime
4. If not found: show "Session expired" with link to start new demo

---

### Task 4.4 — Search API + Library Page

File: `app/api/search/route.ts`
```typescript
export async function POST(req: Request) {
  const { job_id, query, top_k = 5 } = await req.json();
  await requireJobToken(req, job_id);
  
  // 1. Embed query with DINOv2 text (or use Gemini embedding API)
  const embedding = await embedQuery(query);
  
  // 2. Call pgvector RPC
  const supabase = createServiceClient();
  const { data } = await supabase.rpc('search_job_embeddings', {
    p_job_id: job_id,
    p_query_embedding: embedding,
    p_top_k: top_k,
  });
  
  return Response.json({ job_id, results: data });
}
```

File: `app/library/page.tsx` — search bar + results grid

---

### Task 4.5 — Dataset Download API

File: `app/api/job/[id]/dataset/route.ts`
```typescript
export async function GET(req: Request, { params }: { params: { id: string } }) {
  await requireJobToken(req, params.id);
  const supabase = createServiceClient();
  
  const { data: manifest } = await supabase
    .from('dataset_manifests')
    .select('*, artifacts!dataset_json_artifact_id(*), artifacts!dataset_rlds_artifact_id(*)')
    .eq('job_id', params.id)
    .single();
  
  // Generate signed download URLs (5 min TTL)
  const downloads = await Promise.all([
    generateSignedUrl(manifest.artifacts.dataset_json_artifact_id),
    generateSignedUrl(manifest.artifacts.dataset_rlds_artifact_id),
  ]);
  
  return Response.json({ job_id: params.id, status: 'COMPLETED', downloads, manifest });
}
```

---

### Phase 4 Validation Tests

```bash
# Test 1: Playwright E2E — full happy path
npx playwright test tests/e2e/full_demo_flow.spec.ts
# Uploads fixture video → waits for COMPLETED → checks result tabs populated

# Test 2: Playwright — FAILED path
npx playwright test tests/e2e/failure_flow.spec.ts
# Uploads corrupt video → checks ErrorBanner renders with correct message

# Test 3: Browser reconnect
npx playwright test tests/e2e/reconnect.spec.ts
# Opens demo, starts pipeline, reloads page, asserts state restored correctly

# Test 4: Accessibility
npx axe-core tests/e2e/accessibility.spec.ts
# Assert: no critical violations on landing and demo pages
```

**Phase 4 Deliverable:** Production demo UI. Upload → Results cycle has zero loading gaps. All components render correctly. Search returns semantic results.

---

## Phase 5 — Deployment, Hardening, and Launch

**Objective:** The system is live at a public URL, monitored, with documented runbooks.

---

### Task 5.1 — Vercel Production Deployment

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy to production
vercel --prod

# Set all environment variables in Vercel dashboard:
# Settings → Environment Variables → add all from .env.local (without NEXT_PUBLIC_ prefix exposing secrets)
```

Set these in Vercel dashboard (not .env.local for prod):
- `SUPABASE_SERVICE_ROLE_KEY` ← CRITICAL: server-only
- `SUPABASE_JWT_SECRET`
- `MODAL_WEBHOOK_SECRET`
- `JOB_TOKEN_SIGNING_SECRET`
- All others from the env vars matrix (Section 12.6 of infrastructure doc)

---

### Task 5.2 — Modal Production Secrets

```bash
modal secret create supabase-keys \
  SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
  SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY

modal secret create gemini-keys \
  GOOGLE_API_KEY=$GOOGLE_API_KEY

modal secret create langsmith-keys \
  LANGCHAIN_API_KEY=$LANGCHAIN_API_KEY \
  LANGCHAIN_PROJECT=autoegolab

modal deploy modal_backend/app.py
```

---

### Task 5.3 — CI/CD with GitHub Actions

File: `.github/workflows/ci.yml`
```yaml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm run build
      - run: npx playwright install --with-deps
      - run: npx playwright test tests/e2e/

  deploy:
    needs: test
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npx vercel --prod --token=${{ secrets.VERCEL_TOKEN }}
      - run: pip install modal && modal deploy modal_backend/app.py
        env: { MODAL_TOKEN_ID: ${{ secrets.MODAL_TOKEN_ID }}, MODAL_TOKEN_SECRET: ${{ secrets.MODAL_TOKEN_SECRET }} }
```

---

### Task 5.4 — Load Test

```bash
# Install k6
brew install k6

# Load test script: tests/load/pipeline_load_test.js
# Simulates 2 concurrent video uploads (free-tier safe)
k6 run tests/load/pipeline_load_test.js \
  --vus 2 \
  --duration 10m \
  --env BASE_URL=https://autoegolab.vercel.app
```

Expected outcomes:
- p50 job completion < 180s ✅
- p95 job completion < 300s ✅
- Zero FAILED_ORCHESTRATOR statuses ✅
- No 5xx API errors ✅

---

### Task 5.5 — Monitoring Dashboard Setup

In LangSmith:
- Create project `autoegolab`
- Enable alerts on: trace failure rate > 10%

In Supabase:
- Dashboard → Reports → Set up job failure rate query
- Enable email alerts for query threshold breach

In Vercel:
- Speed Insights enabled
- Log Drain configured (optional: Axiom or Logtail)

---

### Phase 5 Validation Tests

```bash
# Test 1: Full live demo
# Manual: Open https://autoegolab.vercel.app, upload factory_clip_5min.mp4
# Assert: COMPLETED in < 5 minutes with valid results

# Test 2: Security tests
# Attempt: use expired job token → assert 401
# Attempt: upload .avi file → assert 400 INVALID_FORMAT
# Attempt: trigger /api/process without token → assert 401
# Attempt: 6 uploads from same IP in 1 hour → assert 429

# Test 3: Recovery drill
# Manually kill Modal task mid-pipeline
# Assert: watchdog detects within 3 minutes, attempts resume or marks FAILED_ORCHESTRATOR
```

**Phase 5 Deliverable:** System live at public URL. CI/CD pipeline functional. Monitoring active. Runbooks documented.

---

## Milestone Summary

| Phase | Duration | Key Deliverable | Success Gate |
|---|---|---|---|
| 1 — Infrastructure | 2 days | All services connected | Modal webhook returns 200, Supabase schema applied |
| 2 — Pipeline Skeleton | 2 days | Mock end-to-end + Realtime UI | UI steps from QUEUED → COMPLETED with live updates |
| 3 — Agent Integration | 5 days | Real pipeline on real video | dataset.json produced from factory clip with >0 records |
| 4 — Frontend | 3 days | Production-quality UI | E2E tests pass, results fully rendered |
| 5 — Deployment | 2 days | Live at public URL | Load test passes, security tests pass |

---
