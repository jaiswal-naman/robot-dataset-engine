import os
import modal
from supabase import create_client, Client
from pydantic import BaseModel
from typing import Optional
from fastapi import Request, HTTPException

# Setup Modal App
app = modal.App("autoegolab-v3")


# ── Modal GPU / CPU images ─────────────────────────────────────────────────
# Loose version constraints to avoid PyPI mirror conflicts on Modal build servers.
# Heavy model checkpoints are NOT pre-downloaded at build time to keep builds fast
# — they download on first inference and are cached by Modal's volume system.

# Base image — orchestrator, quality agent, segmentation, task-graph, dataset builder
CPU_IMAGE = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "libgl1", "libglib2.0-0")
    .pip_install(
        "supabase>=2.4",
        "pydantic>=2.6",
        "numpy>=1.24",
        "opencv-python-headless>=4.8",
        "Pillow>=10.0",
        "scikit-learn-extra>=0.3",
        "langgraph>=0.1",
        "ffmpeg-python>=0.2",
        "google-generativeai>=0.5",
        "instructor>=1.2",
        "fastapi>=0.111",
        "python-multipart>=0.0.9",
        "tenacity>=8.2",
    )
)

# DINOv2 + k-medoids for Video Agent (T4 GPU)
DINOV2_IMAGE = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "libgl1", "libglib2.0-0")
    .pip_install(
        "torch>=2.2",
        "torchvision>=0.17",
        "Pillow>=10.0",
        "numpy>=1.24",
        "scikit-learn-extra>=0.3",
        "supabase>=2.4",
        "pydantic>=2.6",
        "ffmpeg-python>=0.2",
    )
)

# YOLOE-26x-seg for Object Perception (T4 GPU)
YOLOE_IMAGE = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("libgl1", "libglib2.0-0", "libglib2.0-dev")
    .pip_install(
        "ultralytics>=8.2",
        "torch>=2.2",
        "torchvision>=0.17",
        "Pillow>=10.0",
        "numpy>=1.24",
        "supabase>=2.4",
        "pydantic>=2.6",
        "pycocotools>=2.0",
    )
)

# SAM 2.1 for Mask Perception (T4 GPU)
# Two-stage install: GPU packages first with numpy<2 pinned, supabase added after
SAM2_IMAGE = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("libgl1", "libglib2.0-0", "wget", "git")
    .run_commands(
        # Stage 1: pin numpy<2 + install torch + SAM2 from source (no-deps so numpy stays pinned)
        "pip install 'numpy<2.0' pillow pycocotools",
        "pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121",
        "pip install 'git+https://github.com/facebookresearch/sam2.git' --no-deps",
        # Stage 2: download checkpoint (~900 MB cached by Modal)
        "mkdir -p /model-cache && wget -q -O /model-cache/sam2.1_hiera_large.pt "
        "https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_large.pt",
    )
    # Stage 3: supabase installed last in separate layer — pip resolves against already-pinned numpy
    .pip_install("supabase>=2.4", "pydantic>=2.6")
)

# NOTE: HaWoR hand perception removed — image build incompatible with Modal.
# Hand data is skipped in the pipeline; other perception branches still run.

# TensorFlow for Dataset Builder RLDS TFRecord output (CPU)
TF_IMAGE = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "tensorflow-cpu>=2.16",
        "supabase>=2.4",
        "pydantic>=2.6",
        "numpy>=1.24",
        "Pillow>=10.0",
    )
)

# Keep basic_image as alias for CPU_IMAGE
basic_image = CPU_IMAGE




class WebhookPayload(BaseModel):
    job_id: str
    trace_id: str

def get_supabase() -> Client:
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    return create_client(url, key)

# Status → Progress % mapping (mirrors the FSM in docs/04_end_to_end_flow.md)
STATUS_TO_PROGRESS = {
    "UPLOADED":                   0,
    "QUEUED":                     2,
    "VIDEO_AGENT_RUNNING":       10,
    "QUALITY_AGENT_RUNNING":     22,
    "PERCEPTION_AGENT_RUNNING":  35,
    "SEGMENTATION_AGENT_RUNNING": 62,
    "ACTION_AGENT_RUNNING":      72,
    "TASK_GRAPH_AGENT_RUNNING":  86,
    "DATASET_BUILDER_RUNNING":   94,
    "COMPLETED":                 100,
}

