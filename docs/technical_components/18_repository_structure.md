# AutoEgoLab v3.0 — Repository Structure & File Map
**Document owner:** AI Systems Engineering  
**Revision:** 2.0 | **Date:** 2026-03-16 | **Status:** Build-Ready

---

## Repository Root

```
autoegolab/
├── .github/
│   └── workflows/
│       └── ci.yml                    # CI: typecheck + lint + build + e2e + modal deploy
├── app/                              # Next.js 15 App Router pages + API routes
├── components/                       # React UI components (grouped by page)
├── lib/                              # Shared utilities, API clients, hooks
├── types/                            # Shared TypeScript types and Zod schemas
├── modal_backend/                    # Python modal.com pipeline (serverless GPU backend)
├── supabase/                         # Database migrations and seeding scripts
├── tests/                            # All tests: unit, integration, E2E, load
├── docs/                             # Engineering documentation (this directory)
│   ├── technical_components/         # Per-component deep-dive docs
│   └── runbooks/                     # Operational runbooks
├── .env.example                      # Template for .env.local
├── .env.local                        # Local secrets (NEVER committed)
├── next.config.ts                    # Next.js configuration
├── tsconfig.json                     # TypeScript configuration
├── package.json
├── package-lock.json
├── requirements.txt                  # Python dependencies for modal_backend
├── PRD_v3.md                         # Product Requirements Document
└── engineering_blueprint_v3.md       # Master engineering blueprint
```

---

## `app/` — Next.js App Router

```
app/
├── layout.tsx                        # Root layout: fonts, providers, global styles
├── globals.css                       # Global CSS variables, reset, base styles
├── page.tsx                          # Landing page (/)
│
├── demo/
│   ├── page.tsx                      # New demo session (/demo)
│   └── [jobId]/
│       └── page.tsx                  # Resumable job view (/demo/[jobId])
│
├── library/
│   └── page.tsx                      # Skill library with semantic search (/library)
│
├── coverage/
│   └── page.tsx                      # Analytics dashboard (/coverage)
│
└── api/
    ├── upload/
    │   └── route.ts                  # POST /api/upload — job init + signed URL
    ├── process/
    │   └── route.ts                  # POST /api/process — pipeline trigger
    ├── job/
    │   └── [id]/
    │       ├── route.ts              # GET /api/job/:id — status polling
    │       └── dataset/
    │           └── route.ts          # GET /api/job/:id/dataset — download URLs
    └── search/
        └── route.ts                  # POST /api/search — semantic similarity search
```

### Key App Files

**`app/layout.tsx`**
```tsx
import { Inter, JetBrains_Mono } from 'next/font/google';
import { Providers } from '@/components/Providers';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' });

export const metadata = {
  title: 'AutoEgoLab — Autonomous Robotics Data Pipeline',
  description: 'Transform egocentric factory video into structured VLA training datasets with 7 AI agents. Zero annotation. 5 minutes.',
  openGraph: {
    title: 'AutoEgoLab v3.0',
    description: 'Autonomous robot training data from factory video',
    url: 'https://autoegolab.vercel.app',
    siteName: 'AutoEgoLab',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body className="bg-[#0f0f13] text-white antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

**`app/globals.css`**
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --color-bg:        #0f0f13;
  --color-surface:   #1a1a22;
  --color-border:    rgba(255, 255, 255, 0.08);
  --color-accent:    #6366f1;
  --color-success:   #10b981;
  --color-error:     #ef4444;
  --color-warning:   #f59e0b;
  --font-body:       var(--font-inter);
  --font-mono:       var(--font-mono);
}

@layer components {
  .btn-primary {
    @apply inline-flex items-center justify-center
           rounded-xl px-6 py-3 font-semibold
           bg-indigo-600 hover:bg-indigo-500
           text-white transition-all duration-200
           shadow-lg shadow-indigo-900/30
           hover:shadow-indigo-700/40 hover:-translate-y-0.5;
  }
  
  .glass-card {
    @apply rounded-2xl border border-white/[0.06]
           bg-white/[0.03] backdrop-blur-sm
           p-6 shadow-xl;
  }
}
```

