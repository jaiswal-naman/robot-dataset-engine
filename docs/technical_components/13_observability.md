# AutoEgoLab v3.0 — Observability, Monitoring & Debugging
**Document owner:** AI Systems Engineering  
**Revision:** 2.0 | **Date:** 2026-03-16 | **Status:** Build-Ready

---

## 13.1 Observability Philosophy

**Three pillars, one correlation ID:**

Every log line, every trace span, every metric data point MUST carry `job_id` and `trace_id`. With these two values, any engineer can reconstruct the complete history of any job:
1. Find all logs in the structured log sink filtered by `job_id`
2. Open LangSmith with `trace_id` → see every model call, input, output, timing
3. Query `agent_runs` in Supabase filtered by `job_id` → see attempt history

**Observability is never optional.** Tracing failures must be caught and logged but MUST NOT block the pipeline. A job that fails to emit a LangSmith trace is still a successful job.

---

## 13.2 Tracing — LangSmith

LangSmith provides automatic distributed tracing for every LangGraph node execution. No manual instrumentation needed — enabling tracing is two environment variables.

### Setup

```python
# modal_backend/pipeline.py

import os
os.environ["LANGCHAIN_TRACING_V2"] = "true"
os.environ["LANGCHAIN_PROJECT"] = os.environ.get("LANGCHAIN_PROJECT", "autoegolab")
os.environ["LANGCHAIN_API_KEY"] = os.environ["LANGCHAIN_API_KEY"]

# From this point, every LangGraph node, every .invoke() call, 
# every model call is automatically traced.
```

### What Gets Traced Automatically

| Event | Trace Fields |
|---|---|
| LangGraph node start | `node_name`, `input_state_keys`, `run_id` |
| LangGraph node complete | `output_state_keys`, `duration_ms` |
| Gemini API call | `model`, `prompt_tokens`, `completion_tokens`, `output_text` |
| EgoVLM inference | Captured if using LangChain wrapper |
| Node retry attempt | `attempt_number`, `error_type` |
| Pipeline completion | Total duration, final state keys |

### Storing Trace URLs

```python
# modal_backend/pipeline.py (inside run_agent_node)

import langsmith

def run_agent_node(agent_name: str, AgentClass, state: PipelineState) -> PipelineState:
    with langsmith.trace(
        name=agent_name,
        run_id=f"{state['trace_id']}-{agent_name}",
        project_name=os.environ.get("LANGCHAIN_PROJECT", "autoegolab"),
    ) as run:
        try:
            result = AgentClass(state["job_id"], state["trace_id"]).run(state)
            
            # Store LangSmith trace URL in agent_runs table
            trace_url = f"https://smith.langchain.com/projects/{os.environ['LANGCHAIN_PROJECT']}/runs/{run.id}"
            supabase.table("agent_runs").update({
                "trace_url": trace_url,
            }).eq("job_id", state["job_id"]).eq("agent", agent_name).execute()
            
            return merge_state(state, result.state_updates)
        except Exception:
            run.end(error=str(e))
            raise
```

---

## 13.3 Structured Logging

All log lines MUST be valid JSON. Never use `print()` for production logging — always use `structlog`.

### Logger Setup (Modal side)

```python
# modal_backend/utils/logger.py
import structlog
import logging

structlog.configure(
    processors=[
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.JSONRenderer(),  # Always JSON output
    ],
    wrapper_class=structlog.stdlib.BoundLogger,
    context_class=dict,
    logger_factory=structlog.stdlib.LoggerFactory(),
)

def get_logger(job_id: str, trace_id: str, agent: str | None = None):
    return structlog.get_logger().bind(
        service="modal",
        job_id=job_id,
        trace_id=trace_id,
        agent=agent,
    )
```

### Log Contract — Required Fields

Every log line MUST include ALL of these fields:

```python
# Required fields per log event
{
    "timestamp":   "2026-03-16T06:02:15.123Z",   # ISO8601 with ms
    "level":       "info|warning|error|debug",
    "service":     "api|modal|orchestrator|agent", # Which component
    "job_id":      "2f8a...",                      # UUID (null if pre-job)
    "trace_id":    "trc_...",                      # LangSmith trace correlation
    "agent":       "VIDEO_AGENT",                  # null if not in agent context
    "event":       "agent_success",                # snake_case event name
    "duration_ms": 12450,                          # null if not timing-relevant
    "error_code":  null,                           # ERROR_CODE string on errors
}
```

### Standard Log Events

