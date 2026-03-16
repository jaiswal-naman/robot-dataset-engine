# AutoEgoLab v3.0 — Infrastructure & Deployment
**Document owner:** AI Systems Engineering  
**Revision:** 2.0 | **Date:** 2026-03-16 | **Status:** Build-Ready

---

## 12.1 Deployment Topology

```
                    ┌──────────────────────────────────┐
                    │          Vercel                  │
                    │  Next.js 15 App Router           │
                    │  ├── Static pages (SSG)          │
                    │  ├── API Routes (Node runtime)   │
                    │  └── Edge Middleware (rate limit) │
                    │  Region: auto (near user)        │
                    │  Deployment: git push → auto     │
                    └─────────────┬────────────────────┘
                                  │
               ┌──────────────────┼──────────────────────┐
               │                  │                       │
               ▼                  ▼                       ▼
     ┌──────────────┐   ┌──────────────────┐   ┌─────────────────────┐
     │   Supabase   │   │    Modal.com     │   │   Upstash Redis     │
     │  (us-east-1) │   │  (Serverless GPU)│   │  (Rate Limiter)     │
     │              │   │                  │   │  KV store           │
     │  PostgreSQL  │   │  modal_backend/  │   │  Sliding window     │
     │  Object Store│   │  app.py          │   │  counters per IP    │
     │  Realtime    │   │  pipeline.py     │   └─────────────────────┘
     │  pgvector    │   │  agents/*.py     │
     └──────────────┘   └──────────────────┘
                                  │
                    ┌─────────────┼─────────────┐
                    │                           │
                    ▼                           ▼
          ┌──────────────────┐      ┌──────────────────────┐
          │   Google Gemini  │      │     LangSmith        │
          │   API            │      │  (Trace Observability│
          │   (Task Graph +  │      │   + Debugging)       │
          │    Fallback)     │      └──────────────────────┘
          └──────────────────┘
```

---

## 12.2 Vercel Configuration

### `vercel.json`

```json
{
  "framework": "nextjs",
  "regions": ["iad1"],
  "functions": {
    "app/api/upload/route.ts":  { "maxDuration": 15 },
    "app/api/process/route.ts": { "maxDuration": 15 },
    "app/api/job/[id]/route.ts": { "maxDuration": 10 },
    "app/api/job/[id]/dataset/route.ts": { "maxDuration": 10 },
    "app/api/search/route.ts": { "maxDuration": 15 }
  },
  "headers": [
    {
      "source": "/api/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" }
      ]
    }
  ]
}
```

### Environment Variable Configuration

**Critical rule:** Variables beginning with `NEXT_PUBLIC_` are baked into the client bundle at build time. They are visible to all users. **Never put secrets in `NEXT_PUBLIC_` variables.**

```bash
# ─── In Vercel Dashboard → Settings → Environment Variables ───────────────

# Client-safe (browser-accessible)
NEXT_PUBLIC_SUPABASE_URL=https://[project-ref].supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...      # Anon key — RLS enforced, safe to expose

# Server-only (never exposed to browser — Vercel encrypts these)
SUPABASE_SERVICE_ROLE_KEY=eyJ...          # CRITICAL: bypasses RLS — server only
SUPABASE_JWT_SECRET=[jwt-secret]          # For Realtime JWT minting
SUPABASE_DB_URL=postgresql://...          # For migration tooling in CI

MODAL_WEBHOOK_URL=https://[team]--autoegolab-process-webhook.modal.run
MODAL_WEBHOOK_SECRET=[32-byte hex]        # Shared secret for webhook auth
MODAL_TOKEN_ID=[modal-token-id]           # For CI deployment
MODAL_TOKEN_SECRET=[modal-token-secret]   # For CI deployment

GOOGLE_API_KEY=[gemini-api-key]           # Not used by Next.js but needed in CI for validation

LANGCHAIN_API_KEY=[langsmith-key]
LANGCHAIN_PROJECT=autoegolab
LANGCHAIN_TRACING_V2=true

JOB_TOKEN_SIGNING_SECRET=[32-byte hex]   # HMAC secret for bearer tokens

UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=[upstash-token]
```

### Build and Deploy Commands

```bash
# Development
npm run dev          # Next.js dev server on http://localhost:3000

# Type checking (must pass CI)
npm run typecheck    # tsc --noEmit

# Linting (must pass CI)  
npm run lint         # eslint + next/lint rules

# Production build (validates everything compiles)
npm run build        # next build — exits 1 on type/lint errors

# Deploy to production
vercel --prod        # Or: git push main → auto-deploy via Vercel GitHub integration
```

### `next.config.ts` — Production Settings

