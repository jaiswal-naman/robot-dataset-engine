# AutoEgoLab v3.0 — Failure Handling & Recovery
**Document owner:** AI Systems Engineering  
**Revision:** 2.0 | **Date:** 2026-03-16 | **Status:** Build-Ready

---

## 15.1 Failure Handling Philosophy

**Principle 1: Every failure gets a typed code.**  
No job should ever be in a failed state where an engineer can't immediately identify what went wrong from `processing_jobs.failure_code` without reading raw logs.

**Principle 2: Retry before failing terminally.**  
Transient failures (API throttling, network timeouts, CUDA OOM) should be retried at the agent level before declaring terminal failure. Permanent failures (invalid video format, all frames blurry) should fail immediately.

**Principle 3: Write order is strict.**  
Storage write → Domain row write → Status transition. If the status transition fails, the transaction rolls back. This prevents the most dangerous state: "pipeline thinks complete but status row says failed."

**Principle 4: Jobs must be resumable after restarts.**  
If a Modal container crashes mid-pipeline (rare but possible), the watchdog must be able to resume from the last persisted checkpoint. This is why each agent writes a checkpoint key to the job's `failure_details` JSONB before starting.

---

## 15.2 Complete Failure Taxonomy

### Upload / Validation Failures (No Retry)

| Failure Code | Cause | Detection | Terminal Status |
|---|---|---|---|
| `INVALID_FORMAT` | Non-MP4 file submitted | Extension + MIME check on upload | `FAILED_VALIDATION` |
| `FILE_TOO_LARGE` | > 300MB | Server-side size check | `FAILED_VALIDATION` |
| `VIDEO_TOO_LONG` | > 360s duration | ffprobe post-upload | `FAILED_VALIDATION` |
| `BAD_CODEC` | Unsupported codec (e.g., wmv, avi) | ffprobe codec field | `FAILED_VALIDATION` |
| `CORRUPT_VIDEO` | ffprobe cannot read stream | ffprobe returns non-zero exit | `FAILED_VALIDATION` |

**UI behavior:** Show red error banner immediately with human-readable message. "Your video must be MP4 format, under 5 minutes, and under 300MB."

---

### Agent Failures — With Retry

All agent failures follow the same pattern:

```python
# modal_backend/pipeline.py

from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

RETRYABLE_ERRORS = (
    ConnectionError, TimeoutError, IOError,    # Network/storage transient
    RuntimeError,                               # GPU/CUDA transient
    Exception,                                  # Catch-all with retry limit
)

NON_RETRYABLE_ERRORS = (
    ValueError,      # Data validation — no point retrying
    AssertionError,  # Precondition violation — bug, not transient
)

def make_retrying_agent(agent_fn, max_attempts=3, backoff_base=2, backoff_max=30):
    @retry(
        reraise=True,
        stop=stop_after_attempt(max_attempts),
        wait=wait_exponential(multiplier=backoff_base, max=backoff_max),
        retry=retry_if_exception_type(RETRYABLE_ERRORS),
        before_sleep=lambda retry_state: log_retry(retry_state),
    )
    def wrapped(*args, **kwargs):
        return agent_fn(*args, **kwargs)
    return wrapped
```

### Agent-Specific Failure Modes