```python
# Agent lifecycle events
log.info("agent_started",    attempt=1)
log.info("agent_succeeded",  duration_ms=12450, output_count=120)
log.warning("agent_retrying",  attempt=2, error="ConnectionTimeout", backoff_sec=4)
log.error("agent_failed",    attempt=3, error_code="CUDA_OOM", error="OutOfMemoryError: ...")

# External API events
log.info("gemini_call_started",   model="gemini-exp-1206", prompt_tokens=1240)
log.info("gemini_call_succeeded", tokens_used=1890, duration_ms=8200)
log.warning("gemini_rate_limited", retry_after_sec=10, attempt=1)
log.error("gemini_exhausted",     attempts=3, error_code="GEMINI_RATE_LIMIT")

# Storage events
log.info("artifact_uploaded",  artifact_type="CLEAN_FRAME", size_bytes=145678, object_key="jobs/...")
log.info("artifact_downloaded", artifact_type="PERCEPTION_JSON", size_bytes=456789, duration_ms=320)
log.error("storage_upload_failed", object_key="jobs/...", error="Network timeout")

# Pipeline lifecycle events
log.info("pipeline_started",   job_id=job_id, trace_id=trace_id)
log.info("pipeline_completed", job_id=job_id, total_duration_sec=142)
log.error("pipeline_failed",   job_id=job_id, failure_status="FAILED_QUALITY_AGENT", error_code="ZERO_CLEAN_FRAMES")
```

### Logger Setup (Next.js side)

```typescript
// lib/utils/logger.ts

interface LogFields {
  service: 'api';
  job_id?: string;
  trace_id?: string;
  event: string;
  duration_ms?: number;
  error_code?: string;
  [key: string]: unknown;
}

export function log(level: 'info' | 'warn' | 'error', fields: LogFields) {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    ...fields,
  });
  
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

// Usage in API routes:
log('info', { service: 'api', job_id, trace_id, event: 'upload_created', duration_ms });
log('error', { service: 'api', job_id, event: 'modal_trigger_failed', error_code: 'PIPELINE_TRIGGER_FAILED' });
```

---

## 13.4 Metrics Catalog

All metrics are computed from DB queries (not a separate metrics server). For the demo scale (< 100 jobs/day), Supabase Dashboard SQL queries are sufficient. For production scale, export to Grafana or Datadog.

### Computed Metrics Queries

```sql
-- ─── Job Throughput ─────────────────────────────────────────────────────
-- Jobs per hour (last 24h)
SELECT
  date_trunc('hour', created_at) AS hour,
  COUNT(*) AS jobs_created,
  COUNT(*) FILTER (WHERE status = 'COMPLETED') AS jobs_completed,
  COUNT(*) FILTER (WHERE status LIKE 'FAILED_%') AS jobs_failed
FROM public.processing_jobs
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY 1 ORDER BY 1;

-- ─── Runtime Distribution (p50, p95) ────────────────────────────────────
SELECT
  percentile_cont(0.50) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (completed_at - started_at))) AS p50_sec,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (completed_at - started_at))) AS p95_sec,
  COUNT(*) AS sample_count
FROM public.processing_jobs
WHERE status = 'COMPLETED' AND completed_at > NOW() - INTERVAL '7 days';

-- ─── Per-Agent Runtime Distribution ────────────────────────────────────
SELECT
  agent,
  percentile_cont(0.50) WITHIN GROUP (ORDER BY duration_ms) / 1000.0 AS p50_sec,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) / 1000.0 AS p95_sec,
  COUNT(*) AS sample_count
FROM public.agent_runs
WHERE status = 'SUCCEEDED' AND created_at > NOW() - INTERVAL '7 days'
GROUP BY agent ORDER BY p95_sec DESC;

-- ─── Failure Rate by Agent ───────────────────────────────────────────────
SELECT
  agent,
  COUNT(*) FILTER (WHERE status = 'FAILED') AS failures,
  COUNT(*) AS total_attempts,
  ROUND(COUNT(*) FILTER (WHERE status = 'FAILED') * 100.0 / COUNT(*), 1) AS failure_pct
FROM public.agent_runs
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY agent ORDER BY failure_pct DESC;

-- ─── Retry Rate ─────────────────────────────────────────────────────────
SELECT
  agent,
  AVG(attempt) AS avg_attempts,
  MAX(attempt) AS max_attempts,
  COUNT(*) FILTER (WHERE attempt > 1) AS needed_retry
FROM public.agent_runs
WHERE status = 'SUCCEEDED'
GROUP BY agent;

-- ─── Queue Depth Right Now ──────────────────────────────────────────────
SELECT
  COUNT(*) AS queued,
  COUNT(*) FILTER (WHERE status LIKE '%_RUNNING') AS running
FROM public.processing_jobs
WHERE status NOT IN ('COMPLETED', 'CANCELLED', 'EXPIRED') AND status NOT LIKE 'FAILED_%';
```

---

## 13.5 Alert Thresholds

### Critical Alerts (page on-call / send immediate notification)

| Alert | Query | Threshold | Action |
|---|---|---|---|
| High failure rate | `jobs_failed / jobs_started` over 15 min | > 15% | Check `failure_code` distribution — likely model outage |
| Stuck running job | `updated_at` age for any `*_RUNNING` job | > 300s | Watchdog should have caught this — check Modal logs |
| Queue overflow | `queued` count | > 20 | Scale GPU concurrency or investigate blocking issue |
| Zero jobs completing | `jobs_completed` count over 30 min | = 0 with jobs running | Pipeline broken — check LangSmith for traces |

### Warning Alerts (notify during business hours)

