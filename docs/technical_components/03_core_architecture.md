# AutoEgoLab v3.0 — Core System Architecture
**Document owner:** AI Systems Engineering  
**Revision:** 2.0 | **Date:** 2026-03-16 | **Status:** Build-Ready

---

## 3.1 Architecture Overview

AutoEgoLab is a **6-layer distributed system**. Each layer has a single, well-defined responsibility and communicates with adjacent layers via explicit, authenticated protocols.

```
┌──────────────────────────────────────────────────────────────────┐
│  LAYER 1: Frontend                                               │
│  Next.js 15 App Router on Vercel                                 │
│  Pages + Upload UX + Real-time Pipeline Tracker + Results UI     │
│  Holds NO privileged credentials                                 │
└──────────────┬───────────────────────────┬───────────────────────┘
               │ HTTPS REST                │ WebSocket
               ▼                           ▼
┌──────────────────────┐       ┌───────────────────────────────────┐
│  LAYER 2: API Facade │       │  LAYER 5: Real-time Event System  │
│  Next.js API Routes  │       │  Supabase Realtime (Postgres CDC) │
│  on Vercel Edge/Node │       │  Broadcasts job row changes       │
│  Rate limit | Auth   │       │  WebSocket to browser clients     │
│  Route to Modal/DB   │       └───────────────────────────────────┘
└──────┬───────────────┘
       │ HTTPS (signed bearer)
       ▼
┌──────────────────────────────────────────────────────────────────┐
│  LAYER 3: AI Compute                                             │
│  Modal.com Serverless GPU + LangGraph 0.3                        │
│  7 agents on CPU/T4/A10G resources                               │
│  Orchestrates retries, timeouts, parallel branches               │
└──────────────┬───────────────────────────────────────────────────┘
               │ Supabase Python SDK (HTTPS)
               ▼
┌──────────────────────────────────────────────────────────────────┐
│  LAYER 4: Data Storage                                           │
│  Supabase PostgreSQL 16 + pgvector + Object Storage              │
│  Canonical job state | Domain rows | Artifact blobs              │
└──────────────────────────────────────────────────────────────────┘
               │ External HTTPS
               ▼
┌──────────────────────────────────────────────────────────────────┐
│  LAYER 6: External AI APIs                                       │
│  Gemini 3.1 Pro (task graph + action fallback)                   │
│  LangSmith (tracing)                                             │
└──────────────────────────────────────────────────────────────────┘
```

---

## 3.2 Layer Responsibilities — Detailed

### Layer 1: Frontend (Next.js App Router on Vercel)

**What it does:**
- Serves all public pages: landing, demo, library, coverage
- Manages the video file upload UX (drag-and-drop, progress bar, validation)
- Subscribes to Supabase Realtime and renders the 7-step pipeline tracker
- Displays results: task graph (React Flow), skill segments table, action timeline, download panel
- Stores `job_id` + `job_access_token` in `localStorage` for session recovery

**What it must NEVER do:**
- Hold `SUPABASE_SERVICE_ROLE_KEY` in any client-accessible code (env vars without `NEXT_PUBLIC_` prefix are server-only in Next.js)
- Hold `MODAL_WEBHOOK_SECRET` or `JOB_TOKEN_SIGNING_SECRET`
- Route raw video bytes through Vercel (would hit 4.5MB body limit)

**Key files:**
- `app/demo/page.tsx` — client component that orchestrates the full demo experience
- `components/demo/PipelineTracker.tsx` — 7-step visual stepper
- `lib/realtime/useJobRealtime.ts` — Realtime subscription + polling fallback hook

---

### Layer 2: API Facade (Next.js API Routes on Vercel Node Runtime)

**What it does:**
- Receives and validates API requests from the browser
- Mints job-scoped bearer tokens (HMAC-SHA256 over `JOB_TOKEN_SIGNING_SECRET`)
- Generates Supabase Storage signed upload URLs (via service-role client)
- Validates job tokens on every protected endpoint
- Applies IP-level rate limiting via Upstash Redis
- Sends authenticated webhook trigger to Modal

**What it must NEVER do:**
- Make direct model inference calls (that's Layer 3's job)
- Return raw database rows directly — always project to clean response types
- Accept unauthenticated calls to protected endpoints

**Security posture:** This is the most security-critical layer. Every inbound request is untrusted until explicitly validated. Rate limits, input validation, and token checks are mandatory on every route.

**Key files:**
- `app/api/upload/route.ts` — POST /api/upload
- `app/api/process/route.ts` — POST /api/process  
- `app/api/job/[id]/route.ts` — GET /api/job/:id
- `app/api/job/[id]/dataset/route.ts` — GET /api/job/:id/dataset
- `app/api/search/route.ts` — POST /api/search
- `lib/supabase/server.ts` — `createServiceClient()` — service role, never exposed to browser

---

### Layer 3: AI Compute (Modal + LangGraph)

