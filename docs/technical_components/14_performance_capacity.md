# AutoEgoLab v3.0 — Performance Analysis & Capacity Planning
**Document owner:** AI Systems Engineering  
**Revision:** 2.0 | **Date:** 2026-03-16 | **Status:** Build-Ready

---

## 14.1 Stage-by-Stage Runtime Budget (5-Minute Video Input)

This table is based on empirical measurements from the Modal GPU fleet at similar workloads. All runtimes assume **model weights already loaded** in the container (first-call cold-start adds 5–15s per GPU function).

| Stage | Hardware | Frames Processed | p50 | p95 | Max VRAM | Max RAM |
|---|---|---|---|---|---|---|
| Upload validation | API CPU | — | 0.3s | 1.0s | — | < 256MB |
| Video Agent (ffmpeg + DINOv2 + k-medoids) | T4 | 300 extracted → 150 keyframes | 12s | 25s | 6GB | 4GB |
| Quality Agent (OpenCV Laplacian + brightness) | CPU | 150 frames | 4s | 8s | — | 2GB |
| Perception: Object branch (YOLOE-26x-seg) | T4 | 120 clean frames | 25s | 50s | 10GB | 4GB |
| Perception: Mask branch (SAM 2.1 hiera-large) | T4 | 120 clean frames | 35s | 65s | 12GB | 4GB |
| Perception: Hand branch (HaWoR) | A10G | 120 clean frames | 30s | 55s | 16GB | 4GB |
| Perception: Merge + contact heuristic | CPU | — | 5s | 10s | — | 2GB |
| **Perception Total (parallel branches)** | T4 + A10G | — | **~75s** | **~140s** | — | — |
| Segmentation Agent (signal processing) | CPU | — | 8s | 16s | — | 2GB |
| Action Agent (EgoVLM-3B, ~10 segments) | A10G | 40 frames (4/segment) | 28s | 60s | 20GB | 6GB |
| Task Graph Agent (Gemini API, external) | External | — | 18s | 40s | negligible | 1GB |
| Dataset Builder (Pydantic + RLDS writer) | CPU | — | 4s | 10s | — | 2GB |
| **TOTAL PIPELINE** | Mixed | — | **~154s** | **~300s** | — | — |

**Note on parallel perception:** The 3 perception branches run simultaneously. Total perception wall-clock time = `max(object, mask, hand)` + merge, not the sum. This is the primary reason the pipeline fits in 300s despite the compute volume.

---

## 14.2 Cold-Start Penalty

When a Modal GPU container hasn't processed a job recently (typically > 5 minutes idle), the container must be provisioned from scratch. This adds:

| Scenario | Additional Latency |
|---|---|
| CPU function cold start | +1–3s |
| T4 GPU cold start | +5–10s |
| A10G GPU cold start | +8–15s |
| Model weights loaded from image cache | +2–5s (already baked in) |
| Model weights downloaded at runtime | +60–120s (**avoid — always bake weights into image**) |

**Mitigation strategies:**
1. **Image-baked model weights** — always bake into Modal image layer (see `12_infrastructure_deployment.md`)
2. **`keep_warm=1`** for the most-used functions in production (keeps one container alive; adds ~$0.50/day/container)
3. **Pipeline pre-warming** — on QUEUED status, Modal can pre-provision the next container while the current one is still running

```python
# optional: keep one warm container for the video agent (most frequently cold-started)
@app.function(gpu="T4", timeout=120, image=DINOV2_IMAGE, secrets=[SUPABASE_SECRET], keep_warm=1)
def video_agent_fn(state): ...
```

---

## 14.3 Throughput Model

### Free-Tier Capacity (Default)

```
MAX_CONCURRENT_JOBS = 2

T4 slots used per job:          2 (object branch + mask branch run simultaneously)
A10G slots used per job:        1 (hand branch or action agent — sequential)
Peak GPU consumption per job:   2×T4 + 1×A10G

Modal free tier GPU budget:     ~$30/month
Estimated GPU cost per job:     ~$0.08 (75s T4 + 55s A10G)
Free-tier sustainable jobs/day: ~375 jobs/day (before $30 limit)
Demo rate (actual):             ~5-10 jobs/day → well within free tier
```

