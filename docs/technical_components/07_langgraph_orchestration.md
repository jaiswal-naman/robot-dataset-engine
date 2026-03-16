# AutoEgoLab v3.0 — LangGraph Orchestration Design
**Document owner:** AI Systems Engineering  
**Revision:** 2.0 | **Date:** 2026-03-16 | **Status:** Build-Ready

---

## 7.1 Why LangGraph?

LangGraph is chosen over a plain Python state machine or Celery task queue for specific reasons:

| Need | LangGraph Solution |
|---|---|
| Typed stateful graph | `TypedDict` state flows through nodes, fully typed |
| Parallel branches | Native fan-out/fan-in with `add_edge` to multiple nodes |
| Conditional routing | `add_conditional_edges` for error/retry flows |
| Checkpoint support | `MemorySaver` or custom checkpointer for recovery |
| LangSmith integration | Every node execution auto-traced via `LANGCHAIN_TRACING_V2=true` |

Unlike Celery, LangGraph makes the **data flow between nodes explicit** in the graph definition. Unlike raw Python orchestration, it provides built-in trace scoping, state validation, and re-execution semantics.

---

## 7.2 Complete State Schema

```python
# modal_backend/schemas/pipeline_state.py
from typing import TypedDict, Optional

class PipelineState(TypedDict, total=False):
    # Core identity
    job_id: str                          # UUID string — never changes
    trace_id: str                        # LangSmith trace correlation ID

    # Job control
    status: str                          # mirrors processing_jobs.status
    attempt_map: dict[str, int]          # {"VIDEO_AGENT": 1, "QUALITY_AGENT": 2, ...}
    warnings: list[str]                  # non-fatal warnings accumulated across agents

    # Artifact references (populated as agents complete)
    video_artifact_id: str               # UUID — raw video artifact
    raw_frame_artifact_ids: list[str]    # UUIDs — extracted raw frames
    clean_frame_artifact_ids: list[str]  # UUIDs — quality-filtered frames

    # Perception branch outputs (intermediate, merged into perception_artifact_id)
    object_perception_artifact_id: str  # UUID — YOLOE detections JSON
    mask_perception_artifact_id: str    # UUID — SAM masks JSON
    hand_perception_artifact_id: str    # UUID — HaWoR hand poses JSON
    perception_artifact_id: str         # UUID — merged perception JSON

    # Domain data references (DB row IDs populated after DB writes)
    segment_ids: list[str]              # UUIDs — skill_segments rows
    action_ids: list[str]               # UUIDs — actions rows
    task_graph_id: str                  # UUID — task_graphs row
    dataset_manifest_id: str            # UUID — dataset_manifests row

    # Observability
    started_at: str                      # ISO8601 — pipeline start time
    last_heartbeat_at: str               # ISO8601 — updated by watchdog heartbeat
    errors: list[dict]                   # accumulated error records (non-fatal)
```

**State invariants:**
- `job_id` and `trace_id` are set in `init_job` and never modified
- Every key is `Optional` (`total=False`) — agents only write keys they produce
- Agents read only the keys they need; missing keys trigger `KeyError` if upstream failed

---

## 7.3 Graph Node Definitions

Every Modal function that acts as a node must be wrapped in the `run_agent_node` wrapper from `pipeline.py` to ensure consistent status transitions and DB writes.