```typescript
// next.config.ts
import type { NextConfig } from 'next';

const config: NextConfig = {
  // Validate required env vars at startup (fail-fast)
  env: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  },
  
  // Strict TypeScript config
  typescript: {
    ignoreBuildErrors: false,  // NEVER set this to true in production
  },
  
  // Strict ESLint
  eslint: {
    ignoreDuringBuilds: false,
  },
  
  // Security headers (also set in vercel.json)
  headers: async () => ([
    {
      source: '/(.*)',
      headers: [
        { key: 'X-DNS-Prefetch-Control', value: 'on' },
        { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
      ],
    },
  ]),
  
  // Images: allow Supabase storage domain
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '*.supabase.co' }],
  },
};

export default config;
```

---

## 12.3 Modal Configuration

### Secrets Setup (One-Time)

```bash
# Create Modal secrets from local env
modal secret create supabase-keys \
  SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
  SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY

modal secret create gemini-keys \
  GOOGLE_API_KEY=$GOOGLE_API_KEY

modal secret create langsmith-keys \
  LANGCHAIN_API_KEY=$LANGCHAIN_API_KEY \
  LANGCHAIN_PROJECT=autoegolab \
  LANGCHAIN_TRACING_V2=true

modal secret create webhook-keys \
  MODAL_WEBHOOK_SECRET=$MODAL_WEBHOOK_SECRET
```

### Deployment

```bash
# Deploy all functions
modal deploy modal_backend/app.py

# Expected output:
# ✓ Created web function process_webhook
#   URL: https://[team]--autoegolab-process-webhook.modal.run
# ✓ Created function execute_pipeline
# ✓ Created function watchdog
# ✓ Created function garbage_collect_artifacts
# ✓ Deployment complete
```

### Model Weight Pre-Caching

To avoid cold-start delays from model downloads, models are pre-baked into the Modal images:

```python
# modal_backend/app.py — image build steps that cache model weights

SAM2_IMAGE = (
    modal.Image.debian_slim()
    .apt_install("wget", "libgl1")
    .pip_install("torch==2.2.0", "torchvision", "sam2", "pillow", "numpy")
    .run_commands(
        # Download SAM 2.1 large checkpoint at image build time
        "mkdir -p /model-cache",
        "wget -q -O /model-cache/sam2.1_hiera_large.pt "
        "https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_large.pt",
        # Verify download integrity
        "python -c \"import os; assert os.path.getsize('/model-cache/sam2.1_hiera_large.pt') > 100_000_000\"",
    )
)

DINOV2_IMAGE = (
    modal.Image.debian_slim()
    .pip_install("torch==2.2.0", "torchvision", "pillow", "numpy", "sklearn-extra")
    .run_commands(
        # Pre-download DINOv2 weights into image
        "python -c \""
        "import torch; "
        "torch.hub.load('facebookresearch/dinov2', 'dinov2_vitb14', pretrained=True); "
        "print('DINOv2 cached')\"",
    )
)
```

**Why this matters:** Without pre-caching, the first run of a new image downloads 1–3GB of weights (~60–120s). With pre-caching, weights are already in the container filesystem — model load time drops to 2–5s.

### GPU Function Specs Summary

```python
# modal_backend/app.py — complete function spec table

@app.function(gpu="T4",   memory=12288, timeout=120,  image=DINOV2_IMAGE, secrets=[SUPABASE_SECRET])
def video_agent_fn(state): ...

@app.function(cpu=4,      memory=4096,  timeout=60,   image=CPU_IMAGE,   secrets=[SUPABASE_SECRET])
def quality_agent_fn(state): ...

@app.function(gpu="T4",   memory=12288, timeout=240,  image=YOLOE_IMAGE, secrets=[SUPABASE_SECRET])
def perception_object_fn(state): ...

@app.function(gpu="T4",   memory=12288, timeout=240,  image=SAM2_IMAGE,  secrets=[SUPABASE_SECRET])
def perception_mask_fn(state): ...

@app.function(gpu="A10G", memory=20480, timeout=240,  image=HAWOR_IMAGE, secrets=[SUPABASE_SECRET])
def perception_hand_fn(state): ...

@app.function(cpu=4,      memory=4096,  timeout=60,   image=CPU_IMAGE,   secrets=[SUPABASE_SECRET])
def segmentation_fn(state): ...

@app.function(gpu="A10G", memory=20480, timeout=180,  image=EGO_VLM_IMAGE, secrets=[SUPABASE_SECRET, GEMINI_SECRET])
def action_agent_fn(state): ...

@app.function(cpu=4,      memory=4096,  timeout=120,  image=CPU_IMAGE,   secrets=[GEMINI_SECRET, SUPABASE_SECRET, LANGSMITH_SECRET])
def task_graph_fn(state): ...

@app.function(cpu=4,      memory=4096,  timeout=60,   image=CPU_IMAGE,   secrets=[SUPABASE_SECRET])
def dataset_builder_fn(state): ...
```