| Alert | Threshold | Action |
|---|---|---|
| Slow pipeline | p95 runtime > 330s for 1 hour | Profile bottleneck agents; check GPU VRAM |
| Gemini errors | 429 error rate > 5% | Check API quota; consider rate limit reduction |
| Storage approaching quota | Storage used > 70% | Run GC pass or upgrade storage tier |
| High retry rate | avg_attempts > 1.5 for any agent | Investigate transient failures; check provider status |

### Alert Delivery (for demo-scale)

```python
# Simple alert check as part of watchdog (runs every 60s on Modal)
# In production: replace with Datadog/PagerDuty webhook

@app.function(schedule=modal.Period(seconds=60), secrets=[SUPABASE_SECRET])
def watchdog():
    """Checks for stuck jobs AND fires metric alerts."""
    sb = create_supabase_service_client()
    
    # Check for stuck jobs (> 3 min with no heartbeat)
    stuck = sb.table("processing_jobs") \
        .select("id, status, updated_at") \
        .like("status", "%_RUNNING") \
        .execute().data
    
    for job in stuck:
        age_sec = (now_utc() - parse_iso(job["updated_at"])).total_seconds()
        if age_sec > 180:
            attempt_resume(sb, job["id"])
    
    # Check queue depth
    queue_depth = sb.table("processing_jobs") \
        .select("id", count="exact") \
        .eq("status", "QUEUED").execute().count
    
    if queue_depth > 20:
        send_alert("QUEUE_OVERFLOW", f"Queue depth: {queue_depth}")
```

---

## 13.6 Debugging Runbook — Job Failure Investigation

When a job fails, follow this exact sequence:

### Step 1: Identify the Failure

```sql
SELECT id, status, failure_code, failure_details, trace_id, started_at, updated_at
FROM public.processing_jobs
WHERE id = '<job_id>';
```

The `failure_code` tells you which agent failed. The `failure_details` JSONB contains the error message.

### Step 2: Check Agent Run History

```sql
SELECT agent, attempt, status, error_code, error_message, duration_ms, trace_url
FROM public.agent_runs
WHERE job_id = '<job_id>'
ORDER BY created_at ASC;
```

This shows: which agents succeeded, how many retries each took, exact error messages, and LangSmith trace URLs.

### Step 3: Open LangSmith Trace

From `agent_runs.trace_url`, open the LangSmith trace. You'll see:
- Exact prompt sent to Gemini/EgoVLM
- Raw model response
- Pydantic validation errors (if schema mismatch)
- All intermediate state values

### Step 4: Inspect Artifacts

```sql
SELECT artifact_type, producer_agent, size_bytes, sha256, metadata, created_at
FROM public.artifacts
WHERE job_id = '<job_id>'
ORDER BY created_at ASC;
```

Check if expected artifacts exist. A missing `PERCEPTION_JSON` when the job failed in `SEGMENTATION_AGENT` means the Perception Agent didn't persist its output correctly.

### Step 5: Check Storage Directly (if needed)

```python
# Quick storage inspection
from supabase import create_client
sb = create_client(SUPABASE_URL, SERVICE_ROLE_KEY)

# List all storage objects for this job
objects = sb.storage.from_("intermediate").list(f"jobs/{job_id}/PERCEPTION_JSON/v1/")
print(objects)
```

### Step 6: Replay Failed Node

If the failure was transient (e.g., GPU OOM on first attempt):
```bash
# Re-trigger the pipeline from the last checkpoint
# POST /api/process is idempotent — if job is in FAILED state, it won't re-trigger
# Instead, manually reset via Supabase dashboard:
UPDATE processing_jobs SET status = 'UPLOADED', failure_code = NULL WHERE id = '<job_id>';
# Then call POST /api/process from the UI
```

---

## 13.7 Performance Profiling

When pipeline is slower than expected, use this to identify the specific bottleneck:

```sql
-- Sorted by avg duration descending — slowest agent first
SELECT
  agent,
  COUNT(*) AS runs,
  ROUND(AVG(duration_ms) / 1000.0, 1) AS avg_sec,
  ROUND(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) / 1000.0, 1) AS p95_sec,
  ROUND(MAX(duration_ms) / 1000.0, 1) AS max_sec
FROM public.agent_runs
WHERE status = 'SUCCEEDED'
  AND created_at > NOW() - INTERVAL '24 hours'
GROUP BY agent
ORDER BY avg_sec DESC;
```

**Common bottlenecks and fixes:**

| Bottleneck | Symptom | Fix |
|---|---|---|
| DINOv2 cold start | Video Agent p95 >> p50 | Pre-warm Modal container with `keep_warm=1` |
| SAM 2.1 OOM | Perception Mask fails attempt 1, succeeds attempt 2 | Reduce `SAM_BATCH_SIZE` in config |
| Gemini high latency | Task Graph p95 > 45s | Add `timeout_sec=30` to Gemini call; use faster model on retry |
| Storage download slow | Any agent p95 >> p50 | Check Supabase region vs Modal region; aim for same AWS region |
| EgoVLM slow on long segments | Action Agent slow on videos with many segments | Reduce `ACTION_FRAMES_PER_SEGMENT` from 4 to 2 |

---