**What it does:**
- Receives webhook trigger from Layer 2 (signed bearer secret)
- Instantiates the LangGraph `PipelineState` with `{job_id, trace_id}`
- Executes all 7 agent nodes in the compiled graph
- Manages GPU resource provisioning per agent (T4/A10G/CPU)
- Handles retries, timeouts, heartbeat updates
- Writes all artifacts and domain rows to Layer 4 via Supabase Python SDK

**Why Modal instead of AWS Lambda or GCP Cloud Run:**
- Lambda has 15-min max timeout (pipeline can take up to 15min on cold GPUs) — too tight
- Lambda has no GPU support without ECS/Fargate — complex to manage
- Modal provides dedicated GPU container per function with configurable VRAM
- Modal's Python SDK is minimal — no Dockerfile needed, dependencies declared inline
- Modal bills per GPU-second, not per container-hour → zero cost at rest
- Cold start for Modal GPU containers is ~5-10s, acceptable given we show "QUEUED" state

**Key files:**
- `modal_backend/app.py` — Modal app with webhook endpoint + function decorators
- `modal_backend/pipeline.py` — LangGraph graph + `execute_pipeline()` entrypoint
- `modal_backend/agents/*.py` — One file per agent

---

### Layer 4: Data Storage (Supabase)

**What it does:**
- **PostgreSQL 16:** canonical state for all jobs, artifacts, domain data, tokens, events, agent runs
- **pgvector:** IVFFlat index on `search_embeddings.embedding` (768-dim DINOv2 vectors)
- **Object Storage:** 5 private buckets for raw video, frames, intermediate JSONs, datasets, thumbnails
- **Row Level Security (RLS):** All tables have RLS enabled. Service-role key bypasses RLS (used by API and Modal). Anonymous/anon key is never used for Postgres writes.
- **Realtime publication:** `processing_jobs`, `agent_runs`, `job_events` are in the `supabase_realtime` publication set

**Everything is private by default.** No storage bucket has `public = true`. Clients always access artifacts via time-limited signed URLs issued by the API layer.

---

### Layer 5: Real-time Event System (Supabase Realtime)

**What it does:**
- Listens to Postgres Write-Ahead Log (WAL) via Change Data Capture (CDC)
- Broadcasts `UPDATE` events on `processing_jobs` to subscribed WebSocket channels
- Browser client filters by `id=eq.{jobId}` — only receives its own job's events
- No polling needed on the happy path — events arrive within ~500ms of a status write

**Why this instead of Server-Sent Events or long-polling:**
- SSE requires an open HTTP connection per user on Vercel — costs money at scale
- Long-polling adds 1-5s latency per cycle — too slow for "live" feel
- Supabase Realtime uses existing WebSocket infrastructure — zero additional infra

**Fallback:** If the WebSocket channel errors (`CHANNEL_ERROR` event), the `useJobRealtime` hook automatically starts polling `GET /api/job/:id` every 5 seconds. This is transparent to the user — the UI continues updating.

---

### Layer 6: External AI APIs

**Gemini 3.1 Pro:**
- Task Graph Agent: converts ordered action records into hierarchical DAG (primary model)
- Action Agent: fallback when EgoVLM-3B confidence < 0.40
- Called via `google-generativeai` SDK with `instructor` for structured output parsing
- All calls have 3-retry exponential backoff via `tenacity`

**LangSmith:**
- Receives automatic traces from LangGraph node executions
- Requires `LANGCHAIN_TRACING_V2=true` and `LANGCHAIN_API_KEY` in Modal environment
- Trace URL stored in `agent_runs.trace_url` for post-hoc debugging
- Tracing is **best-effort** — failures in LangSmith must never block the pipeline

---

## 3.3 Trust Boundaries and Security Model

```
Internet (untrusted)
    │
    │  [Boundary A] — All requests rate-limited and validated
    ▼
Vercel API Routes (semi-trusted)
    │  Holds service-role key — server-only, never in client bundle
    │
    │  [Boundary B] — Supabase service-role via HTTPS
    ▼
Supabase (trusted data store)
    │
    │  [Boundary C] — Signed bearer secret + HMAC webhook auth
    ▼
Modal (trusted compute)
    │
    │  [Boundary D] — Google API key, rate-limited, retry-budgeted
    ▼
Gemini API (external, untrusted output — always parsed via Pydantic)

Browser ←── WebSocket ──── Supabase Realtime
    [Boundary E] — Anon key only, RLS enforces read isolation
```

**Trust boundary rules:**
- **A:** Every request from the internet is untrusted. Rate limit first, validate body second, check token third.
- **B:** Service-role key MUST only exist in Vercel's encrypted environment variables and Modal secrets. Never in `NEXT_PUBLIC_*` variables. Never in the client bundle (`npx @next/bundle-analyzer` must show service role key is absent).
- **C:** Modal webhook always requires `Authorization: Bearer MODAL_WEBHOOK_SECRET`. Requests without it get a 401 immediately.
- **D:** Gemini responses are always parsed through `instructor` (Pydantic). Raw Gemini text is never directly used as data — only after schema validation.
- **E:** Supabase Realtime uses the anon key from the browser. RLS on `processing_jobs` ensures: anon key + Realtime = read-only, job-scoped, Postgres-enforced.