---

## `components/` — React UI Components

```
components/
├── Providers.tsx                     # React Query + Zustand hydration wrapper
│
├── landing/
│   ├── NavBar.tsx                    # Site navigation bar
│   ├── HeroSection.tsx               # Hero headline + CTA
│   ├── HowItWorksSection.tsx         # 3-step process cards
│   ├── AgentsSection.tsx             # 7 agent showcase grid
│   ├── SampleOutputSection.tsx       # Static preview of results
│   ├── TechStackSection.tsx          # Model/infra logo row
│   └── FooterSection.tsx             # Links and credits
│
├── demo/
│   ├── UploadZone.tsx                # Drag-and-drop video file input
│   ├── UploadProgressBar.tsx         # XHR upload progress (0-100%)
│   ├── PipelineTracker.tsx           # 7-step vertical stepper
│   ├── PipelineStep.tsx              # Individual step card
│   ├── ElapsedTimer.tsx              # Live elapsed time counter
│   ├── ResultsTabs.tsx               # Tabs: Graph / Segments / Actions / Download
│   ├── TaskGraphView.tsx             # React Flow + Dagre interactive graph
│   ├── SkillSegmentsTable.tsx        # Timestamped segments table
│   ├── ActionTimeline.tsx            # Chronological action records
│   ├── DownloadPanel.tsx             # JSON + RLDS download buttons
│   └── ErrorBanner.tsx               # Failure banner with error code
│
├── library/
│   ├── SearchBar.tsx                 # Semantic search input
│   ├── SearchResults.tsx             # Paginated results grid
│   └── SkillCard.tsx                 # Individual skill result card
│
└── ui/
    ├── Badge.tsx                     # Status/type badge component
    ├── Spinner.tsx                   # Loading spinner variants
    ├── Skeleton.tsx                  # Content placeholder skeletons
    ├── Tooltip.tsx                   # Hover tooltip
    └── Modal.tsx                     # Generic modal/dialog wrapper
```

---

## `lib/` — Shared Client Utilities

```
lib/
├── supabase/
│   ├── client.ts                     # createBrowserClient() — anon key, browser
│   └── server.ts                     # createServiceClient() — service role, server only
│
├── api/
│   ├── upload.ts                     # uploadVideo (XHR with progress), SHA256 hash
│   ├── job.ts                        # fetchJob, pollJob, triggerProcess
│   ├── dataset.ts                    # fetchDatasetDownloads
│   └── search.ts                     # searchSkills (semantic)
│
├── realtime/
│   ├── subscribe.ts                  # Raw Supabase Realtime channel setup
│   └── useJobRealtime.ts             # React hook wrapping Realtime + polling fallback
│
├── store.ts                          # Zustand store (session + job + results)
│
├── hooks/
│   ├── useElapsedTimer.ts            # Hook returning elapsed seconds since start
│   ├── useJobSession.ts              # Restore job session from localStorage
│   └── useMediaQuery.ts             # Responsive breakpoint hook
│
└── utils/
    ├── format.ts                     # formatElapsed, formatBytes, formatTimestamp
    ├── errors.ts                     # ApiError class, error code constants
    └── crypto.ts                     # computeFileSha256, bearerToken helpers
```

---

## `types/` — TypeScript Type Definitions

```
types/
├── database.ts                       # Auto-generated Supabase database types
│                                     # (generated with: npx supabase gen types typescript)
├── api.ts                            # API request/response interfaces
│                                     # UploadRequest, UploadResponse, ProcessRequest, etc.
├── job.ts                            # JobStatus enum, JobStatusEvent, ProcessingJob
├── pipeline.ts                       # AgentName, PipelineStep, StepState
├── results.ts                        # SkillSegment, ActionRecord, TaskGraph, VLARecord
└── index.ts                          # Re-exports all types
```