def update_job_status(job_id: str, status: str, current_agent: Optional[str] = None,
                       failure_code: Optional[str] = None, failure_details: Optional[dict] = None):
    supabase = get_supabase()
    updates = {
        "status": status,
        "updated_at": "now()",
        "progress_percent": STATUS_TO_PROGRESS.get(status, 0),
    }
    if current_agent is not None:
        updates["current_agent"] = current_agent
    if status == "COMPLETED":
        updates["completed_at"] = "now()"
        updates["progress_percent"] = 100
        updates["current_agent"] = None
    elif status.startswith("FAILED"):
        updates["completed_at"] = "now()"
        updates["current_agent"] = None
        if failure_code:
            updates["failure_code"] = failure_code
        if failure_details:
            updates["failure_details"] = failure_details
    supabase.table("processing_jobs").update(updates).eq("id", job_id).execute()

    # Write job_events row for observability
    try:
        supabase.table("job_events").insert({
            "job_id": job_id,
            "event_type": "job_status_updated",
            "payload": {"status": status, "current_agent": current_agent,
                        "progress_percent": STATUS_TO_PROGRESS.get(status, 0)},
        }).execute()
    except Exception as e:
        print(f"[warn] Could not write job_event: {e}")

def write_agent_run(job_id: str, agent_name: str, status: str, attempt: int = 1,
                    output_count: int = 0, duration_ms: int = 0,
                    error_code: Optional[str] = None, error_message: Optional[str] = None) -> Optional[str]:
    supabase = get_supabase()
    try:
        row = {
            "job_id": job_id,
            "agent": agent_name,
            "attempt": attempt,
            "status": status,
        }
        if status == "RUNNING":
            row["started_at"] = "now()"
        else:
            row["finished_at"] = "now()"
            row["output_count"] = output_count
            row["duration_ms"] = duration_ms
        if error_code:
            row["error_code"] = error_code
        if error_message:
            row["error_message"] = error_message[:1000]

        result = supabase.table("agent_runs").insert(row).execute()
        if result.data:
            return result.data[0]["id"]
    except Exception as e:
        print(f"[warn] Could not write agent_run for {agent_name}: {e}")
    return None


# ═══════════════════════════════════════════════════════════════════════════════
# GPU AGENT FUNCTIONS — each runs on its own GPU container on Modal cloud
# ═══════════════════════════════════════════════════════════════════════════════

ALL_SECRETS = [
    modal.Secret.from_name("supabase-secrets"),
    modal.Secret.from_name("gemini-secrets"),
]

# ── Agent 1: Video Agent (DINOv2, T4 GPU) ─────────────────────────────────────
@app.function(gpu="T4", image=DINOV2_IMAGE, secrets=ALL_SECRETS, timeout=300,
              retries=modal.Retries(max_retries=2, backoff_coefficient=2))
def run_video_agent(job_id: str, trace_id: str, state: dict) -> dict:
    from modal_backend.agents.video import VideoAgent
    from modal_backend.app import update_job_status, write_agent_run
    import time
    update_job_status(job_id, "VIDEO_AGENT_RUNNING", current_agent="VIDEO_AGENT")
    write_agent_run(job_id, "VIDEO_AGENT", "RUNNING")
    t = time.time()
    result = VideoAgent(job_id, trace_id).run(state)
    dur = int((time.time() - t) * 1000)
    if result.status == "SUCCEEDED":
        write_agent_run(job_id, "VIDEO_AGENT", "SUCCEEDED", output_count=result.output_count, duration_ms=dur)
        state.update(result.state_updates)
    else:
        write_agent_run(job_id, "VIDEO_AGENT", "FAILED", error_code=result.error_code, error_message=result.error_message, duration_ms=dur)
        update_job_status(job_id, "FAILED_VIDEO_AGENT", failure_code=result.error_code)
    return state

# ── Agent 2: Quality Agent (CPU, pure NumPy) ───────────────────────────────────
@app.function(image=CPU_IMAGE, secrets=ALL_SECRETS, timeout=120,
              retries=modal.Retries(max_retries=2, backoff_coefficient=2))
