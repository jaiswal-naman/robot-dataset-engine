# AutoEgoLab v3 Component Document: Data Architecture

Source of truth: `engineering_blueprint_v3.md` (Section 8)

## 8. Data Architecture

### 8.1 Data model overview
Data model is split into:
- Control plane: jobs, tokens, events, agent runs.
- Domain plane: segments, actions, task graphs, manifests.
- Artifact/index plane: object refs and vector embeddings.

### 8.2 SQL schema (PostgreSQL 16 + pgvector)

```sql
-- Extensions
create extension if not exists pgcrypto;
create extension if not exists vector;

-- Enums
create type public.job_status as enum (
  'UPLOADED',
  'QUEUED',
  'VIDEO_AGENT_RUNNING',
  'QUALITY_AGENT_RUNNING',
  'PERCEPTION_AGENT_RUNNING',
  'SEGMENTATION_AGENT_RUNNING',
  'ACTION_AGENT_RUNNING',
  'TASK_GRAPH_AGENT_RUNNING',
  'DATASET_BUILDER_RUNNING',
  'COMPLETED',
  'FAILED_VALIDATION',
  'FAILED_VIDEO_AGENT',
  'FAILED_QUALITY_AGENT',
  'FAILED_PERCEPTION_AGENT',
  'FAILED_SEGMENTATION_AGENT',
  'FAILED_ACTION_AGENT',
  'FAILED_TASK_GRAPH_AGENT',
  'FAILED_DATASET_BUILDER',
  'FAILED_ORCHESTRATOR',
  'CANCELLED',
  'EXPIRED'
);

create type public.agent_name as enum (
  'VIDEO_AGENT',
  'QUALITY_AGENT',
  'PERCEPTION_OBJECT_BRANCH',
  'PERCEPTION_MASK_BRANCH',
  'PERCEPTION_HAND_BRANCH',
  'PERCEPTION_MERGE',
  'SEGMENTATION_AGENT',
  'ACTION_AGENT',
  'TASK_GRAPH_AGENT',
  'DATASET_BUILDER'
);

create type public.agent_run_status as enum (
  'PENDING',
  'RUNNING',
  'RETRYING',
  'SUCCEEDED',
  'FAILED',
  'SKIPPED',
  'CANCELLED'
);

create type public.artifact_type as enum (
  'RAW_VIDEO',
  'RAW_FRAME',
  'CLEAN_FRAME',
  'PERCEPTION_JSON',
  'SEGMENTS_JSON',
  'ACTIONS_JSON',
  'TASK_GRAPH_JSON',
  'DATASET_JSON',
  'DATASET_RLDS',
  'THUMBNAIL'
);

-- Utility function
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.jwt_job_id()
returns uuid
language sql
stable
as $$
  select nullif((coalesce(current_setting('request.jwt.claims', true), '{}')::jsonb ->> 'job_id'), '')::uuid;
$$;

-- Control plane tables
create table if not exists public.processing_jobs (
  id uuid primary key default gen_random_uuid(),
  trace_id text not null,
  status public.job_status not null default 'UPLOADED',
  current_agent public.agent_name null,
  progress_percent numeric(5,2) not null default 0,
  status_message text null,
  input_bucket text not null,
  input_object_key text not null,
  video_duration_sec int null check (video_duration_sec between 1 and 360),
  video_width int null,
  video_height int null,
  video_fps numeric(6,3) null,
  idempotency_key text null unique,
  modal_workflow_id text null,
  failure_code text null,
  failure_details jsonb not null default '{}'::jsonb,
  queued_at timestamptz null,
  started_at timestamptz null,
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_processing_jobs_updated_at
before update on public.processing_jobs
for each row execute function public.set_updated_at();

create table if not exists public.job_tokens (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.processing_jobs(id) on delete cascade,
  token_hash text not null,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz null,
  last_used_at timestamptz null,
  unique(job_id, token_hash)
);

create index if not exists idx_job_tokens_job_id on public.job_tokens(job_id);
create index if not exists idx_job_tokens_expires_at on public.job_tokens(expires_at);

create table if not exists public.job_events (
  id bigserial primary key,
  job_id uuid not null references public.processing_jobs(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_job_events_job_id_created_at on public.job_events(job_id, created_at desc);

create table if not exists public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.processing_jobs(id) on delete cascade,
  agent public.agent_name not null,
  attempt int not null check (attempt >= 1),
  status public.agent_run_status not null default 'PENDING',
  model_name text null,
  gpu_class text null,
  input_count int null,
  output_count int null,
  token_input_count int null,
  token_output_count int null,
  duration_ms int null,
  trace_url text null,
  error_code text null,
  error_message text null,
  metrics jsonb not null default '{}'::jsonb,
  started_at timestamptz null,
  finished_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(job_id, agent, attempt)
);

create trigger trg_agent_runs_updated_at
before update on public.agent_runs
for each row execute function public.set_updated_at();

-- Artifact and domain tables
create table if not exists public.artifacts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.processing_jobs(id) on delete cascade,
  artifact_type public.artifact_type not null,
  producer_agent public.agent_name null,
  bucket text not null,
  object_key text not null,
  content_type text not null,
  size_bytes bigint null check (size_bytes is null or size_bytes >= 0),
  sha256 text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(bucket, object_key)
);

create index if not exists idx_artifacts_job_type on public.artifacts(job_id, artifact_type);

create table if not exists public.skill_segments (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.processing_jobs(id) on delete cascade,
  segment_index int not null check (segment_index >= 0),
  start_ts_ms int not null check (start_ts_ms >= 0),
  end_ts_ms int not null check (end_ts_ms > start_ts_ms),
  start_frame_idx int not null check (start_frame_idx >= 0),
  end_frame_idx int not null check (end_frame_idx >= start_frame_idx),
  trigger_type text not null check (trigger_type in ('MASK_DELTA', 'CONTACT', 'DUAL', 'FALLBACK')),
  confidence numeric(4,3) not null check (confidence between 0 and 1),
  primary_object text null,
  hand_side text null check (hand_side in ('left', 'right', 'both', 'unknown')),
  summary text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(job_id, segment_index)
);

create index if not exists idx_skill_segments_job_time on public.skill_segments(job_id, start_ts_ms, end_ts_ms);

create table if not exists public.actions (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.processing_jobs(id) on delete cascade,
  segment_id uuid not null references public.skill_segments(id) on delete cascade,
  action_index int not null check (action_index >= 0),
  action_label text not null,
  verb text not null,
  object text null,
  tool text null,
  target text null,
  confidence numeric(4,3) not null check (confidence between 0 and 1),
  model_used text not null,
  fallback_used boolean not null default false,
  reasoning jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(job_id, action_index)
);

create index if not exists idx_actions_job_segment on public.actions(job_id, segment_id);

create table if not exists public.task_graphs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references public.processing_jobs(id) on delete cascade,
  version int not null default 1 check (version >= 1),
  model_name text not null,
  graph_json jsonb not null,
  graph_hash text not null,
  token_input_count int null,
  token_output_count int null,
  created_at timestamptz not null default now()
);

create index if not exists idx_task_graphs_gin on public.task_graphs using gin (graph_json);

create table if not exists public.dataset_manifests (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references public.processing_jobs(id) on delete cascade,
  schema_version text not null default 'v1',
  dataset_version text not null,
  dataset_json_artifact_id uuid null references public.artifacts(id),
  dataset_rlds_artifact_id uuid null references public.artifacts(id),
  record_count int not null check (record_count >= 0),
  warnings jsonb not null default '[]'::jsonb,
  manifest_json jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.search_embeddings (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.processing_jobs(id) on delete cascade,
  segment_id uuid null references public.skill_segments(id) on delete cascade,
  action_id uuid null references public.actions(id) on delete cascade,
  embedding vector(768) not null,
  embedding_model text not null,
  text_content text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check ((segment_id is not null) or (action_id is not null))
);

create index if not exists idx_search_embeddings_job on public.search_embeddings(job_id);
create index if not exists idx_search_embeddings_ivfflat
  on public.search_embeddings
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- Vector search RPC
create or replace function public.search_job_embeddings(
  p_job_id uuid,
  p_query_embedding vector(768),
  p_top_k int default 5
)
returns table (
  embedding_id uuid,
  segment_id uuid,
  action_id uuid,
  text_content text,
  score float4
)
language sql
stable
as $$
  select
    se.id as embedding_id,
    se.segment_id,
    se.action_id,
    se.text_content,
    1 - (se.embedding <=> p_query_embedding) as score
  from public.search_embeddings se
  where se.job_id = p_job_id
  order by se.embedding <=> p_query_embedding
  limit greatest(1, least(p_top_k, 50));
$$;

-- RLS
alter table public.processing_jobs enable row level security;
alter table public.job_events enable row level security;
alter table public.agent_runs enable row level security;
alter table public.artifacts enable row level security;
alter table public.skill_segments enable row level security;
alter table public.actions enable row level security;
alter table public.task_graphs enable row level security;
alter table public.dataset_manifests enable row level security;
alter table public.search_embeddings enable row level security;
alter table public.job_tokens enable row level security;

-- Default deny for anon/authenticated; service_role bypasses.
create policy deny_all_processing_jobs on public.processing_jobs for all to anon, authenticated using (false) with check (false);
create policy deny_all_job_events on public.job_events for all to anon, authenticated using (false) with check (false);
create policy deny_all_agent_runs on public.agent_runs for all to anon, authenticated using (false) with check (false);
create policy deny_all_artifacts on public.artifacts for all to anon, authenticated using (false) with check (false);
create policy deny_all_segments on public.skill_segments for all to anon, authenticated using (false) with check (false);
create policy deny_all_actions on public.actions for all to anon, authenticated using (false) with check (false);
create policy deny_all_task_graphs on public.task_graphs for all to anon, authenticated using (false) with check (false);
create policy deny_all_manifests on public.dataset_manifests for all to anon, authenticated using (false) with check (false);
create policy deny_all_embeddings on public.search_embeddings for all to anon, authenticated using (false) with check (false);
create policy deny_all_job_tokens on public.job_tokens for all to anon, authenticated using (false) with check (false);

-- Realtime publication
alter publication supabase_realtime add table public.processing_jobs;
alter publication supabase_realtime add table public.agent_runs;
alter publication supabase_realtime add table public.job_events;
```

### 8.3 Data relationships
- `processing_jobs` is the root entity.
- `job_tokens`, `agent_runs`, `job_events`, `artifacts`, `skill_segments`, `actions`, `task_graphs`, `dataset_manifests`, `search_embeddings` all reference `processing_jobs(id)`.
- `actions` references `skill_segments`.
- `dataset_manifests` references final dataset artifacts.

### 8.4 Data flow (text diagram)
`agent node output -> write artifacts -> write domain rows -> append event -> update processing_jobs status`

### 8.5 Scalability and edge cases
- `search_embeddings` ivfflat requires periodic `analyze`; run after large ingestion batches.
- Edge cases:
  - orphan artifact rows due to interrupted upload: background reconciliation job removes dead refs.
  - very large `job_events`: retain recent N days for hot access, archive older events.

---