---

## 12.4 Supabase Configuration

### Initial Setup Checklist

```bash
# 1. Create project at supabase.com
# Region: us-east-1 (match Vercel iad1 for low latency)
# Note: Project URL, anon key, service role key, JWT secret, DB password

# 2. Enable pgvector extension
# Dashboard → Database → Extensions → search "vector" → Enable

# 3. Apply SQL migrations in order
psql $SUPABASE_DB_URL -f supabase/migrations/0001_init.sql
psql $SUPABASE_DB_URL -f supabase/migrations/0002_domain_tables.sql
psql $SUPABASE_DB_URL -f supabase/migrations/0003_indexes.sql
psql $SUPABASE_DB_URL -f supabase/migrations/0004_rls.sql
psql $SUPABASE_DB_URL -f supabase/migrations/0005_functions.sql

# 4. Create storage buckets
psql $SUPABASE_DB_URL -c "
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES
  ('raw-videos',   'raw-videos',   false, 314572800, ARRAY['video/mp4']),
  ('frames',       'frames',       false, 5242880,   ARRAY['image/jpeg']),
  ('intermediate', 'intermediate', false, 52428800,  ARRAY['application/json']),
  ('datasets',     'datasets',     false, 524288000, ARRAY['application/json', 'application/octet-stream']),
  ('thumbnails',   'thumbnails',   false, 1048576,   ARRAY['image/jpeg', 'image/webp']);"

# 5. Enable Realtime on job tables
psql $SUPABASE_DB_URL -c "
ALTER PUBLICATION supabase_realtime ADD TABLE public.processing_jobs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_runs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.job_events;"

# 6. Generate TypeScript types
npx supabase gen types typescript \
  --project-id [project-ref] \
  --schema public \
  > types/database.ts
```

### pgvector IVFFlat Index Setup

```sql
-- From 0003_indexes.sql
-- IVFFlat index for 768-dim DINOv2 embeddings
-- lists=100 is appropriate for datasets up to ~1M vectors
-- Rebuild with higher lists when vector count exceeds 500K
CREATE INDEX idx_search_embeddings_vector
  ON public.search_embeddings
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Set nprobe (trade-off: higher = more accurate but slower)
-- Set per-session at query time if needed:
-- SET ivfflat.probes = 10;
```

---

## 12.5 CI/CD Pipeline

### `.github/workflows/ci.yml`

```yaml
name: CI/CD

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

env:
  NODE_VERSION: '20'
  PYTHON_VERSION: '3.11'

jobs:
  # ─── Lint + Type Check + Build ────────────────────────────────────────
  frontend-ci:
    name: Frontend CI
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - uses: actions/setup-node@v4
        with: { node-version: '${{ env.NODE_VERSION }}', cache: 'npm' }
      
      - run: npm ci
      
      - name: Type check
        run: npm run typecheck
      
      - name: Lint
        run: npm run lint
      
      - name: Build
        run: npm run build
        env:
          NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.NEXT_PUBLIC_SUPABASE_URL }}
          NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.NEXT_PUBLIC_SUPABASE_ANON_KEY }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
          JOB_TOKEN_SIGNING_SECRET: ${{ secrets.JOB_TOKEN_SIGNING_SECRET }}
          MODAL_WEBHOOK_URL: https://placeholder.modal.run
          MODAL_WEBHOOK_SECRET: placeholder
      
      - name: E2E Tests
        run: npx playwright test
        env:
          BASE_URL: http://localhost:3000
          # (full env vars for API routes)

  # ─── Python Pipeline Tests ────────────────────────────────────────────
  backend-ci:
    name: Backend CI
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - uses: actions/setup-python@v5
        with: { python-version: '${{ env.PYTHON_VERSION }}' }
      
      - run: pip install -r requirements.txt pytest
      
      - name: Run unit tests (no GPU required)
        run: pytest modal_backend/tests/test_segmentation_agent.py
                   modal_backend/tests/test_dataset_builder.py
                   modal_backend/tests/test_quality_agent.py
                   -v --timeout=60

  # ─── Production Deploy (main branch only) ─────────────────────────────
  deploy:
    name: Deploy to Production
    needs: [frontend-ci, backend-ci]
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      # Deploy frontend to Vercel
      - name: Deploy to Vercel
        run: npx vercel --prod --token=${{ secrets.VERCEL_TOKEN }} --yes
        env:
          VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
          VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}
      
      # Deploy Modal backend
      - uses: actions/setup-python@v5
        with: { python-version: '${{ env.PYTHON_VERSION }}' }
      
      - run: pip install modal
      
      - name: Deploy Modal functions
        run: modal deploy modal_backend/app.py
        env:
          MODAL_TOKEN_ID: ${{ secrets.MODAL_TOKEN_ID }}
          MODAL_TOKEN_SECRET: ${{ secrets.MODAL_TOKEN_SECRET }}
      
      # Apply DB migrations (after code deploy — backward compatible migrations only)
      - name: Apply DB migrations
        run: |
          pip install psycopg2-binary
          python -c "
          import psycopg2, glob, os
          conn = psycopg2.connect(os.environ['SUPABASE_DB_URL'])
          cur = conn.cursor()
          for f in sorted(glob.glob('supabase/migrations/*.sql')):
              print(f'Applying {f}')
              cur.execute(open(f).read())
          conn.commit()
          print('Migrations complete')
          "
        env:
          SUPABASE_DB_URL: ${{ secrets.SUPABASE_DB_URL }}
```