def run_quality_agent(job_id: str, trace_id: str, state: dict) -> dict:
    from modal_backend.agents.quality import QualityAgent
    from modal_backend.app import update_job_status, write_agent_run
    import time
    update_job_status(job_id, "QUALITY_AGENT_RUNNING", current_agent="QUALITY_AGENT")
    write_agent_run(job_id, "QUALITY_AGENT", "RUNNING")
    t = time.time()
    result = QualityAgent(job_id, trace_id).run(state)
    dur = int((time.time() - t) * 1000)
    if result.status == "SUCCEEDED":
        write_agent_run(job_id, "QUALITY_AGENT", "SUCCEEDED", output_count=result.output_count, duration_ms=dur)
        state.update(result.state_updates)
    else:
        write_agent_run(job_id, "QUALITY_AGENT", "FAILED", error_code=result.error_code, error_message=result.error_message, duration_ms=dur)
        update_job_status(job_id, "FAILED_QUALITY_AGENT", failure_code=result.error_code)
    return state

# ── Agent 3a: Object Perception (YOLOE, T4 GPU) ────────────────────────────────
@app.function(gpu="T4", image=YOLOE_IMAGE, secrets=ALL_SECRETS, timeout=300,
              retries=modal.Retries(max_retries=2, backoff_coefficient=2))
def run_object_perception(job_id: str, trace_id: str, state: dict) -> dict:
    from modal_backend.agents.perception_object import ObjectPerceptionAgent
    from modal_backend.app import write_agent_run
    import time
    write_agent_run(job_id, "PERCEPTION_OBJECT_BRANCH", "RUNNING")
    t = time.time()
    result = ObjectPerceptionAgent(job_id, trace_id).run(state)
    dur = int((time.time() - t) * 1000)
    if result.status == "SUCCEEDED":
        write_agent_run(job_id, "PERCEPTION_OBJECT_BRANCH", "SUCCEEDED", output_count=result.output_count, duration_ms=dur)
        state.update(result.state_updates)
    else:
        write_agent_run(job_id, "PERCEPTION_OBJECT_BRANCH", "FAILED", error_code=result.error_code, error_message=result.error_message, duration_ms=dur)
    return state

# ── Agent 3b: Mask Perception (SAM 2.1, T4 GPU) ───────────────────────────────
@app.function(gpu="T4", image=SAM2_IMAGE, secrets=ALL_SECRETS, timeout=300,
              retries=modal.Retries(max_retries=2, backoff_coefficient=2))
def run_mask_perception(job_id: str, trace_id: str, state: dict) -> dict:
    from modal_backend.agents.perception_mask import MaskPerceptionAgent
    from modal_backend.app import write_agent_run
    import time
    write_agent_run(job_id, "PERCEPTION_MASK_BRANCH", "RUNNING")
    t = time.time()
    result = MaskPerceptionAgent(job_id, trace_id).run(state)
    dur = int((time.time() - t) * 1000)
    if result.status == "SUCCEEDED":
        write_agent_run(job_id, "PERCEPTION_MASK_BRANCH", "SUCCEEDED", output_count=result.output_count, duration_ms=dur)
        state.update(result.state_updates)
    else:
        write_agent_run(job_id, "PERCEPTION_MASK_BRANCH", "FAILED", error_code=result.error_code, error_message=result.error_message, duration_ms=dur)
    return state

# ── Agent 3c: Hand Perception — SKIPPED (HaWoR image build incompatible) ──────

# ── Agent 3d: Perception Merge (CPU) ──────────────────────────────────────────
@app.function(image=CPU_IMAGE, secrets=ALL_SECRETS, timeout=120)
def run_perception_merge(job_id: str, trace_id: str, state: dict) -> dict:
    from modal_backend.agents.perception_merge import PerceptionMergeAgent
    from modal_backend.app import write_agent_run
    import time
    write_agent_run(job_id, "PERCEPTION_MERGE", "RUNNING")
    t = time.time()
    result = PerceptionMergeAgent(job_id, trace_id).run(state)
    dur = int((time.time() - t) * 1000)
    if result.status == "SUCCEEDED":
        write_agent_run(job_id, "PERCEPTION_MERGE", "SUCCEEDED", output_count=result.output_count, duration_ms=dur)
        state.update(result.state_updates)
    else:
        write_agent_run(job_id, "PERCEPTION_MERGE", "FAILED", error_code=result.error_code, error_message=result.error_message, duration_ms=dur)
    return state