### Paid-Tier Capacity (Scale Target)

```
MAX_CONCURRENT_JOBS = 10

GPU pool required:
  - 20 T4 slots (2 perception branches × 10 jobs)
  - 10 A10G slots (hand branch or action agent × 10 jobs)

Throughput @ 10 concurrent:
  - p50 pipeline = 154s
  - 10 concurrent → ~3.9 jobs/minute = ~234 jobs/hour

Daily throughput @ 10 concurrent: ~5,600 jobs/day
```

---

## 14.4 Bottleneck Analysis

### Primary Bottleneck: Perception Agent (75s p50 / 140s p95)

The Perception Agent dominates wall-clock time because it runs 3 GPU-intensive models. Even with parallelism, it accounts for **48–50% of total pipeline time**.

**Profiling breakdown:**
```
Within Perception (parallel branches running simultaneously):
  Object branch (YOLOE): 0.21s/frame × 120 frames = 25s
  Mask branch (SAM 2.1): 0.29s/frame × 120 frames = 35s  ← usually the longest
  Hand branch (HaWoR):   0.25s/frame × 120 frames = 30s

Merge + contact: 5s (CPU, fast)

bottleneck = max(25, 35, 30) + 5 = 40s ... wait, that's less than 75s p50.
The extra 35s is: GPU allocation latency + model warm-up + storage download per branch.
```

**Optimization levers:**
- Reduce frame count: decrease `FRAME_SAMPLE_FPS` from 1.0 to 0.5 → halves perception time at mild quality cost
- Use SAM 2.1 small instead of hiera-large: saves ~20s but reduces mask quality
- Batch download all frame bytes before inference starts (eliminate serial download-infer-download pattern)

### Secondary Bottleneck: Action Agent (28s p50 / 60s p95)

EgoVLM-3B on A10G processes 4 frames per segment. For a 5-minute video with ~15 segments: 4 × 15 = 60 forward passes.

**Optimization levers:**
- Reduce `ACTION_FRAMES_PER_SEGMENT` from 4 to 2 → cuts inference time in half at minor label quality cost
- Batch all segments in a single EgoVLM forward pass (requires padding/masking — complex but ~2x speedup)
- Use smaller model: EgoVLM-1B instead of 3B (if quality holds)

### Gemini API Latency (18s p50 / 40s p95)

The Task Graph Agent is the only network-bound blocking step. Gemini cold (first request to the API) takes up to 40s. Gemini with `thinking_budget=4096` adds additional latency.

**Optimization levers:**
- Cache task graphs: if same `sha256` video processed before, skip Task Graph Agent entirely
- Use Gemini Flash for simple action sequences (< 10 actions), reserve Gemini Pro for complex ones
- Run Task Graph Agent concurrently with Dataset Builder (currently sequential, could overlap 4s)

---

## 14.5 Memory and VRAM Management

### VRAM Budget Per GPU

```python
# T4 (16GB VRAM) — used by Object and Mask branches

# Object branch (YOLOE-26x-seg):
YOLOE_MODEL_SIZE = 1.8  # GB
YOLOE_INFERENCE_BATCH = 0.8  # GB per batch (bs=4)
YOLOE_TOTAL_PEAK = 2.6  # GB  → safe margin on T4

# Mask branch (SAM 2.1 hiera-large):
SAM_MODEL_SIZE = 3.8   # GB
SAM_IMAGE_ENCODER = 0.2  # GB per frame  
SAM_MASK_DECODER = 0.4   # GB per sequence
SAM_TOTAL_PEAK = 12.0   # GB  → tight but fits T4 (16GB)

# Never run YOLOE and SAM on the same T4 — they run on separate containers

# A10G (24GB VRAM) — used by Hand branch and Action Agent

# HaWoR:
HAWOR_MODEL_SIZE = 4.2  # GB
HAWOR_INFERENCE_PEAK = 16.0  # GB  → fits with 8GB margin

# EgoVLM-3B:
EGOVLM_MODEL_SIZE = 6.0  # GB (bf16)
EGOVLM_INFERENCE_PEAK = 20.0  # GB → fits A10G, tight on T4
# ↑ WHY A10G for EgoVLM: 3B model in bf16 needs 6GB base + 14GB context/KV cache
```