```python
# modal_backend/pipeline.py
from langgraph.graph import StateGraph, END
from tenacity import retry, stop_after_attempt, wait_exponential_jitter

# ─── Node Functions ──────────────────────────────────────────────────────────

def init_job_node(state: PipelineState) -> PipelineState:
    """Set started_at and initial heartbeat. Validates job is in QUEUED state."""
    job = supabase.table("processing_jobs").select("status,trace_id") \
        .eq("id", state["job_id"]).single().execute().data
    assert job["status"] == "QUEUED", f"Expected QUEUED, got {job['status']}"
    return {
        **state,
        "started_at": now_iso(),
        "last_heartbeat_at": now_iso(),
        "warnings": [],
        "errors": [],
        "attempt_map": {},
    }

def video_agent_node(state: PipelineState) -> PipelineState:
    from agents.video_agent import VideoAgent
    return run_agent_node("VIDEO_AGENT", VideoAgent, state)

def quality_agent_node(state: PipelineState) -> PipelineState:
    from agents.quality_agent import QualityAgent
    return run_agent_node("QUALITY_AGENT", QualityAgent, state)

def perception_prepare_node(state: PipelineState) -> PipelineState:
    """Fan-out coordinator — no computation, just DB status update."""
    transition_job(state["job_id"], "PERCEPTION_AGENT_RUNNING", "PERCEPTION_OBJECT_BRANCH")
    return state

def perception_object_branch_node(state: PipelineState) -> PipelineState:
    """Runs on T4 GPU — YOLOE-26x-seg detection."""
    from agents.perception_object import ObjectPerceptionAgent
    return run_branch_node("PERCEPTION_OBJECT_BRANCH", ObjectPerceptionAgent, state)

def perception_mask_branch_node(state: PipelineState) -> PipelineState:
    """Runs on T4 GPU — SAM 2.1 mask tracking."""
    from agents.perception_mask import MaskPerceptionAgent
    return run_branch_node("PERCEPTION_MASK_BRANCH", MaskPerceptionAgent, state)

def perception_hand_branch_node(state: PipelineState) -> PipelineState:
    """Runs on A10G GPU — HaWoR hand pose recovery."""
    from agents.perception_hand import HandPerceptionAgent
    return run_branch_node("PERCEPTION_HAND_BRANCH", HandPerceptionAgent, state)

def perception_merge_node(state: PipelineState) -> PipelineState:
    """Fuses outputs of all 3 perception branches. Contact heuristic runs here."""
    from agents.perception_merge import PerceptionMergeAgent
    return run_agent_node("PERCEPTION_MERGE", PerceptionMergeAgent, state)

def segmentation_agent_node(state: PipelineState) -> PipelineState:
    from agents.segmentation_agent import SegmentationAgent
    return run_agent_node("SEGMENTATION_AGENT", SegmentationAgent, state)

def action_agent_node(state: PipelineState) -> PipelineState:
    from agents.action_agent import ActionAgent
    return run_agent_node("ACTION_AGENT", ActionAgent, state)

def task_graph_agent_node(state: PipelineState) -> PipelineState:
    from agents.task_graph_agent import TaskGraphAgent
    return run_agent_node("TASK_GRAPH_AGENT", TaskGraphAgent, state)

def dataset_builder_node(state: PipelineState) -> PipelineState:
    from agents.dataset_builder import DatasetBuilder
    return run_agent_node("DATASET_BUILDER", DatasetBuilder, state)

def finalize_success_node(state: PipelineState) -> PipelineState:
    """Write COMPLETED status and final runtime metrics."""
    supabase.table("processing_jobs").update({
        "status": "COMPLETED",
        "completed_at": now_iso(),
        "progress_percent": 100,
        "current_agent": None,
    }).eq("id", state["job_id"]).execute()
    return state

def finalize_failure_node(state: PipelineState) -> PipelineState:
    """Write terminal failure status from accumulated errors."""
    last_error = state["errors"][-1] if state.get("errors") else {}
    supabase.table("processing_jobs").update({
        "status": last_error.get("failure_status", "FAILED_ORCHESTRATOR"),
        "failure_code": last_error.get("error_code", "UNKNOWN"),
        "failure_details": {"last_error": last_error, "all_errors": state.get("errors", [])},
        "completed_at": now_iso(),
    }).eq("id", state["job_id"]).execute()
    return state
```

---

## 7.4 Graph Assembly — Complete LangGraph Construction