# ── Agent 4: Segmentation Agent (CPU, NumPy signal processing) ────────────────
@app.function(image=CPU_IMAGE, secrets=ALL_SECRETS, timeout=180)
def run_segmentation_agent(job_id: str, trace_id: str, state: dict) -> dict:
    from modal_backend.agents.segmentation import SegmentationAgent
    from modal_backend.app import update_job_status, write_agent_run
    import time
    update_job_status(job_id, "SEGMENTATION_AGENT_RUNNING", current_agent="SEGMENTATION_AGENT")
    write_agent_run(job_id, "SEGMENTATION_AGENT", "RUNNING")
    t = time.time()
    result = SegmentationAgent(job_id, trace_id).run(state)
    dur = int((time.time() - t) * 1000)
    if result.status == "SUCCEEDED":
        write_agent_run(job_id, "SEGMENTATION_AGENT", "SUCCEEDED", output_count=result.output_count, duration_ms=dur)
        state.update(result.state_updates)
    else:
        write_agent_run(job_id, "SEGMENTATION_AGENT", "FAILED", error_code=result.error_code, error_message=result.error_message, duration_ms=dur)
    return state

# ── Agent 5: Action Agent (EgoVLM, A10G GPU) ──────────────────────────────────
@app.function(gpu="A10G", image=CPU_IMAGE, secrets=ALL_SECRETS, timeout=600,
              retries=modal.Retries(max_retries=2, backoff_coefficient=2))
def run_action_agent(job_id: str, trace_id: str, state: dict) -> dict:
    from modal_backend.agents.action_agent import ActionAgent
    from modal_backend.app import update_job_status, write_agent_run
    import time
    update_job_status(job_id, "ACTION_AGENT_RUNNING", current_agent="ACTION_AGENT")
    write_agent_run(job_id, "ACTION_AGENT", "RUNNING")
    t = time.time()
    result = ActionAgent(job_id, trace_id).run(state)
    dur = int((time.time() - t) * 1000)
    if result.status == "SUCCEEDED":
        write_agent_run(job_id, "ACTION_AGENT", "SUCCEEDED", output_count=result.output_count, duration_ms=dur)
        state.update(result.state_updates)
    else:
        write_agent_run(job_id, "ACTION_AGENT", "FAILED", error_code=result.error_code, error_message=result.error_message, duration_ms=dur)
    return state

# ── Agent 6: Task Graph Agent (Gemini API, CPU) ────────────────────────────────
@app.function(image=CPU_IMAGE, secrets=ALL_SECRETS, timeout=120,
              retries=modal.Retries(max_retries=3, backoff_coefficient=2))
def run_task_graph_agent(job_id: str, trace_id: str, state: dict) -> dict:
    from modal_backend.agents.task_graph_agent import TaskGraphAgent
    from modal_backend.app import update_job_status, write_agent_run
    import time
    update_job_status(job_id, "TASK_GRAPH_AGENT_RUNNING", current_agent="TASK_GRAPH_AGENT")
    write_agent_run(job_id, "TASK_GRAPH_AGENT", "RUNNING")
    t = time.time()
    result = TaskGraphAgent(job_id, trace_id).run(state)
    dur = int((time.time() - t) * 1000)
    if result.status == "SUCCEEDED":
        write_agent_run(job_id, "TASK_GRAPH_AGENT", "SUCCEEDED", output_count=result.output_count, duration_ms=dur)
        state.update(result.state_updates)
    else:
        write_agent_run(job_id, "TASK_GRAPH_AGENT", "FAILED", error_code=result.error_code, error_message=result.error_message, duration_ms=dur)
    return state

# ── Agent 7: Dataset Builder (TensorFlow TFRecord, CPU) ───────────────────────
@app.function(image=TF_IMAGE, secrets=ALL_SECRETS, timeout=120)
def run_dataset_builder(job_id: str, trace_id: str, state: dict) -> dict:
    from modal_backend.agents.dataset_builder import DatasetBuilderAgent
    from modal_backend.app import update_job_status, write_agent_run
    import time
    update_job_status(job_id, "DATASET_BUILDER_RUNNING", current_agent="DATASET_BUILDER")
    write_agent_run(job_id, "DATASET_BUILDER", "RUNNING")
    t = time.time()
    result = DatasetBuilderAgent(job_id, trace_id).run(state)
    dur = int((time.time() - t) * 1000)
    if result.status == "SUCCEEDED":
        write_agent_run(job_id, "DATASET_BUILDER", "SUCCEEDED", output_count=result.output_count, duration_ms=dur)
        state.update(result.state_updates)
    else:
        write_agent_run(job_id, "DATASET_BUILDER", "FAILED", error_code=result.error_code, error_message=result.error_message, duration_ms=dur)
    return state