**`types/job.ts`** (example):
```typescript
export type JobStatus =
  | 'UPLOADED'
  | 'QUEUED'
  | 'VIDEO_AGENT_RUNNING'
  | 'QUALITY_AGENT_RUNNING'
  | 'PERCEPTION_AGENT_RUNNING'
  | 'SEGMENTATION_AGENT_RUNNING'
  | 'ACTION_AGENT_RUNNING'
  | 'TASK_GRAPH_AGENT_RUNNING'
  | 'DATASET_BUILDER_RUNNING'
  | 'COMPLETED'
  | 'FAILED_VALIDATION'
  | 'FAILED_VIDEO_AGENT'
  | 'FAILED_QUALITY_AGENT'
  | 'FAILED_PERCEPTION_AGENT'
  | 'FAILED_SEGMENTATION_AGENT'
  | 'FAILED_ACTION_AGENT'
  | 'FAILED_TASK_GRAPH_AGENT'
  | 'FAILED_DATASET_BUILDER'
  | 'FAILED_ORCHESTRATOR'
  | 'CANCELLED'
  | 'EXPIRED';

export interface JobStatusEvent {
  status: JobStatus;
  progressPercent: number;
  currentAgent: string | null;
  failureCode: string | null;
}

export interface ProcessingJob {
  id: string;
  trace_id: string;
  status: JobStatus;
  progress_percent: number;
  current_agent: string | null;
  queued_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  failure_code: string | null;
}
```

---

## `modal_backend/` — Python AI Pipeline

```
modal_backend/
├── app.py                            # Modal app: webhook endpoint + GPU function defs
├── pipeline.py                       # LangGraph graph assembly + execute_pipeline()
├── config.py                         # PipelineConfig dataclass (tunable parameters)
│
├── agents/
│   ├── base.py                       # BaseAgent ABC + shared upload/download methods
│   ├── video_agent.py                # Agent 1: ffmpeg decode + DINOv2 + k-medoids
│   ├── quality_agent.py              # Agent 2: Laplacian blur + brightness filter
│   ├── perception_object.py          # Agent 3a: YOLOE-26x-seg detection
│   ├── perception_mask.py            # Agent 3b: SAM 2.1 mask tracking
│   ├── perception_hand.py            # Agent 3c: HaWoR hand pose recovery
│   ├── perception_merge.py           # Agent 3d: Contact fusion + merge
│   ├── segmentation_agent.py         # Agent 4: Dual-signal boundary detection
│   ├── action_agent.py               # Agent 5: EgoVLM-3B + Gemini fallback
│   ├── task_graph_agent.py           # Agent 6: Gemini task DAG synthesis
│   └── dataset_builder.py            # Agent 7: VLA record assembly + RLDS export
│
├── schemas/
│   ├── pipeline_state.py             # PipelineState TypedDict
│   ├── vla_dataset.py                # VLARecord, VLADataset Pydantic models
│   ├── task_graph.py                 # TaskGraph, TaskNode, TaskEdge Pydantic models
│   └── agent_results.py              # AgentResult, QualityMetrics Pydantic models
│
├── utils/
│   ├── supabase_client.py            # create_supabase_service_client()
│   ├── artifact_helpers.py           # upload_artifact, download_artifact
│   ├── rle_codec.py                  # mask_to_rle, rle_to_mask
│   ├── rlds_writer.py                # build_rlds_bundle()
│   ├── graph_layout.py               # DAG layout helper for task graph nodes
│   └── timing.py                     # now_iso(), now_utc(), parse_iso()
│
└── tests/
    ├── conftest.py                    # pytest fixtures: mock Supabase, test video clips
    ├── test_video_agent.py
    ├── test_quality_agent.py
    ├── test_perception_agent.py
    ├── test_segmentation_agent.py
    ├── test_action_agent.py
    ├── test_task_graph_agent.py
    ├── test_dataset_builder.py
    └── test_full_pipeline.py          # End-to-end with real 30s test clip
```

---

## `supabase/` — Database Migrations