```python
# modal_backend/pipeline.py (continued)

def build_pipeline_graph() -> "CompiledGraph":
    builder = StateGraph(PipelineState)

    # ─── Add all nodes ───────────────────────────────────────────────────────
    builder.add_node("init_job", init_job_node)
    builder.add_node("video_agent", video_agent_node)
    builder.add_node("quality_agent", quality_agent_node)
    builder.add_node("perception_prepare", perception_prepare_node)
    builder.add_node("perception_object_branch", perception_object_branch_node)
    builder.add_node("perception_mask_branch", perception_mask_branch_node)
    builder.add_node("perception_hand_branch", perception_hand_branch_node)
    builder.add_node("perception_merge", perception_merge_node)
    builder.add_node("segmentation_agent", segmentation_agent_node)
    builder.add_node("action_agent", action_agent_node)
    builder.add_node("task_graph_agent", task_graph_agent_node)
    builder.add_node("dataset_builder", dataset_builder_node)
    builder.add_node("finalize_success", finalize_success_node)
    builder.add_node("finalize_failure", finalize_failure_node)

    # ─── Set entry point ─────────────────────────────────────────────────────
    builder.set_entry_point("init_job")

    # ─── Linear edges (pre-parallel) ─────────────────────────────────────────
    builder.add_edge("init_job", "video_agent")
    builder.add_edge("video_agent", "quality_agent")
    builder.add_edge("quality_agent", "perception_prepare")

    # ─── Fan-out to parallel perception branches ─────────────────────────────
    builder.add_edge("perception_prepare", "perception_object_branch")
    builder.add_edge("perception_prepare", "perception_mask_branch")
    builder.add_edge("perception_prepare", "perception_hand_branch")

    # ─── Fan-in: all branches must complete before merge ─────────────────────
    builder.add_edge("perception_object_branch", "perception_merge")
    builder.add_edge("perception_mask_branch", "perception_merge")
    builder.add_edge("perception_hand_branch", "perception_merge")

    # ─── Linear edges (post-parallel) ────────────────────────────────────────
    builder.add_edge("perception_merge", "segmentation_agent")
    builder.add_edge("segmentation_agent", "action_agent")
    builder.add_edge("action_agent", "task_graph_agent")
    builder.add_edge("task_graph_agent", "dataset_builder")
    builder.add_edge("dataset_builder", "finalize_success")
    builder.add_edge("finalize_success", END)
    builder.add_edge("finalize_failure", END)

    return builder.compile()

PIPELINE = build_pipeline_graph()
```

---

## 7.5 Retry Logic — The `run_agent_node` Wrapper

Every node that can fail at a transient boundary is wrapped with `tenacity` retry policy. This is the most critical resilience mechanism in the system.

```python
# modal_backend/pipeline.py

RETRYABLE_EXCEPTIONS = (
    requests.exceptions.Timeout,
    requests.exceptions.ConnectionError,
    supabase.exceptions.APIError,  # transient Supabase HTTP 500/503
    openai.RateLimitError,          # Gemini 429 via openai compat layer
    torch.cuda.OutOfMemoryError,    # GPU OOM — triggers batch size reduction
)

def is_retryable(exc: Exception) -> bool:
    return isinstance(exc, RETRYABLE_EXCEPTIONS)

def run_agent_node(agent_name: str, AgentClass, state: PipelineState) -> PipelineState:
    """
    Wraps any agent execution with:
    - attempt tracking
    - DB status writes
    - exponential backoff retry
    - typed failure on exhaustion
    """
    attempt_map = state.get("attempt_map", {})
    attempt = attempt_map.get(agent_name, 0) + 1
    state["attempt_map"] = {**attempt_map, agent_name: attempt}

    @retry(
        stop=stop_after_attempt(CONFIG.NODE_MAX_RETRIES),
        wait=wait_exponential_jitter(
            initial=CONFIG.NODE_BACKOFF_BASE_SEC,
            exp_base=2,
            jitter=1,
            max=30,
        ),
        retry=retry_if_exception(is_retryable),
        reraise=True,
    )
    def _run():
        agent = AgentClass(job_id=state["job_id"], trace_id=state["trace_id"])
        result = agent.run(state)
        return merge_state(state, result.state_updates)

    try:
        return _run()
    except Exception as e:
        failure_status = AGENT_TO_FAILURE_STATUS.get(agent_name, "FAILED_ORCHESTRATOR")
        error_code = classify_error(e)

        # Append to error list (non-destructive — state still carries prior data)
        errors = state.get("errors", [])
        errors.append({
            "agent": agent_name,
            "attempt": attempt,
            "failure_status": failure_status,
            "error_code": error_code,
            "error_message": str(e),
            "timestamp": now_iso(),
        })
        state["errors"] = errors

        # Route to finalize_failure
        raise AgentTerminalFailure(failure_status, error_code, str(e))

AGENT_TO_FAILURE_STATUS = {
    "VIDEO_AGENT":     "FAILED_VIDEO_AGENT",
    "QUALITY_AGENT":   "FAILED_QUALITY_AGENT",
    "PERCEPTION_OBJECT_BRANCH": "FAILED_PERCEPTION_AGENT",
    "PERCEPTION_MASK_BRANCH":   "FAILED_PERCEPTION_AGENT",
    "PERCEPTION_HAND_BRANCH":   "FAILED_PERCEPTION_AGENT",
    "PERCEPTION_MERGE":         "FAILED_PERCEPTION_AGENT",
    "SEGMENTATION_AGENT": "FAILED_SEGMENTATION_AGENT",
    "ACTION_AGENT":    "FAILED_ACTION_AGENT",
    "TASK_GRAPH_AGENT": "FAILED_TASK_GRAPH_AGENT",
    "DATASET_BUILDER":  "FAILED_DATASET_BUILDER",
}
```

