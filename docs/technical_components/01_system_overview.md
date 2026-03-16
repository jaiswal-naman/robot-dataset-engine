# AutoEgoLab v3.0 — System Overview
**Document owner:** AI Systems Engineering  
**Revision:** 2.0 | **Date:** 2026-03-16 | **Status:** Build-Ready

---

## 1.1 Why This System Exists

AutoEgoLab exists to collapse one of the highest-friction bottlenecks in the embodied AI industry: **the gap between raw human video and structured robot training data**.

Today, building a dataset for a robot manipulation policy requires one of three expensive approaches:

| Approach | Cost | Problem |
|---|---|---|
| Human teleoperation | $200–$800/hr per demonstrator | Slow, physically constrained to hardware |
| Kinesthetic teaching | High hardware cost | Fails on complex dexterous tasks |
| Frame-by-frame manual annotation | $50–$200/hr per annotator | Doesn't scale; subjective; ambiguous |

AutoEgoLab eliminates all three by doing the following automatically:

1. A factory worker wears a head-mounted camera and performs normal work.
2. AutoEgoLab ingests the raw footage.
3. Seven specialized AI agents extract every meaningful signal: keyframes, object masks, hand poses, contact events, skill boundaries, semantic action labels, and hierarchical task structure.
4. The output is a validated, machine-trainable VLA (Vision-Language-Action) dataset ready for policy training frameworks like ALOHA or RT-X.

No human annotation. No special hardware. No scripted demonstrations.

---

## 1.2 Product Form: The Live Demo Platform

The v3 build is a **demonstration web application** deployed as a live URL. Its purpose is to prove the pipeline is real, working, and fast enough for production use.

**The experience:**
1. Interviewer opens the URL
2. Uploads any 5-minute factory egocentric video via drag-and-drop
3. Watches 7 AI agents process it in real-time with per-agent progress updates
4. Views the structured output: task graph (visualized as node/edge graph), skill segments (timestamped rows), action labels, quality metrics, and downloadable JSON + RLDS bundle

**Total time from upload to results: 3–5 minutes**

This is not a mock — all 7 models run on real GPU hardware (Modal.com), all outputs are stored in a real database (Supabase), and all updates arrive in real-time via WebSocket.

---

## 1.3 Problem Statement: Concrete and Precise

**Input constraints:**
- Format: `.mp4` video file
- Duration: up to 5 minutes (360 seconds)
- Max size: 300MB
- Perspective: first-person (egocentric), factory or workshop environment
- Content: a human worker performing multi-step physical tasks (e.g., assembly, packaging, maintenance)

**Output requirements:**
- `skill_segments[]` — timestamped boundaries of atomic skills detected in the video
- `actions[]` — per-segment semantic action labels with verb/object/tool decomposition
- `task_graph` — hierarchical DAG of task structure (goal → subtasks → atomic actions)
- `dataset.json` — Pydantic-validated structured training record
- `dataset.rlds` — TensorFlow RLDS-format bundle for direct policy training consumption
- `search_embeddings[]` — DINOv2 768-dimensional vectors for semantic skill retrieval

**Success condition (hard gate):**
```python
def is_successful_demo(job):
    return (
        job.status == "COMPLETED"
        and job.total_runtime_sec <= 300          # ≤5 min wall clock
        and job.dataset_manifest.record_count > 0  # at least 1 VLA record
        and job.task_graph is not None             # task graph generated
    )
```

---

## 1.4 Why Existing Approaches Fail

### Monolithic VLM Approaches (e.g., GPT-4V-only pipelines)
- A single large VLM cannot simultaneously handle: object detection, pixel-precise mask generation, hand mesh recovery, temporal boundary detection, AND high-level semantic reasoning.
- Quality degrades rapidly: hallucinated object names, missed contacts, incorrect action sequences.
- They operate at token level (text/image patches) and lack grounding in 3D geometry.
- They have no temporal awareness across hundreds of frames.

### Single-Step Annotation Pipelines
- No failure isolation: if one model fails (e.g., on an overexposed frame), the entire pipeline corrupts output.
- No retry semantics: can't recover from transient GPU failures.
- Lack structured schemas: outputs are free-text, not parseable VLA records.