```
supabase/
├── migrations/
│   ├── 0001_init.sql                 # Core tables: enums + processing_jobs + job_tokens
│   │                                 # + job_events + agent_runs + artifacts
│   ├── 0002_domain_tables.sql        # skill_segments + actions + task_graphs
│   │                                 # + dataset_manifests + search_embeddings
│   ├── 0003_indexes.sql              # All indexes: job lookups + vector IVFFlat
│   ├── 0004_rls.sql                  # Row Level Security policies
│   └── 0005_functions.sql            # PostgreSQL functions: search_job_embeddings RPC
│
└── seeds/
    ├── 000_demo_job.sql              # Seed a completed demo job for testing
    └── 001_sample_embeddings.sql     # Pre-computed embeddings for search demo
```

### `0001_init.sql` key content:
```sql
-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- Enums
CREATE TYPE job_status AS ENUM (
  'UPLOADED', 'QUEUED',
  'VIDEO_AGENT_RUNNING', 'QUALITY_AGENT_RUNNING',
  'PERCEPTION_AGENT_RUNNING', 'SEGMENTATION_AGENT_RUNNING',
  'ACTION_AGENT_RUNNING', 'TASK_GRAPH_AGENT_RUNNING',
  'DATASET_BUILDER_RUNNING', 'COMPLETED',
  'FAILED_VALIDATION', 'FAILED_VIDEO_AGENT', 'FAILED_QUALITY_AGENT',
  'FAILED_PERCEPTION_AGENT', 'FAILED_SEGMENTATION_AGENT',
  'FAILED_ACTION_AGENT', 'FAILED_TASK_GRAPH_AGENT',
  'FAILED_DATASET_BUILDER', 'FAILED_ORCHESTRATOR',
  'CANCELLED', 'EXPIRED'
);

-- Main jobs table
CREATE TABLE public.processing_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_id TEXT NOT NULL UNIQUE,
  status job_status NOT NULL DEFAULT 'UPLOADED',
  current_agent TEXT,
  progress_percent SMALLINT NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
  idempotency_key TEXT UNIQUE,
  input_bucket TEXT NOT NULL,
  input_object_key TEXT NOT NULL,
  video_duration_sec NUMERIC,
  queued_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  failure_code TEXT,
  failure_details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_jobs_updated_at
  BEFORE UPDATE ON public.processing_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

### `0005_functions.sql` — pgvector search:
```sql
CREATE OR REPLACE FUNCTION search_job_embeddings(
  p_job_id UUID,
  p_query_embedding vector(768),
  p_top_k INT DEFAULT 5
)
RETURNS TABLE (
  action_id UUID,
  segment_id UUID,
  text_content TEXT,
  similarity FLOAT
)
LANGUAGE SQL STABLE
AS $$
  SELECT
    se.action_id,
    se.segment_id,
    se.text_content,
    1 - (se.embedding <=> p_query_embedding) AS similarity
  FROM search_embeddings se
  WHERE se.job_id = p_job_id
  ORDER BY se.embedding <=> p_query_embedding
  LIMIT p_top_k;
$$;
```

---

## `tests/` — Test Suite

```
tests/
├── unit/
│   ├── test_error_handling.ts         # API error envelope tests
│   ├── test_token_validation.ts       # Job token HMAC + expiry tests
│   └── test_state_machine.ts          # Status transition enum coverage
│
├── integration/
│   ├── test_upload_api.ts             # POST /api/upload — valid + invalid inputs
│   ├── test_process_api.ts            # POST /api/process — idempotency + auth
│   ├── test_job_status_api.ts         # GET /api/job/:id — all status codes
│   └── test_realtime_subscription.ts  # Realtime event shape + latency
│
├── e2e/
│   ├── full_demo_flow.spec.ts         # Playwright: upload → COMPLETED → results visible
│   ├── failure_flow.spec.ts           # Playwright: corrupt video → ErrorBanner
│   ├── reconnect.spec.ts              # Playwright: reload mid-run → state restored
│   └── accessibility.spec.ts          # axe-core: no critical a11y violations
│
├── load/
│   └── pipeline_load_test.js          # k6: 2 concurrent jobs × 10 minutes
│
└── fixtures/
    ├── factory_clip_30s.mp4           # 30-second real factory footage for agent tests
    ├── factory_clip_5min.mp4          # 5-minute clip for end-to-end tests
    ├── dark_clip.mp4                  # Underlit clip for Quality Agent rejection test
    └── corrupt.avi                    # Invalid format for upload rejection test
