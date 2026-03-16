# AutoEgoLab v3.0 — System Requirements & SLOs
**Document owner:** AI Systems Engineering  
**Revision:** 2.0 | **Date:** 2026-03-16 | **Status:** Build-Ready

---

## 2.1 Functional Requirements

Each requirement is prefixed with a unique ID. All are non-negotiable for the v3.0 demo launch.

---

### FR-1 — Video Upload

**FR-1.1** The system MUST accept MP4 video files via a browser-based drag-and-drop or click-to-browse interface.

**FR-1.2** Before any network call, the client MUST validate:
- File extension is `.mp4`
- MIME type is `video/mp4`
- File size ≤ 300MB

**FR-1.3** The server MUST validate upon receiving upload metadata:
- Declared MIME type matches `video/mp4`
- Declared size ≤ 314,572,800 bytes (300MB)
- SHA-256 matches any existing upload (idempotency key check)

**FR-1.4** The server MUST run `ffprobe` post-upload to validate:
- Codec is one of: `h264`, `h265`, `vp9`, `av1`
- Video stream duration ≤ 360 seconds
- File is not corrupt/unreadable
- If validation fails → status transitions to `FAILED_VALIDATION` immediately

**FR-1.5** The upload flow MUST be a **direct client-to-storage PUT** (avoiding Vercel's 4.5MB body limit). The server only generates and returns a Supabase Storage signed URL; it never proxies the video bytes.

**FR-1.6** The server MUST return a **job-scoped bearer token** (`ael_jt_*`) in the upload initialization response. This token is required for all subsequent API calls relating to this job.

---

### FR-2 — Automated Pipeline Orchestration

**FR-2.1** On receiving `POST /api/process`, the system MUST trigger the LangGraph pipeline on Modal within 5 seconds.

**FR-2.2** The pipeline MUST execute all 7 agents in deterministic order:
```
Video Agent → Quality Agent → Perception Agent (parallel) → Segmentation Agent → Action Agent → Task Graph Agent → Dataset Builder
```

**FR-2.3** MUST support controlled branch parallelism for the Perception Agent (Object, Mask, Hand branches run concurrently; Merge runs after all three complete).

**FR-2.4** Each agent MUST persist its outputs to Supabase Storage AND write corresponding domain rows to Postgres **before** updating `processing_jobs.status`.

**FR-2.5** Each agent MUST write a checkpoint reference to `processing_jobs.failure_details.checkpoints` so the pipeline can resume from the last completed stage on restart.

**FR-2.6** Each agent MUST retry up to 3 times on retryable failures (network timeouts, transient GPU errors, rate limits) using exponential backoff before declaring terminal failure.

---

### FR-3 — Real-Time Progress Updates

**FR-3.1** The UI MUST receive status update events within 2 seconds of any `processing_jobs.status` change.

**FR-3.2** Events MUST be delivered via Supabase Realtime WebSocket channels, filtered per `job_id`.

**FR-3.3** If the Realtime channel disconnects (network error), the client MUST automatically fall back to polling `GET /api/job/:id` every 5 seconds.

**FR-3.4** If the user closes and reopens the browser, the UI MUST be able to recover full job state by reading stored `job_id` + `job_access_token` from `localStorage` and calling `GET /api/job/:id`.

**FR-3.5** The UI progress bar MUST reflect `processing_jobs.progress_percent` accurately at all times (0–100%, mapping defined in `STATUS_TO_PROGRESS` constant).

---

### FR-4 — Dataset Retrieval and Search

**FR-4.1** When a job reaches `COMPLETED` status, the system MUST make two artifacts downloadable:
- `dataset.json` — Pydantic-validated VLA training records
- `dataset.tfrecord` — TensorFlow RLDS-format bundle

**FR-4.2** Download access MUST be via short-lived Supabase Storage signed URLs (TTL ≤ 300 seconds), never direct S3/storage credentials.

**FR-4.3** `GET /api/job/:id/dataset` MUST require a valid job-scoped bearer token.

**FR-4.4** The system MUST support semantic similarity search over extracted skills via `POST /api/search`:
- Query takes free-text string
- Returns top-k (default 5) matching skill segments with similarity scores
- Backed by DINOv2 768-dimensional pgvector IVFFlat index

**FR-4.5** Search MUST be scoped to a single `job_id` — cross-job search is not a v3 requirement.

---

### FR-5 — Observability and Operability

**FR-5.1** Every job failure MUST produce a typed `failure_code` string stored in `processing_jobs.failure_code`. Engineers MUST be able to identify which agent failed without reading raw logs.

**FR-5.2** Every agent execution MUST be recorded in `agent_runs` with: `status`, `attempt`, `duration_ms`, `error_code`, `error_message`, `langsmith_trace_url`.

**FR-5.3** Every job status transition MUST be recorded in `job_events` with a `payload` JSONB containing the new status, agent name, and progress percent.

**FR-5.4** ALL LangGraph node executions MUST be traced in LangSmith with `LANGCHAIN_TRACING_V2=true`. Trace URL MUST be stored in `agent_runs.trace_url`.

**FR-5.5** All structured logs from Next.js API routes and Modal functions MUST include: `job_id`, `trace_id`, `service`, `event`, `duration_ms`, and `error_code` (if applicable).

---

## 2.2 Non-Functional Requirements (NFRs)

### Performance SLOs

| ID | Metric | Initial Target (Free-Tier Demo) | Scale Target (Paid) |
|---|---|---|---|
| SLO-1 | End-to-end job runtime (5-min video) | p50 ≤ 180s, p95 ≤ 300s | p95 ≤ 240s |
| SLO-2 | API response time (`/api/upload`, `/api/process`) | p95 ≤ 500ms | p95 ≤ 200ms |
| SLO-3 | Realtime event delivery latency | p95 ≤ 2000ms | p95 ≤ 500ms |
| SLO-4 | Storage signed URL generation | p95 ≤ 300ms | p95 ≤ 100ms |
| SLO-5 | Semantic search response time | p95 ≤ 800ms | p95 ≤ 200ms |

### Reliability SLOs

| ID | Metric | Target |
|---|---|---|
| SLO-6 | API availability | ≥ 99.5% (Vercel SLA) |
| SLO-7 | Job failure rate (pipeline errors) | < 10% of submitted jobs |
| SLO-8 | Data durability (final datasets) | ≥ 99.999% (Supabase Storage) |
| SLO-9 | Realtime delivery success rate | ≥ 99% (with polling fallback) |

### Throughput Constraints

| Parameter | Free-Tier Demo | Scale Target |
|---|---|---|
| Max concurrent jobs | 2 | 10+ |
| Max upload/hour (per IP) | 5 | 50 (with auth) |
| Max video size | 300MB | 1GB |
| Max video duration | 360s | Custom per tenant |

---

## 2.3 Global Configuration Parameters

All parameters live in `modal_backend/config.py` as `PipelineConfig` dataclass fields and in `lib/config.ts` for the Next.js side. They are **never hardcoded inline** — always referenced through the config module.

```python
# modal_backend/config.py  (authoritative)
@dataclass
class PipelineConfig:
    # ─── File Ingestion ───────────────────────────────────────────────────
    MAX_UPLOAD_BYTES: int = 314_572_800         # 300MB hard cap
    MAX_VIDEO_DURATION_SEC: int = 360           # 6 minutes hard cap
    VALID_CODECS: frozenset = frozenset(["h264", "h265", "vp9", "av1"])

    # ─── Video Agent ──────────────────────────────────────────────────────
    FRAME_SAMPLE_FPS: float = 1.0               # Extract 1 frame/sec
    KEYFRAMES_PER_MIN: int = 30                 # Max keyframes per minute
    DINOV2_MODEL: str = "dinov2_vitb14"         # 768-dim embeddings
    DINOV2_BATCH_SIZE: int = 32

    # ─── Quality Agent ────────────────────────────────────────────────────
    BLUR_LAPLACIAN_MIN: float = 100.0           # Below = blurry frame
    BRIGHTNESS_MIN: int = 20                    # Below = underlit
    BRIGHTNESS_MAX: int = 235                   # Above = overexposed
    OVEREXPOSED_RATIO_MAX: float = 0.15         # Max blown-pixel fraction
    MIN_CLEAN_FRAMES: int = 10                  # Below = job fails

    # ─── Perception Agent ─────────────────────────────────────────────────
    YOLOE_CONF_THRESHOLD: float = 0.25
    YOLOE_IOU_THRESHOLD: float = 0.45
    CONTACT_IOU_MIN: float = 0.15              # Hand-object overlap = contact

    # ─── Segmentation Agent ───────────────────────────────────────────────
    MASK_DELTA_THRESHOLD: float = 0.15         # Jaccard distance = boundary
    CONTACT_HYSTERESIS_FRAMES: int = 3         # Frames to confirm transition
    MIN_SEGMENT_DURATION_MS: int = 1500        # Merge shorter segments

    # ─── Action Agent ─────────────────────────────────────────────────────
    ACTION_CONFIDENCE_MIN: float = 0.40        # Below = Gemini fallback
    ACTION_FRAMES_PER_SEGMENT: int = 4         # Frames fed to EgoVLM
    MAX_UNKNOWN_ACTION_FRACTION: float = 0.50  # Above = FAILED_ACTION_AGENT

    # ─── Orchestration ────────────────────────────────────────────────────
    NODE_MAX_RETRIES: int = 3
    NODE_BACKOFF_BASE_SEC: int = 2
    NODE_BACKOFF_MAX_SEC: int = 30
    PIPELINE_MAX_RUNTIME_SEC: int = 900        # Global watchdog limit
    HEARTBEAT_TIMEOUT_SEC: int = 180           # Stale = stuck job
    MAX_CONCURRENT_JOBS: int = 2               # Free-tier safe default

CONFIG = PipelineConfig()
```

```typescript
// lib/config.ts  (Next.js side — mirrors server constants)
export const CONFIG = {
  MAX_UPLOAD_BYTES: 314_572_800,
  MAX_VIDEO_DURATION_SEC: 360,
  UPLOAD_TOKEN_TTL_MS: 15 * 60 * 1000,    // 15 min signed URL TTL
  JOB_TOKEN_TTL_HOURS: 24,
  DOWNLOAD_URL_TTL_SEC: 300,
  SEARCH_DEFAULT_TOP_K: 5,
  RATE_LIMITS: {
    upload:  { requests: 5,   window: '1 h' },
    process: { requests: 20,  window: '1 h' },
    search:  { requests: 120, window: '1 h' },
  },
  STATUS_TO_PROGRESS: {
    UPLOADED:                   0,
    QUEUED:                     2,
    VIDEO_AGENT_RUNNING:       10,
    QUALITY_AGENT_RUNNING:     22,
    PERCEPTION_AGENT_RUNNING:  35,
    SEGMENTATION_AGENT_RUNNING: 62,
    ACTION_AGENT_RUNNING:      72,
    TASK_GRAPH_AGENT_RUNNING:  86,
    DATASET_BUILDER_RUNNING:   94,
    COMPLETED:                100,
  },
} as const;
```

---

## 2.4 Acceptance Criteria

A job is considered **successfully completed** if ALL of these conditions hold:

```python
def is_valid_completed_job(job: ProcessingJob, manifest: DatasetManifest) -> bool:
    return (
        job.status == "COMPLETED"
        and job.completed_at is not None
        and (job.completed_at - job.started_at).total_seconds() <= 300   # ≤5 min
        and manifest.record_count > 0                                     # ≥1 VLA record
        and manifest.dataset_json_artifact_id is not None                 # JSON exists
        and manifest.dataset_rlds_artifact_id is not None                 # RLDS exists
        and job.failure_code is None                                      # No error
    )
```

A demo session is considered **successful** if:
1. Upload completes (video lands in Supabase Storage)
2. All 7 pipeline stepper steps turn green ✓
3. Task graph renders with ≥2 nodes in UI
4. Skill segments table shows ≥1 row
5. Download buttons return 200 with valid signed URLs

---

## 2.5 Edge Cases and Constraint Handling

| Scenario | Constraint | System Response |
|---|---|---|
| Video > 300MB | `MAX_UPLOAD_BYTES` | Client rejects before upload; 400 from server if bypassed |
| Video > 360s | `MAX_VIDEO_DURATION_SEC` | ffprobe check post-upload → `FAILED_VALIDATION` |
| Duplicate upload (same SHA-256) | `idempotency_key` UNIQUE index | Server returns existing `job_id` and token |
| 6th upload from same IP in 1 hour | Rate limit: 5/hr | 429 with `Retry-After` header |
| All video frames blurry/dark | `MIN_CLEAN_FRAMES = 10` | `FAILED_QUALITY_AGENT` with `ZERO_CLEAN_FRAMES` error code |
| User uploads .avi instead of .mp4 | Extension + MIME check | 400 `INVALID_FORMAT` before any storage write |
| Pipeline runs > 900s | `PIPELINE_MAX_RUNTIME_SEC` | Watchdog marks `FAILED_ORCHESTRATOR` with `GLOBAL_TIMEOUT` code |
| Token used after 24h | `expires_at` check | 401 `TOKEN_EXPIRED` |
| `MAX_CONCURRENT_JOBS` hit | Admission control | Queue job; return 202 with `queued` flag; UI shows "In Queue" state |

---