```
VIDEO AGENT failures:
  Code: FFMPEG_DECODE_FAILED     → Retry 3× → FAILED_VIDEO_AGENT
  Code: DINOV2_INFERENCE_ERROR   → Retry 3× → FAILED_VIDEO_AGENT
  Code: ZERO_KEYFRAMES           → No retry (permanent) → FAILED_VIDEO_AGENT
  Code: S3_UPLOAD_FAILED         → Retry 3× → FAILED_VIDEO_AGENT

QUALITY AGENT failures:
  Code: ZERO_CLEAN_FRAMES        → No retry (video unusable) → FAILED_QUALITY_AGENT
  Code: OPENCV_ERROR             → Retry 3× → FAILED_QUALITY_AGENT
  
PERCEPTION AGENT failures:
  Code: YOLOE_CUDA_OOM           → Retry with smaller batch → FAILED_PERCEPTION_AGENT
  Code: SAM2_CUDA_OOM            → Retry with smaller batch → FAILED_PERCEPTION_AGENT
  Code: HAWOR_MODEL_LOAD_FAILED  → Retry 3× → FAILED_PERCEPTION_AGENT
  Code: API_TIMEOUT              → Retry 3× → FAILED_PERCEPTION_AGENT
  Code: ZERO_DETECTIONS          → No retry (bad frames) → FAILED_PERCEPTION_AGENT
  
SEGMENTATION AGENT failures:
  Code: INVALID_PERCEPTION_DATA  → Retry 2× with stricter parsing → FAILED_SEGMENTATION_AGENT
  Code: ZERO_SEGMENTS            → No retry → FAILED_SEGMENTATION_AGENT
  
ACTION AGENT failures:
  Code: EGOVLM_CUDA_OOM          → Retry with batch_size=1 → FAILED_ACTION_AGENT
  Code: GEMINI_RATE_LIMIT        → Retry with backoff (up to 60s) → FAILED_ACTION_AGENT
  Code: GEMINI_SCHEMA_INVALID    → Retry with stricter prompt 2× → FAILED_ACTION_AGENT
  Code: MAX_UNKNOWN_ACTIONS      → No retry (quality gate) → FAILED_ACTION_AGENT
  
TASK GRAPH AGENT failures:
  Code: GEMINI_SERVICE_DOWN      → Retry 3× then use template graph → warning only
  Code: GEMINI_SCHEMA_INVALID    → Retry 2× with simpler prompt → FAILED_TASK_GRAPH_AGENT
  Code: EMPTY_ACTION_LIST        → No retry (upstream failure) → FAILED_TASK_GRAPH_AGENT
  
DATASET BUILDER failures:
  Code: PYDANTIC_VALIDATION_FAIL → Retry with relaxed schema 2× → FAILED_DATASET_BUILDER
  Code: RLDS_WRITE_FAILED        → Retry 3×; partial JSON still saved → warn if RLDS absent
  Code: ZERO_VLA_RECORDS         → No retry → FAILED_DATASET_BUILDER
```

---

## 15.3 Retry Implementation — Complete Code