```

---

## `.env.example`

```bash
# ─── Supabase ─────────────────────────────────
NEXT_PUBLIC_SUPABASE_URL=https://[project].supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...          # Safe for browser (anon, RLS-enforced)
SUPABASE_SERVICE_ROLE_KEY=eyJ...              # SERVER ONLY — bypasses RLS
SUPABASE_JWT_SECRET=[your-jwt-secret]

# ─── Modal ────────────────────────────────────
MODAL_WEBHOOK_URL=https://[team]--autoegolab-process-webhook.modal.run
MODAL_WEBHOOK_SECRET=[openssl rand -hex 32]  # Shared secret for webhook auth
MODAL_TOKEN_ID=[from modal token list]
MODAL_TOKEN_SECRET=[from modal token list]

# ─── AI Model APIs ────────────────────────────
GOOGLE_API_KEY=[from console.cloud.google.com]

# ─── Observability ────────────────────────────
LANGCHAIN_API_KEY=[from smith.langchain.com]
LANGCHAIN_PROJECT=autoegolab
LANGCHAIN_TRACING_V2=true

# ─── Security ─────────────────────────────────
JOB_TOKEN_SIGNING_SECRET=[openssl rand -hex 32]  # HMAC secret for job bearer tokens

# ─── Rate Limiting (optional) ─────────────────
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

---

## `requirements.txt` — Python Dependencies

```txt
# Modal
modal>=0.64.0

# AI/ML
torch==2.2.0
torchvision==0.17.0
transformers>=4.40.0
accelerate>=0.27.0
ultralytics>=8.2.0          # YOLOE-26x-seg
sam2>=1.0.0                 # SAM 2.1
sklearn-extra>=0.3.0        # KMedoids clustering
numpy>=1.26.0
pillow>=10.0.0
opencv-python-headless>=4.9.0
ffmpeg-python>=0.2.0
scipy>=1.12.0

# LangGraph / LangChain
langgraph>=0.3.0
langchain>=0.3.0
langchain-google-genai>=1.0.0
langsmith>=0.1.0

# Gemini / structured output
google-generativeai>=0.7.0
instructor>=1.2.0

# Data / serialization
pydantic>=2.6.0
tensorflow>=2.16.0          # RLDS TFRecord writer

# Supabase
supabase>=2.4.0

# Reliability
tenacity>=8.3.0

# Observability
structlog>=24.1.0
```

---

## `package.json` — Node.js Dependencies

```json
{
  "name": "autoegolab",
  "version": "3.0.0",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "test": "vitest",
    "test:e2e": "playwright test",
    "db:gen-types": "npx supabase gen types typescript --project-id [id] > types/database.ts"
  },
  "dependencies": {
    "next": "15.x",
    "react": "18.x",
    "react-dom": "18.x",
    "@supabase/supabase-js": "^2.43.0",
    "@supabase/ssr": "^0.4.0",
    "zustand": "^4.5.0",
    "@tanstack/react-query": "^5.32.0",
    "react-dropzone": "^14.2.0",
    "reactflow": "^11.11.0",
    "@dagrejs/dagre": "^1.0.4",
    "framer-motion": "^11.1.0",
    "zod": "^3.23.0",
    "nanoid": "^5.0.0",
    "@upstash/ratelimit": "^1.1.0",
    "@upstash/redis": "^1.28.0"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "@types/react": "^18",
    "@types/node": "^20",
    "eslint": "^8",
    "eslint-config-next": "15.x",
    "vitest": "^1.5.0",
    "@playwright/test": "^1.43.0",
    "tailwindcss": "^3.4.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0"
  }
}
```

---