### Offline Batch Systems (e.g., Hugging Face dataset pipelines)
- Run overnight; no real-time visibility.
- Cannot demonstrate end-to-end automation to non-technical stakeholders.
- Not suitable for demo/interview contexts.

### AutoEgoLab's Design Response
AutoEgoLab is architecturally designed to defeat each failure mode:

| Failure Mode | AutoEgoLab Solution |
|---|---|
| VLM hallucination | Specialized models per task (YOLOE for detection, HaWoR for hand pose, DINOv2 for embedding) |
| No failure isolation | 7 isolated agents, each with typed retry policy and failure status |
| No real-time visibility | Supabase Realtime pushes WebSocket events to UI per agent transition |
| Slow batch offline processing | Modal serverless GPU spins up instantly; full pipeline in <5min |
| Unstructured output | Pydantic v2 enforced schemas at every stage boundary |

---

## 1.5 System Component Responsibilities

### Next.js 15 (Vercel)
- Serves the public frontend (landing, demo, library, coverage pages)
- Acts as the **API facade** — exposes 5 REST endpoints to the browser
- Validates uploads, mints job-scoped bearer tokens, issues Supabase signed upload URLs
- Triggers the Modal pipeline via authenticated webhook
- **Does NOT hold privileged credentials client-side** — service role key lives only in API routes

### Supabase (Postgres + Storage + Realtime + pgvector)
- **Single source of truth** for all job state
- `processing_jobs` table drives the job FSM (Finite State Machine)
- Storage buckets hold raw video, extracted frames, intermediate JSONs, final datasets
- `pgvector` with IVFFlat index enables semantic search over 768-dim DINOv2 embeddings
- Realtime broadcasts `processing_jobs` row changes to subscribed browser clients
- Row Level Security (RLS) ensures all table access is service-role-only by default

### Modal.com (GPU Compute)
- Runs the LangGraph pipeline as an HTTP webhook receiver
- Provisions GPU resources per-agent:
  - **T4 (16GB):** DINOv2, YOLOE-26x-seg, SAM 2.1
  - **A10G (24GB):** HaWoR, EgoVLM-3B, Qwen3-VL-8B fallback
  - **CPU:** Video decoding, Quality filtering, Segmentation, Dataset building
- GPU containers spin to zero when idle; no infrastructure cost at rest
- Deployment: `modal deploy modal_backend/app.py`

### LangGraph 0.3 (Orchestration)
- Implements the 7-agent pipeline as a typed stateful directed graph
- Graph nodes correspond to agents
- State schema (`PipelineState`) flows through the graph — carries only references (UUIDs, URIs), never raw byte payloads
- Handles parallel execution of Perception sub-branches (object, mask, hand in parallel)
- Retry logic via `tenacity` — 3 attempts with exponential jitter backoff

### Gemini 3.1 Pro API (Reasoning)
- **Task Graph Agent:** primary model — converts ordered action records into a structured hierarchical DAG. Called with `thinking_budget=4096` for deep reasoning.
- **Action Agent fallback:** triggered when EgoVLM-3B confidence < 0.40
- All Gemini calls are schema-constrained via `instructor` library (Pydantic output parsing)
- Rate limit handling: exponential backoff with `tenacity`, typed failure on 3rd failed retry

### LangSmith (Observability)
- Every LangGraph node execution is traced automatically via LangChain integration
- Trace URL stored in `agent_runs.trace_url` column
- Enables replay debugging: open trace → see exact inputs/outputs for any model call

---

## 1.6 Vision-Level Data Flow