```python
# modal_backend/agents/base.py

import time
import structlog
from tenacity import (
    retry, stop_after_attempt, wait_exponential,
    retry_if_exception_type, before_sleep_log, RetryError
)
from supabase import Client

log = structlog.get_logger()

class BaseAgent:
    def __init__(self, job_id: str, trace_id: str, supabase: Client):
        self.job_id = job_id
        self.trace_id = trace_id
        self.supabase = supabase
        self.logger = log.bind(job_id=job_id, trace_id=trace_id, agent=self.AGENT_NAME)
    
    AGENT_NAME: str  # Override in subclasses
    AGENT_STATUS: str  # e.g., "VIDEO_AGENT_RUNNING"
    FAILED_STATUS: str  # e.g., "FAILED_VIDEO_AGENT"
    MAX_RETRIES: int = 3
    BACKOFF_BASE: int = 2
    BACKOFF_MAX: int = 30
    
    def run(self, state: dict) -> dict:
        """
        Public entry point. Handles DB recording, retries, and terminal failure.
        Subclasses implement _run_internal().
        """
        # Write checkpoint: "we started this agent"
        self._write_checkpoint(state)
        
        # Record agent_run start
        run_id = self._start_agent_run()
        
        start_ms = int(time.time() * 1000)
        attempt = 1
        
        @retry(
            reraise=True,
            stop=stop_after_attempt(self.MAX_RETRIES),
            wait=wait_exponential(multiplier=self.BACKOFF_BASE, max=self.BACKOFF_MAX),
            retry=retry_if_exception_type((ConnectionError, TimeoutError, RuntimeError, IOError)),
            before_sleep=lambda rs: self.logger.warning(
                "agent_retrying",
                attempt=rs.attempt_number,
                error=str(rs.outcome.exception()),
                wait_sec=rs.next_action.sleep,
            ),
        )
        def attempt_run():
            nonlocal attempt
            result = self._run_internal(state)
            return result
        
        try:
            result = attempt_run()
            duration_ms = int(time.time() * 1000) - start_ms
            
            self.logger.info("agent_succeeded", duration_ms=duration_ms)
            self._complete_agent_run(run_id, "SUCCEEDED", duration_ms, attempt)
            return result
        
        except (ValueError, AssertionError) as e:
            # Non-retryable: data validation error
            duration_ms = int(time.time() * 1000) - start_ms
            error_code = getattr(e, "code", "VALIDATION_ERROR")
            
            self.logger.error("agent_failed_permanent", error_code=error_code, error=str(e))
            self._complete_agent_run(run_id, "FAILED", duration_ms, attempt, error_code, str(e))
            self._fail_job(error_code, str(e))
            raise
        
        except RetryError as e:
            # Exhausted all retries
            duration_ms = int(time.time() * 1000) - start_ms
            last_error = e.last_attempt.exception()
            error_code = getattr(last_error, "code", "MAX_RETRIES_EXHAUSTED")
            
            self.logger.error("agent_failed_retries_exhausted", error_code=error_code, error=str(last_error))
            self._complete_agent_run(run_id, "FAILED", duration_ms, self.MAX_RETRIES, error_code, str(last_error))
            self._fail_job(error_code, str(last_error))
            raise
    
    def _run_internal(self, state: dict) -> dict:
        """Override this in subclasses. Return state updates dict."""
        raise NotImplementedError
    
    def _fail_job(self, error_code: str, error_message: str):
        self.supabase.table("processing_jobs").update({
            "status": self.FAILED_STATUS,
            "failure_code": error_code,
            "failure_details": {"error": error_message, "agent": self.AGENT_NAME},
        }).eq("id", self.job_id).execute()
    
    def _start_agent_run(self) -> str:
        result = self.supabase.table("agent_runs").insert({
            "job_id": self.job_id,
            "agent": self.AGENT_NAME,
            "status": "RUNNING",
            "attempt": 1,
        }).execute()
        return result.data[0]["id"]
    
    def _complete_agent_run(self, run_id: str, status: str, duration_ms: int,
                             attempt: int, error_code: str = None, error_msg: str = None):
        self.supabase.table("agent_runs").update({
            "status": status,
            "duration_ms": duration_ms,
            "attempt": attempt,
            "error_code": error_code,
            "error_message": error_msg,
            "completed_at": "now()",
        }).eq("id", run_id).execute()
    
    def _write_checkpoint(self, state: dict):
        """Write current agent name to job checkpoints JSON for resume support."""
        self.supabase.table("processing_jobs").update({
            "failure_details": {
                "checkpoints": {
                    **(state.get("_checkpoints") or {}),
                    self.AGENT_NAME: {"started_at": time.time()},
                }
            }
        }).eq("id", self.job_id).execute()
```

---

## 15.4 Task Graph Graceful Degradation

The Task Graph Agent is the only one that can fail gracefully (pipeline still completes):

