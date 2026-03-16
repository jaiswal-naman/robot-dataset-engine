# AutoEgoLab v3.0 — AI Pipeline Architecture
**Document owner:** AI Systems Engineering  
**Revision:** 2.0 | **Date:** 2026-03-16 | **Status:** Build-Ready

---

## 5.1 Pipeline Philosophy

### Why a Multi-Agent Sequential DAG?

The core design principle is **specialization over generalization**. A single large VLM trying to simultaneously:
- Detect 50+ object classes with pixel masks
- Track hand joints across 300 frames in 3D
- Find temporal skill boundaries
- Generate semantic action labels
- Synthesize a hierarchical task graph

...will fail at all of them. The error compounds at every step.

The multi-agent design assigns one task to one model at a time. Each agent is the best-in-class model for its specific modality. The sequential DAG ensures each agent always receives high-quality, validated inputs from its predecessor.

### The Information Pyramid

```
Raw Video (gigabytes of pixel data)
         │
    [Video Agent]          Temporal reduction: 1800 frames → 150 keyframes
         │
    [Quality Agent]        Quality filter: 150 → ~120 clean frames
         │
    [Perception Agent]     Semantic lift: pixels → objects + masks + hand poses
         │
    [Segmentation Agent]   Temporal signal → atomic skill boundaries
         │
    [Action Agent]         Skill clips → semantic action labels (text)
         │
    [Task Graph Agent]     Action sequence → hierarchical DAG (reasoning)
         │
    [Dataset Builder]      All structured data → VLA training record
         │
Structured VLA Dataset (kilobytes of dense signals)
```

Each stage compresses information while enriching its semantic depth. By the time we reach the Task Graph Agent, Gemini only needs to process a compact JSON array of ~30 action strings — not 300 raw frames.

---

## 5.2 Agent DAG — Detailed Dependency Map

```
                          ┌─────────────────┐
                          │   Video Agent   │  T4/CPU — DINOv2
                          └────────┬────────┘
                                   │
                        raw_frame_artifact_ids[]
                                   │
                          ┌────────▼────────┐
                          │  Quality Agent  │  CPU — OpenCV/NumPy
                          └────────┬────────┘
                                   │
                       clean_frame_artifact_ids[]
                                   │
                    ┌──────────────▼──────────────┐
                    │    perception_prepare        │
                    │  (fan-out coordinator node)  │
                    └──┬──────────────┬────────┬──┘
                       │              │        │
              ┌────────▼───┐  ┌───────▼──┐  ┌─▼────────┐
              │  Object    │  │  Mask    │  │  Hand    │
              │  Branch    │  │  Branch  │  │  Branch  │
              │  YOLOE     │  │  SAM 2.1 │  │  HaWoR   │
              │  (T4)      │  │  (T4)    │  │  (A10G)  │
              └────────┬───┘  └───────┬──┘  └─┬────────┘
                       │              │        │
                    ┌──▼──────────────▼────────▼──┐
                    │      perception_merge        │
                    │  (merge + contact heuristic) │
                    └─────────────┬───────────────┘
                                  │
                         perception_artifact_id
                                  │
                    ┌─────────────▼─────────────┐
                    │    Segmentation Agent     │  CPU — signal processing
                    └─────────────┬─────────────┘
                                  │
                             segment_ids[]
                                  │
                    ┌─────────────▼─────────────┐
                    │      Action Agent         │  A10G — EgoVLM-3B
                    └─────────────┬─────────────┘
                                  │
                             action_ids[]
                                  │
                    ┌─────────────▼─────────────┐
                    │    Task Graph Agent       │  External — Gemini API
                    └─────────────┬─────────────┘
                                  │
                          task_graph_id
                                  │
                    ┌─────────────▼─────────────┐
                    │     Dataset Builder       │  CPU — Pydantic/TF
                    └─────────────┬─────────────┘
                                  │
                       dataset_manifest_id
```

---

## 5.3 Data Contract Between Agents

**Rule: Agents never pass raw image bytes through LangGraph state.**

The `PipelineState` carries only lightweight identifiers. Actual data lives in Supabase Storage. Each agent downloads what it needs at the start of its execution and uploads results at the end.

### Why this matters:
- LangGraph state dictionary is serialized in memory. If it held frame arrays, a 300-frame video at 1920×1080 would require ~500MB of RAM in the state object alone.
- Storage URIs are stable across retries — if an agent fails and retries, it re-downloads the same artifacts without re-running upstream agents.
- This enables **portable checkpointing**: any agent can resume from storage-backed references.

### State reference types:
```python
# What flows through PipelineState
video_artifact_id: str           # UUID pointing to artifacts table
raw_frame_artifact_ids: list[str]  # UUIDs for each raw frame
clean_frame_artifact_ids: list[str]  # UUIDs after quality filter
perception_artifact_id: str      # UUID for consolidated perception JSON
segment_ids: list[str]           # UUIDs for skill_segments rows
action_ids: list[str]            # UUIDs for actions rows
task_graph_id: str               # UUID for task_graphs row
dataset_manifest_id: str         # UUID for dataset_manifests row
```

---

## 5.4 Why the Perception Agent Has Internal Parallelism

The Perception Agent is the most computationally expensive stage (p50: 75s, p95: 140s) because it runs three independent models:

| Branch | Model | GPU | Task |
|---|---|---|---|
| Object Branch | YOLOE-26x-seg | T4 | Object detection + segmentation masks |
| Mask Branch | SAM 2.1 | T4 | Mask refinement & temporal tracking |
| Hand Branch | HaWoR | A10G | 3D hand mesh recovery |

These three models are **statistically independent** at input: they all receive the same `CleanFrame[]` images and produce different output modalities. Running them in sequence would waste wall-clock time.