---

## 3.4 Core Request Flow — Annotated Sequence

```
1. Browser: POST /api/upload (file metadata + SHA-256)
      │
2. Vercel API: rate limit check → validate body → create processing_jobs row
              → mint job token → generate signed upload URL → return 201
      │
3. Browser: PUT video → Supabase Storage signed URL (direct, bypasses Vercel)
      │
4. Browser: POST /api/process (job_id + bearer token)
      │
5. Vercel API: validate token → transition job to QUEUED → POST → Modal webhook
      │
6. Modal: validate webhook secret → spawn execute_pipeline() asynchronously
   └── Returns 200 immediately so Vercel doesn't timeout
      │
7. Modal Pipeline (async, up to 900s):
   ├── Each agent: download inputs from Storage → inference → upload outputs → write DB rows → update status
   └── Each status update triggers Supabase Realtime CDC event
      │
8. Supabase Realtime: broadcasts `processing_jobs` UPDATE to subscribed browser channel
      │
9. Browser: receives Realtime event → updateJobStatus() in Zustand → PipelineTracker re-renders
      │
10. On COMPLETED: Browser fetches results data → renders ResultsTabs
```

---

## 3.5 Why These Technologies — Decision Matrix

| Requirement | Considered Options | Chosen | Reason |
|---|---|---|---|
| Frontend framework | Next.js, Remix, SvelteKit | **Next.js 15** | App Router + API routes in one repo; Vercel deployment is one-line |
| GPU compute | AWS Lambda+ECS, GCP Cloud Run, Modal | **Modal** | Native GPU, zero infra config, per-second billing, free tier |
| Pipeline orchestration | Celery, Prefect, Airflow, LangGraph | **LangGraph** | Typed stateful graph, built-in parallel branches, LangSmith auto-tracing |
| Database | PlanetScale, Neon, Supabase | **Supabase** | Postgres + pgvector + Storage + Realtime in one product; generous free tier |
| Real-time updates | SSE, WebSockets (custom), Pusher, Supabase Realtime | **Supabase Realtime** | Built-in, no extra infra; Postgres CDC is the source of truth |
| Semantic search | Pinecone, Weaviate, pgvector | **pgvector** | Already in Supabase; no additional service; 768-dim sufficient for demo scale |
| AI reasoning | Claude, GPT-4o, Gemini | **Gemini 3.1 Pro** | Thinking budget mode for deep task graph reasoning; strong structured output |

---

## 3.6 Component Interaction Summary Table

| Component A | → | Component B | Protocol | Data Transferred | Auth |
|---|---|---|---|---|---|
| Browser | → | Next.js API | HTTPS REST | JSON | None (upload) / Bearer token |
| Browser | → | Supabase Storage | HTTPS PUT | MP4 video bytes | Signed URL |
| Browser | → | Supabase Realtime | WebSocket | JSON events | Anon key |
| Next.js API | → | Supabase Postgres | Supabase JS SDK | SQL (service role) | Service role key |
| Next.js API | → | Supabase Storage | Supabase JS SDK | Signed URL generation | Service role key |
| Next.js API | → | Modal webhook | HTTPS POST | `{job_id, trace_id}` | Bearer secret |
| Modal | → | Supabase Postgres | Supabase Python SDK | SQL (service role) | Service role key |
| Modal | → | Supabase Storage | Supabase Python SDK | File up/download | Service role key |
| Modal | → | Gemini API | HTTPS | JSON prompt + response | API key |
| Modal | → | LangSmith | HTTPS | Trace telemetry | API key |
| Supabase Realtime | → | Browser | WebSocket | `processing_jobs` row diffs | Anon key |

---

## 3.7 Scalability Posture

### Horizontal Scale Axes

| Layer | Scale Mechanism | Trigger |
|---|---|---|
| API Routes (Vercel) | Auto-scale (Vercel managed) | Request volume |
| Modal GPU Workers | Increase `concurrency_limit` per function | Queue depth / job SLA |
| Supabase DB | Read replicas (Supabase Pro) | DB p95 query latency > 50ms |
| Supabase Storage | Automatic (S3-backed) | Storage usage |
| pgvector search | Increase IVFFlat `nlist` + `nprobe` | Search latency > 500ms |
| Rate Limiter (Upstash Redis) | Auto-scale (Upstash managed) | Throughput |

### What Does NOT Scale Horizontally (by design)
- `PipelineState` — lives in-process in Modal; stateless by design (all durable data in Supabase)
- LangGraph graph — compiled once at import time; stateless across invocations

---