```python
# modal_backend/agents/task_graph_agent.py

def task_graph_node(state: PipelineState) -> PipelineState:
    agent = TaskGraphAgent(state["job_id"], state["trace_id"])
    
    try:
        result = agent.run(state)
        return {**state, **result}
    
    except (GeminiRateLimitError, GeminiServiceError) as e:
        # Graceful degradation — use a template linear task graph
        logger.warning("task_graph_using_template", error=str(e))
        
        template_graph = build_template_task_graph(state["action_records"])
        dataset_state = {**state, "task_graph": template_graph}
        
        # Mark job with warning but don't fail
        supabase.table("processing_jobs").update({
            "failure_details": json.dumps({
                "warnings": ["TASK_GRAPH_DEGRADED: Gemini unavailable, using template graph"]
            })
        }).eq("id", state["job_id"]).execute()
        
        return dataset_state


def build_template_task_graph(actions: list[ActionRecord]) -> TaskGraph:
    """If Gemini is unavailable, build a simple linear chain of actions."""
    nodes = [{"id": f"step_{i}", "label": a.action_label} for i, a in enumerate(actions)]
    edges = [{"from": f"step_{i}", "to": f"step_{i+1}"} for i in range(len(nodes) - 1)]
    return TaskGraph(nodes=nodes, edges=edges, root_node_id="step_0")
```

---

## 15.5 Watchdog — Stuck Job Recovery

```python
# modal_backend/app.py

@app.function(schedule=modal.Period(seconds=60), secrets=[SUPABASE_SECRET])
def watchdog():
    """
    Runs every 60 seconds. Detects stuck jobs and either resumes or fails them.
    
    A job is "stuck" if it has been in a *_RUNNING status for > HEARTBEAT_TIMEOUT_SEC
    without any update to its updated_at timestamp.
    """
    from datetime import datetime, timezone, timedelta
    
    sb = create_supabase_service_client()
    now = datetime.now(timezone.utc)
    timeout = timedelta(seconds=CONFIG.HEARTBEAT_TIMEOUT_SEC)  # 180s
    
    # Find all jobs currently running
    running = sb.table("processing_jobs") \
        .select("id, status, updated_at, failure_details, trace_id") \
        .like("status", "%_RUNNING") \
        .execute().data
    
    for job in running:
        updated_at = datetime.fromisoformat(job["updated_at"].replace("Z", "+00:00"))
        age = now - updated_at
        
        if age < timeout:
            continue  # Job is still actively updating — fine
        
        # Job is stuck
        job_id = job["id"]
        checkpoints = (job.get("failure_details") or {}).get("checkpoints", {})
        
        # Determine last successful checkpoint
        last_completed = _get_last_completed_agent(checkpoints)
        
        if last_completed and _can_resume(last_completed):
            # Re-trigger pipeline from checkpoint
            logger.warning("watchdog_resuming_job",
                         job_id=job_id, age_sec=int(age.total_seconds()),
                         last_completed=last_completed)
            
            # Reset status to QUEUED so pipeline re-triggers
            sb.table("processing_jobs").update({
                "status": "QUEUED",
                "failure_details": {**job.get("failure_details", {}), 
                                    "resume_reason": "WATCHDOG_HEARTBEAT_TIMEOUT"}
            }).eq("id", job_id).execute()
            
            # Re-trigger Modal
            execute_pipeline.spawn(job_id, job["trace_id"])
        
        else:
            # Can't resume — mark as terminal failure
            logger.error("watchdog_failing_job",
                        job_id=job_id, age_sec=int(age.total_seconds()))
            
            sb.table("processing_jobs").update({
                "status": "FAILED_ORCHESTRATOR",
                "failure_code": "HEARTBEAT_TIMEOUT",
                "failure_details": {
                    "error": f"Job stuck for {int(age.total_seconds())}s with no heartbeat",
                    "last_known_status": job["status"],
                }
            }).eq("id", job_id).execute()
```

---

## 15.6 Data Integrity on Failure — Write Order Protocol

**Rule:** Always write in this order within any agent:
1. Storage artifact upload
2. Domain table row insert
3. Artifact table row insert
4. Job status transition

If step 3 or 4 fails: the storage object is an orphan (GC will clean it up). The domain row and artifact row are consistent because they're in the same DB transaction.