The `perception_prepare` node fans the input out to three parallel LangGraph branches. The `perception_merge` node aggregates all three outputs and runs the contact heuristic (which requires both hand poses AND object masks together).

**Parallel execution via LangGraph:**
```python
# pipeline.py
from langgraph.graph import StateGraph, END

builder = StateGraph(PipelineState)

# Parallel branches defined as separate nodes
builder.add_node("perception_prepare", perception_prepare_node)
builder.add_node("perception_object_branch", object_branch_node)
builder.add_node("perception_mask_branch", mask_branch_node)
builder.add_node("perception_hand_branch", hand_branch_node)
builder.add_node("perception_merge", perception_merge_node)

# Fan-out edges
builder.add_edge("perception_prepare", "perception_object_branch")
builder.add_edge("perception_prepare", "perception_mask_branch")
builder.add_edge("perception_prepare", "perception_hand_branch")

# Fan-in (LangGraph waits for all three before running merge)
builder.add_edge("perception_object_branch", "perception_merge")
builder.add_edge("perception_mask_branch", "perception_merge")
builder.add_edge("perception_hand_branch", "perception_merge")
```

LangGraph's fan-in semantics guarantee `perception_merge` only runs once **all three** upstream branches have completed.

---

## 5.5 Stage-Level Checkpointing

Every agent writes a "checkpoint" before transitioning the job status. This enables recovery.

```python
# Checkpoint pattern used by every agent
def checkpoint_after_agent(job_id: str, agent_stage: str, state_updates: dict):
    """
    Persists enough state to resume from this point.
    Written to: processing_jobs.failure_details['checkpoints'] JSONB field.
    """
    current = supabase.table("processing_jobs") \
        .select("failure_details") \
        .eq("id", job_id).single().execute().data
    
    checkpoints = current.get("failure_details", {}).get("checkpoints", {})
    checkpoints[agent_stage] = {
        "completed_at": now_iso(),
        "state_refs": state_updates,
    }
    
    supabase.table("processing_jobs").update({
        "failure_details": {"checkpoints": checkpoints}
    }).eq("id", job_id).execute()
```

**Resume logic:**
```python
def build_resume_state(job_id: str) -> PipelineState | None:
    """Reconstruct PipelineState from completed checkpoints in DB."""
    job = supabase.table("processing_jobs").select("*").eq("id", job_id).single().execute().data
    checkpoints = job.get("failure_details", {}).get("checkpoints", {})
    
    if not checkpoints:
        return None  # No progress to recover
    
    state = {"job_id": job_id, "trace_id": job["trace_id"]}
    for stage, data in checkpoints.items():
        state.update(data["state_refs"])
    return state
```

---

## 5.6 Pipeline Tunable Parameters

These values are defined in `modal_backend/config.py` and can be overridden per-deployment without code changes.

```python
# modal_backend/config.py

@dataclass
class PipelineConfig:
    # Video Agent
    FRAME_SAMPLE_FPS: float = 1.0       # frames sampled per second
    KEYFRAMES_PER_MIN: int = 30          # max keyframes per minute of video

    # Quality Agent
    BLUR_LAPLACIAN_MIN: float = 100.0    # Laplacian variance blur threshold
    BRIGHTNESS_MIN: int = 20             # min mean pixel brightness
    BRIGHTNESS_MAX: int = 235            # max mean pixel brightness
    OVEREXPOSED_RATIO_MAX: float = 0.15  # max fraction of overexposed pixels
    MIN_CLEAN_FRAMES: int = 10           # below this → FAILED_QUALITY_AGENT

    # Segmentation Agent
    MASK_DELTA_THRESHOLD: float = 0.15   # fraction mask area change = boundary
    CONTACT_HYSTERESIS_FRAMES: int = 3   # frames to confirm contact on/off
    MIN_SEGMENT_DURATION_MS: int = 1500  # merge segments shorter than this

    # Action Agent
    ACTION_CONFIDENCE_MIN: float = 0.40  # below this → Gemini fallback
    MAX_UNKNOWN_ACTION_FRACTION: float = 0.50  # above this → FAILED_ACTION_AGENT

    # General
    NODE_MAX_RETRIES: int = 3
    NODE_BACKOFF_BASE_SEC: int = 2
    PIPELINE_MAX_RUNTIME_SEC: int = 900
    HEARTBEAT_TIMEOUT_SEC: int = 180

CONFIG = PipelineConfig()
```

---

## 5.7 Edge Cases and Failure Modes

| Scenario | Detection | Agent Response |
|---|---|---|
| Video is entirely dark (night footage) | Quality Agent: brightness_mean < 20 for all frames | If all frames rejected → `FAILED_QUALITY_AGENT`; else `degraded=true`, continue |
| Hands occluded for >60% of video | HaWoR: no hand detections in most frames | contact_events list is empty; Segmentation falls back to mask-delta-only mode |
| No objects detected (empty factory floor) | YOLOE: no detections above 0.5 confidence | Segmentation emits one FALLBACK segment spanning full timeline |
| Gemini returns malformed JSON | `instructor` parser fails | Request retried with stricter output_schema prompt; 3rd failure → template fallback graph |
| SAM 2.1 VRAM OOM on T4 | CUDA OOM exception | Caught, batch size halved, retry same branch; if still OOM → `FAILED_PERCEPTION_AGENT` |
| Segment boundaries create 1-segment output | Segmentation: no boundaries found | Single FALLBACK segment with `confidence=0.1`; pipeline continues with warning |
| EgoVLM crashes (OOM) | Modal OOM kill signal | tenacity retries 3x with decreasing batch size; if all fail and Gemini fallback also fails → `FAILED_ACTION_AGENT` |

---