---

## 7.6 Node Timeout Policy

Each Modal function has an explicit `timeout` parameter. If execution exceeds the timeout, Modal raises a `modal.exception.TimeoutError` which is caught by the `run_agent_node` wrapper as a retryable exception (up to 3 attempts in case of transient GPU cold-start delays).

```python
# modal_backend/app.py — Modal function decorators with explicit GPU + timeout

YOLOE_IMAGE = modal.Image.debian_slim().pip_install("ultralytics", "torch")
SAM_IMAGE   = modal.Image.debian_slim().pip_install("sam2", "torch")
HAWOR_IMAGE = modal.Image.debian_slim().pip_install("hawor", "torch")
VLM_IMAGE   = modal.Image.debian_slim().pip_install("transformers", "torch")
CPU_IMAGE   = modal.Image.debian_slim().pip_install("opencv-python", "numpy", "ffmpeg-python")

@app.function(gpu="T4",   timeout=120,  image=CPU_IMAGE,  secrets=[SUPABASE_SECRET])
def video_agent_fn(state): ...

@app.function(cpu=2,      timeout=60,   image=CPU_IMAGE,  secrets=[SUPABASE_SECRET])
def quality_agent_fn(state): ...

@app.function(gpu="T4",   timeout=240,  image=YOLOE_IMAGE, secrets=[SUPABASE_SECRET])
def perception_object_fn(state): ...

@app.function(gpu="T4",   timeout=240,  image=SAM_IMAGE,  secrets=[SUPABASE_SECRET])
def perception_mask_fn(state): ...

@app.function(gpu="A10G", timeout=240,  image=HAWOR_IMAGE, secrets=[SUPABASE_SECRET])
def perception_hand_fn(state): ...

@app.function(cpu=2,      timeout=60,   image=CPU_IMAGE,  secrets=[SUPABASE_SECRET])
def segmentation_fn(state): ...

@app.function(gpu="A10G", timeout=180,  image=VLM_IMAGE,  secrets=[SUPABASE_SECRET, GEMINI_SECRET])
def action_agent_fn(state): ...

@app.function(cpu=2,      timeout=120,  image=CPU_IMAGE,  secrets=[GEMINI_SECRET, SUPABASE_SECRET])
def task_graph_fn(state): ...

@app.function(cpu=2,      timeout=60,   image=CPU_IMAGE,  secrets=[SUPABASE_SECRET])
def dataset_builder_fn(state): ...
```

---

## 7.7 Heartbeat Mechanism

The LangGraph pipeline updates `last_heartbeat_at` in `processing_jobs` every time a node starts. The watchdog (a separate scheduled Modal function) checks for stale heartbeats.