```python
# modal_backend/agents/base.py — Transactional write pattern

def persist_agent_output(
    self,
    artifact_data: bytes,
    artifact_type: str,
    filename: str,
    domain_rows: list[dict],  # rows to insert into domain tables
    domain_table: str,
    next_status: str,
    next_progress: int,
):
    """
    Atomic-ish persistence of agent output.
    If any step fails, raises and the retry wrapper retries the whole agent.
    """
    
    # Step 1: Upload to storage (outside DB transaction)
    object_key = make_object_key(self.job_id, artifact_type, filename)
    bucket = BUCKET_FOR_TYPE[artifact_type]
    sha256 = hashlib.sha256(artifact_data).hexdigest()
    
    self.supabase.storage.from_(bucket).upload(
        path=object_key,
        file=artifact_data,
        file_options={"content_type": "application/json", "upsert": "true"},
    )
    # ↑ If this fails, nothing in DB is written yet. Safe to retry.
    
    # Step 2: Insert domain rows
    if domain_rows:
        self.supabase.table(domain_table).insert(domain_rows).execute()
    
    # Step 3: Insert artifacts row
    self.supabase.table("artifacts").insert({
        "job_id": str(self.job_id),
        "artifact_type": artifact_type,
        "producer_agent": self.AGENT_NAME,
        "bucket": bucket,
        "object_key": object_key,
        "content_type": "application/json",
        "size_bytes": len(artifact_data),
        "sha256": sha256,
    }).execute()
    
    # Step 4: Update job status (last — if this fails, artifact exists but status not updated)
    # On retry: agent re-runs, upsert=true on storage means no duplicate
    self.supabase.table("processing_jobs").update({
        "status": next_status,
        "current_agent": self.AGENT_NAME,
        "progress_percent": next_progress,
        "updated_at": "now()",
    }).eq("id", str(self.job_id)).execute()
```

---

## 15.7 Cancellation and Cleanup

When a user navigates away or requests cancellation (future feature):

```python
# Future: POST /api/job/:id/cancel endpoint

async function cancelJob(jobId: str, token: str):
    # 1. Validate token
    # 2. Only QUEUED or *_RUNNING jobs can be cancelled
    # 3. Update status to CANCELLED
    # 4. Signal Modal to stop (Modal doesn't support remote cancellation natively
    #    → pipeline checks for CANCELLED status at each agent boundary)
    # 5. Async cleanup: delete intermediate artifacts from storage (keep only dataset if complete)
```

**Cleanup logic in agents:**
```python
# modal_backend/agents/base.py — add cancellation check
def _check_cancelled(self):
    job = self.supabase.table("processing_jobs") \
        .select("status").eq("id", self.job_id).single().execute().data
    if job["status"] == "CANCELLED":
        raise CancelledError(f"Job {self.job_id} was cancelled")
```

---

## 15.8 Edge Cases & Recovery Matrix

| Scenario | What Breaks | Detection | Recovery |
|---|---|---|---|
| Modal container OOM (whole container crashes) | Job stuck in `*_RUNNING` | Watchdog heartbeat timeout (180s) | Re-trigger from checkpoint |
| Supabase goes down mid-pipeline | DB writes fail | Storage write succeeds but DB insert raises | `tenacity` retries all DB writes; if Supabase still down after 3 retries → `FAILED_ORCHESTRATOR` |
| Gemini API returns 500 | Task Graph Agent fails | `GeminiServiceError` | 3 retries → fall back to template graph |
| Partial artifact write (crash during upload) | Corrupt artifact in storage | Artifact row never inserted → artifact_type missing from DB | Agent detects missing artifact on retry → re-uploads |
| User kills browser mid-upload | Video never lands in Storage | `POST /api/process` checks for `RAW_VIDEO` artifact row → 409 | User must re-upload |
| DB split-brain (status=COMPLETED but dataset missing) | Dataset download returns 404 | Manifest row missing | Not possible — Dataset Builder writes manifest before status transition |
| Concurrent identical upload (race condition) | Two jobs for same SHA-256 | `idempotency_key` UNIQUE constraint | Second insert fails → first job returned to client |

---