---

## 12.6 Environment Variables — Complete Matrix

| Variable | Used By | Scope | Never In |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Browser + Server | Vercel env | — |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser + Server | Vercel env | — |
| `SUPABASE_SERVICE_ROLE_KEY` | Next.js API Routes + Modal | Vercel secret + Modal secret | Client bundle, `.env.local` committed to git |
| `SUPABASE_JWT_SECRET` | Next.js API (token minting) | Vercel secret | Anywhere client-accessible |
| `SUPABASE_DB_URL` | Migration tooling (CI) | GitHub secret | Runtime app code |
| `MODAL_WEBHOOK_URL` | Next.js API `/api/process` | Vercel env | Modal environment |
| `MODAL_WEBHOOK_SECRET` | Next.js API + Modal webhook | Vercel secret + Modal secret | Logs, error messages |
| `MODAL_TOKEN_ID` | CI Deploy | GitHub secret | Runtime app code |
| `MODAL_TOKEN_SECRET` | CI Deploy | GitHub secret | Runtime app code |
| `GOOGLE_API_KEY` | Modal agents (Gemini) | Modal secret | Next.js API routes, client |
| `LANGCHAIN_API_KEY` | Modal orchestrator | Modal secret | Logs |
| `LANGCHAIN_PROJECT` | Modal orchestrator | Modal secret | — |
| `LANGCHAIN_TRACING_V2` | Modal orchestrator | Modal secret | — |
| `JOB_TOKEN_SIGNING_SECRET` | Next.js API (HMAC) | Vercel secret | Modal, client |
| `UPSTASH_REDIS_REST_URL` | Next.js API (rate limit) | Vercel env | Modal |
| `UPSTASH_REDIS_REST_TOKEN` | Next.js API (rate limit) | Vercel secret | Modal |

---

## 12.7 Scale-Up Path (Free-Tier → Paid)

| Trigger Metric | Threshold | Upgrade Action | Cost Impact |
|---|---|---|---|
| Queue wait time p95 | > 60s for 3 consecutive days | Increase Modal GPU concurrency limit | +$20-50/mo per GPU slot |
| Storage used | > 70% of 1GB Supabase free tier | Upgrade Supabase to Pro ($25/mo, 8GB) | +$25/mo |
| Gemini 429 error rate | > 5% of model calls | Switch to paid Gemini API key with billing enabled | Pay-per-token |
| API p95 latency | > 500ms at 10 RPS sustained | Add Redis caching layer + Supabase read replica | +$15-30/mo |
| DB query p95 | > 50ms | Add Supabase Pro DB compute upgrade | Included in Pro tier |
| Concurrent jobs target | > 2 jobs | Enable admission queue logic (Upstash + Redis-based job queue) | +$5-10/mo (Upstash) |

---

## 12.8 Disaster Recovery

| Scenario | Impact | Recovery |
|---|---|---|
| Vercel deployment fails | New code not served; previous version still live | Revert via `vercel rollback` (auto rollback available) |
| Modal deploy fails | Old pipeline version still running | Modal maintains previous deployment; redeploy from last successful commit |
| Supabase DB outage | All job state reads/writes fail | Realtime stops; API returns 503; jobs stuck in RUNNING state; watchdog resumes on recovery |
| Supabase Storage outage | Artifact up/downloads fail | Perception/Dataset steps fail; job marked FAILED_*; retry when storage recovers |
| Gemini API outage | Task Graph Agent fails | 3 retries with backoff; falls back to template graph; `warnings` field populated |
| Secret rotation needed | Tokens issued with old secret become invalid | Rotate secret in Vercel + Modal simultaneously; immediate effect; active tokens invalidated (must re-upload) |

---