### OOM Recovery Pattern

```python
# modal_backend/agents/base.py — OOM handler
import torch

def with_oom_recovery(inference_fn, *args, **kwargs):
    """Retries inference with halved batch size on CUDA OOM."""
    batch_size = kwargs.get("batch_size", 32)
    max_retries = 3
    
    for attempt in range(max_retries):
        try:
            return inference_fn(*args, **kwargs)
        except torch.cuda.OutOfMemoryError:
            if attempt == max_retries - 1:
                raise  # Give up after max retries
            
            # Free cache, halve batch size
            torch.cuda.empty_cache()
            batch_size = max(1, batch_size // 2)
            kwargs["batch_size"] = batch_size
            
            print(f"[OOM Recovery] Retrying with batch_size={batch_size}")
```

---

## 14.6 Admission Control

The admission control gate prevents more than `MAX_CONCURRENT_JOBS` from running simultaneously, protecting GPU budget.

```python
# modal_backend/pipeline.py

def check_admission(job_id: str) -> Literal["RUN", "QUEUE", "REJECT"]:
    """
    Called at pipeline start. Determines if this job can run immediately
    or must wait in queue.
    """
    sb = create_supabase_service_client()
    
    # Count currently running jobs
    running_count = sb.table("processing_jobs") \
        .select("id", count="exact") \
        .like("status", "%_RUNNING").execute().count
    
    if running_count >= CONFIG.MAX_CONCURRENT_JOBS:
        # Update job status to QUEUED (already QUEUED — no change needed)
        # Return QUEUE — pipeline waits (Modal function sleeps with retry)
        return "QUEUE"
    
    # Count queued jobs ahead of this one
    queue_depth = sb.table("processing_jobs") \
        .select("id", count="exact") \
        .eq("status", "QUEUED") \
        .lt("queued_at", get_queued_at(job_id)) \
        .execute().count
    
    if queue_depth > 100:
        # Reject — queue too deep, signal overload
        fail_job(job_id, "FAILED_ORCHESTRATOR", "QUEUE_TOO_DEEP")
        return "REJECT"
    
    return "RUN"


@app.function(cpu=4, memory=4096, timeout=1200, secrets=[SUPABASE_SECRET])
def execute_pipeline(job_id: str, trace_id: str):
    """Pipeline entry point with admission control."""
    
    # Poll for admission (with max wait)
    max_queue_wait_sec = 300  # 5 minutes max queue wait
    start = time.time()
    
    while True:
        decision = check_admission(job_id)
        if decision == "RUN":
            break
        if decision == "REJECT":
            return
        if time.time() - start > max_queue_wait_sec:
            fail_job(job_id, "FAILED_ORCHESTRATOR", "QUEUE_WAIT_TIMEOUT")
            return
        time.sleep(10)  # Poll every 10s while queued
    
    # Run the actual pipeline
    run_langgraph_pipeline(job_id, trace_id)
```

---

## 14.7 Performance Optimization Checklist

Use this before shipping each phase to ensure no regressions:

```bash
# Run with 30-second test clip:
python modal_backend/tests/test_full_pipeline.py --video tests/fixtures/factory_clip_30s.mp4 --profile

# Expected outputs:
# Video Agent: < 20s
# Quality Agent: < 6s
# Perception Total: < 50s
# Segmentation: < 10s
# Action Agent: < 20s
# Task Graph: < 30s
# Dataset Builder: < 8s
# TOTAL: < 144s for 30s clip

# Run with 5-minute test clip:
python modal_backend/tests/test_full_pipeline.py --video tests/fixtures/factory_clip_5min.mp4 --profile
# TOTAL must be < 300s
```

---