```
Browser
  │
  │  1. POST /api/upload
  ▼
Next.js API Route (Vercel)
  │  Validates file metadata. Creates processing_jobs row (status=UPLOADED).
  │  Mints job_access_token. Returns signed upload URL.
  │
  │  2. Client PUT video → Supabase Storage (raw-videos bucket)
  ▼
Supabase Storage
  │  File stored at:  jobs/{job_id}/RAW_VIDEO/v1/input.mp4
  │
  │  3. POST /api/process
  ▼
Next.js API Route (Vercel)
  │  Updates job status → QUEUED
  │  Sends signed webhook POST to Modal endpoint
  │
  │  4. Modal receives webhook
  ▼
Modal (LangGraph Pipeline)
  │  Runs 7 agents sequentially (with parallel Perception sub-branches)
  │  Each agent:
  │    - Reads artifacts from Supabase Storage
  │    - Runs model inference on GPU
  │    - Writes output artifacts to Supabase Storage
  │    - Writes domain rows to Postgres (segments, actions, graphs etc.)
  │    - Updates processing_jobs.status
  │    - Appends job_events row
  │
  │  5. Supabase Realtime (Postgres CDC) emits row change events
  ▼
Browser WebSocket (Supabase Realtime client)
  │  Receives job_status_updated event
  │  Updates Zustand store → PipelineTracker renders new step as active
  │
  │  6. On COMPLETED status
  ▼
ResultsTabs (UI)
     Shows TaskGraphView, SkillSegmentsTable, ActionTimeline, DownloadPanel
     Search enabled via POST /api/search
```

---

## 1.7 Technology Interaction Matrix

| From | To | Protocol | Data |
|---|---|---|---|
| Browser | Next.js API | HTTPS REST | JSON request/response |
| Browser | Supabase Storage | HTTPS PUT (signed) | MP4 binary |
| Browser | Supabase Realtime | WebSocket | JSON events |
| Next.js API | Supabase Postgres | Supabase JS SDK (HTTP) | SQL queries via service role |
| Next.js API | Supabase Storage | Supabase JS SDK (HTTP) | Signed URLs |
| Next.js API | Modal | HTTPS POST (signed secret) | JSON `{job_id, trace_id}` |
| Modal | Supabase Postgres | Supabase Python SDK (HTTP) | Agent writes via service role |
| Modal | Supabase Storage | Supabase Python SDK (HTTP) | Download/upload artifacts |
| Modal | Gemini API | HTTPS | JSON prompt + response |
| Modal | LangSmith | HTTPS | Trace telemetry |

---

## 1.8 Scalability Posture

### Free-Tier Baseline (v3 Demo)
- `MAX_CONCURRENT_JOBS = 2`
- `MAX_UPLOAD_BYTES = 300MB`
- `MAX_VIDEO_DURATION_SEC = 360`
- GPU pool limited by Modal free credit ($30/mo)
- Supabase storage: 1GB bucket quota
- Gemini: 250 requests/day free tier

### Paid-Scale Path (Production)
- Increase `MAX_CONCURRENT_JOBS` → 10+ via paid Modal plan
- Add Upstash Redis for API-level queue and rate counter
- Move to Supabase Pro for 8GB+ storage and DB replicas
- Activate Gemini paid API key with budget limit enforcement

### Upgrade Triggers
| Metric | Threshold | Action |
|---|---|---|
| Queue wait p95 | > 60s for 3 days | Increase Modal GPU pool |
| Storage used | > 70% of quota | Move to Supabase Pro or archive |
| Gemini 429 rate | > 5% of requests | Activate paid API key |
| API p95 latency | > 500ms at 10 RPS | Add Redis caching + DB replicas |

---

## 1.9 Critical Edge Cases

| Edge Case | Detection | Handling |
|---|---|---|
| Video too dark/overexposed | Quality Agent brightness filter | Emit `degraded=true` flag; continue with reduced frame set |
| Upload completes but process trigger fails | `processing_jobs.status = UPLOADED` with no `queued_at` after N minutes | Idempotent `/api/process` can be retried; watchdog detects stuck UPLOADED state |
| Partial pipeline output (e.g., RLDS writer fails, JSON succeeds) | Dataset Builder checks both artifact IDs | Persist JSON, mark `warnings` in manifest, mark COMPLETED with partial flag |
| Browser closes mid-run | N/A — pipeline runs server-side | User revisits `/demo/{jobId}` — UI polls GET /api/job/:id and restores state |
| Duplicate upload clicks | `idempotency_key` unique constraint on `processing_jobs` | Second upload returns existing `job_id` and token |
| Gemini rate limit (429) | tenacity retry catches HTTP 429 | Exponential backoff up to 3 retries; if all fail → `FAILED_TASK_GRAPH_AGENT` |

---