# ═══════════════════════════════════════════════════════════════════════════════
# ORCHESTRATOR — calls each GPU agent via .remote() sequentially
# ═══════════════════════════════════════════════════════════════════════════════
@app.function(
    image=basic_image,
    secrets=[modal.Secret.from_name("supabase-secrets")],
    timeout=3600,  # 60 min total budget
)
def run_pipeline_graph(job_id: str, trace_id: str):
    print(f"[{trace_id}] Pipeline started for job {job_id}")
    supabase = get_supabase()

    job_res = supabase.table("processing_jobs").select("status").eq("id", job_id).single().execute()
    if not job_res.data:
        print(f"Job {job_id} not found.")
        return

    video_res = supabase.table("artifacts").select("id") \
        .eq("job_id", job_id).eq("artifact_type", "RAW_VIDEO").execute()
    if not video_res.data:
        update_job_status(job_id, "FAILED_VIDEO_AGENT", failure_code="MISSING_VIDEO_ARTIFACT")
        return

    state = {
        "job_id": job_id,
        "trace_id": trace_id,
        "video_artifact_id": video_res.data[0]["id"],
        "raw_frame_artifact_ids": [],
        "clean_frame_artifact_ids": [],
        "segment_ids": [],
        "action_ids": [],
        "warnings": [],
    }

    try:
        # ── Sequential GPU pipeline via .remote() ──────────────────────────────
        state = run_video_agent.remote(job_id, trace_id, state)
        if supabase.table("processing_jobs").select("status").eq("id", job_id).single().execute().data.get("status", "").startswith("FAILED"):
            return

        state = run_quality_agent.remote(job_id, trace_id, state)
        if supabase.table("processing_jobs").select("status").eq("id", job_id).single().execute().data.get("status", "").startswith("FAILED"):
            return

        # Update perception status before parallel agents
        update_job_status(job_id, "PERCEPTION_AGENT_RUNNING", current_agent="PERCEPTION_OBJECT_BRANCH")

        # Run 2 perception branches in PARALLEL (hand perception skipped)
        obj_future  = run_object_perception.spawn(job_id, trace_id, state)
        mask_future = run_mask_perception.spawn(job_id, trace_id, state)

        # Wait for both and merge their state_updates
        obj_state  = obj_future.get()
        mask_state = mask_future.get()

        # Merge perception outputs into state
        state.update({k: v for k, v in obj_state.items() if k not in state or v})
        state.update({k: v for k, v in mask_state.items() if k not in state or v})

        state = run_perception_merge.remote(job_id, trace_id, state)
        state = run_segmentation_agent.remote(job_id, trace_id, state)
        state = run_action_agent.remote(job_id, trace_id, state)
        state = run_task_graph_agent.remote(job_id, trace_id, state)
        state = run_dataset_builder.remote(job_id, trace_id, state)

        update_job_status(job_id, "COMPLETED")
        print(f"[{trace_id}] ✅ Pipeline COMPLETED for job {job_id}")

    except Exception as e:
        import traceback
        traceback.print_exc()
        update_job_status(job_id, "FAILED_ORCHESTRATOR",
                          failure_code="ORCHESTRATOR_EXCEPTION",
                          failure_details={"error": str(e)[:500]})


# ═══════════════════════════════════════════════════════════════════════════════
# WEBHOOK — receives POST from Next.js /api/process
# ═══════════════════════════════════════════════════════════════════════════════
@app.function(
    image=basic_image,
    secrets=[modal.Secret.from_name("modal-webhook-secrets")],
)
@modal.fastapi_endpoint(method="POST")
async def submit_job(request: Request):
    """
    Receives POST from Next.js /api/process.
    Auth: Authorization: Bearer <MODAL_WEBHOOK_SECRET>
    Body: { job_id, trace_id }
    """
    auth_header = request.headers.get("authorization", "")
    expected_secret = os.environ.get("MODAL_WEBHOOK_SECRET", "")

    if not expected_secret or auth_header != f"Bearer {expected_secret}":
        raise HTTPException(status_code=401, detail="Unauthorized")

    try:
        body = await request.json()
        payload = WebhookPayload(**body)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid payload: {e}")

    update_job_status(payload.job_id, "QUEUED")

    # Spawn pipeline asynchronously — returns 202 immediately
    run_pipeline_graph.spawn(payload.job_id, payload.trace_id)

    return {"accepted": True, "job_id": payload.job_id, "trace_id": payload.trace_id}