```python
# modal_backend/pipeline.py

def update_heartbeat(job_id: str):
    supabase.table("processing_jobs").update({
        "updated_at": now_iso(),
    }).eq("id", job_id).execute()

# ─── Watchdog scheduled function ─────────────────────────────────────────────
@app.function(schedule=modal.Period(seconds=60))
def watchdog():
    """Runs every 60 seconds. Detects stuck RUNNING jobs."""
    running_jobs = supabase.table("processing_jobs") \
        .select("id, status, updated_at") \
        .like("status", "%_RUNNING") \
        .execute().data
    
    for job in running_jobs:
        stale_seconds = (now_utc() - parse_iso(job["updated_at"])).total_seconds()
        if stale_seconds > CONFIG.HEARTBEAT_TIMEOUT_SEC:
            # Check if Modal has an active task for this job
            # (In production: query Modal's job API or use Redis-backed task registry)
            if not has_active_modal_task(job["id"]):
                attempt_resume(job["id"])


def attempt_resume(job_id: str):
    """Try to rebuild state from checkpoints and re-trigger pipeline."""
    state = build_resume_state(job_id)  # From 05_ai_pipeline.md Section 5.5
    if state:
        execute_pipeline.spawn(job_id=job_id, trace_id=state["trace_id"],
                               resume_from_state=state)
    else:
        supabase.table("processing_jobs").update({
            "status": "FAILED_ORCHESTRATOR",
            "failure_code": "HEARTBEAT_TIMEOUT",
            "failure_details": {"reason": f"No heartbeat for {CONFIG.HEARTBEAT_TIMEOUT_SEC}s"},
        }).eq("id", job_id).execute()
```

---

## 7.8 Complete Pipeline Execution Entry Point

```python
# modal_backend/pipeline.py

@app.function(cpu=4, memory=4096, timeout=1200, secrets=[SUPABASE_SECRET])
def execute_pipeline(job_id: str, trace_id: str, resume_from_state: dict | None = None):
    """
    Main pipeline entry point. Called by Modal webhook and watchdog resume.
    """
    import langsmith
    
    # Configure LangSmith tracing
    os.environ["LANGCHAIN_TRACING_V2"] = "true"
    os.environ["LANGCHAIN_PROJECT"] = os.environ.get("LANGCHAIN_PROJECT", "autoegolab")
    
    with langsmith.trace(name="autoegolab-pipeline", run_id=trace_id) as run:
        initial_state: PipelineState = resume_from_state or {
            "job_id": job_id,
            "trace_id": trace_id,
        }
        
        try:
            # Stream execution — each node result is yielded
            for event in PIPELINE.stream(initial_state, stream_mode="values"):
                # Update heartbeat on each node completion
                update_heartbeat(job_id)
                
                # Log current state (scrubbed of large data)
                print(f"[Pipeline] Node complete. Status: {event.get('status', 'unknown')}")
        
        except AgentTerminalFailure as e:
            # Route to finalize_failure
            PIPELINE.invoke({**initial_state, "errors": [{
                "failure_status": e.failure_status,
                "error_code": e.error_code,
                "error_message": str(e),
            }]}, start_node="finalize_failure")
        
        except Exception as e:
            # Unexpected orchestrator-level failure
            supabase.table("processing_jobs").update({
                "status": "FAILED_ORCHESTRATOR",
                "failure_code": "UNEXPECTED_ERROR",
                "failure_details": {"error": str(e)},
            }).eq("id", job_id).execute()
            raise
```

---

## 7.9 Graph Execution Timing Estimate

```
init_job                   ~0.5s  (DB read + state init)
video_agent               ~12s   (T4 GPU, DINOv2 + ffmpeg)
quality_agent              ~4s   (CPU, OpenCV)
perception_prepare         ~0.2s  (no-op)
  ├── object_branch        ~25s  (T4, YOLOE-26x-seg)     ─┐
  ├── mask_branch          ~35s  (T4, SAM 2.1)            ─┤ parallel
  └── hand_branch          ~30s  (A10G, HaWoR)           ─┘ max = ~35s
perception_merge            ~5s  (CPU, JSON fusion)
segmentation_agent          ~8s  (CPU, signal processing)
action_agent               ~28s  (A10G, EgoVLM-3B)
task_graph_agent           ~18s  (external Gemini API)
dataset_builder             ~4s  (CPU, Pydantic + file I/O)
finalize_success            ~0.5s (DB write)

TOTAL (p50)               ~120-150s  (approx 2.5 minutes)
TOTAL (p95)               ~230-300s  (approx 5 minutes)
```

---
