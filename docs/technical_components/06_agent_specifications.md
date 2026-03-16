# AutoEgoLab v3.0 — Agent Implementation Specifications
**Document owner:** AI Systems Engineering  
**Revision:** 2.0 | **Date:** 2026-03-16 | **Status:** Build-Ready

---

## 6.1 Shared Agent Interface

All agents implement the same function signature. This is enforced by the base class in `modal_backend/agents/base.py`.

```python
# modal_backend/agents/base.py
from abc import ABC, abstractmethod
from typing import Generic, TypeVar
from pydantic import BaseModel, UUID4
from enum import Enum

T = TypeVar("T")

class AgentStatus(str, Enum):
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    RETRYABLE_FAILED = "RETRYABLE_FAILED"

class AgentResult(BaseModel, Generic[T]):
    job_id: UUID4
    agent: str
    attempt: int
    status: AgentStatus
    output: T | None = None
    state_updates: dict = {}        # Keys to merge into PipelineState
    metrics: dict = {}              # Logged to agent_runs.metrics
    output_count: int = 0
    duration_ms: int = 0
    error_code: str | None = None
    error_message: str | None = None

class BaseAgent(ABC):
    def __init__(self, job_id: str, trace_id: str):
        self.job_id = job_id
        self.trace_id = trace_id
        self.supabase = create_supabase_service_client()
        self.storage = self.supabase.storage

    @abstractmethod
    def run(self, state: "PipelineState") -> AgentResult:
        """Execute the agent. Called by pipeline orchestrator."""
        pass

    def download_artifact(self, artifact_id: str) -> bytes:
        """Download artifact bytes from Supabase Storage."""
        row = self.supabase.table("artifacts").select("bucket,object_key") \
            .eq("id", artifact_id).single().execute().data
        return self.storage.from_(row["bucket"]).download(row["object_key"])

    def upload_artifact(self, data: bytes, artifact_type: str, filename: str,
                         content_type: str, producer_agent: str) -> str:
        """Upload data to storage and register artifact row. Returns artifact ID."""
        object_key = f"jobs/{self.job_id}/{artifact_type}/v1/{filename}"
        self.storage.from_(BUCKET_FOR_TYPE[artifact_type]).upload(
            path=object_key, file=data, file_options={"content_type": content_type}
        )
        result = self.supabase.table("artifacts").insert({
            "job_id": self.job_id,
            "artifact_type": artifact_type,
            "producer_agent": producer_agent,
            "bucket": BUCKET_FOR_TYPE[artifact_type],
            "object_key": object_key,
            "content_type": content_type,
            "size_bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
        }).execute()
        return result.data[0]["id"]
```

---

## 6.2 Agent 1 — Video Agent

### Purpose
Decodes the raw MP4 video into a sparse, representative set of keyframes. Computes DINOv2 visual embeddings for semantic frame similarity. Uses k-medoids clustering to select the most representative frames, eliminating redundancy while preserving temporal diversity.

### Why DINOv2 + k-medoids?
DINOv2 embeddings encode visual semantics (scene composition, object identity) without task-specific training. K-medoids clustering in this embedding space guarantees that selected keyframes are maximally different from each other — you won't get 15 nearly-identical frames of the same static posture.

### Inputs
```python
# From PipelineState
video_artifact_id: str        # UUID of uploaded MP4 in raw-videos bucket

# From config
FRAME_SAMPLE_FPS: float       # Default 1.0 — extract 1 frame per second
KEYFRAMES_PER_MIN: int        # Default 30 — max keyframes per minute
```

### Internal Pipeline (Step by Step)

**Step 1: Download video**
```python
video_bytes = self.download_artifact(state["video_artifact_id"])
with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as f:
    f.write(video_bytes)
    video_path = f.name
```

**Step 2: Validate with ffprobe**
```python
probe = ffmpeg.probe(video_path)
video_stream = next(s for s in probe["streams"] if s["codec_type"] == "video")
duration_sec = float(probe["format"]["duration"])
fps = eval(video_stream["r_frame_rate"])  # "30000/1001" → 29.97

assert duration_sec <= CONFIG.MAX_VIDEO_DURATION_SEC, "Video too long"
assert video_stream["codec_name"] in ["h264", "h265", "vp9", "av1"], "Unsupported codec"
```

**Step 3: Extract sampled frames with ffmpeg**
```python
sampled_frames_dir = tempfile.mkdtemp()
(
    ffmpeg
    .input(video_path)
    .filter("fps", fps=CONFIG.FRAME_SAMPLE_FPS)
    .output(f"{sampled_frames_dir}/frame_%04d.jpg", qscale=2)
    .run(quiet=True)
)
frame_paths = sorted(glob.glob(f"{sampled_frames_dir}/frame_*.jpg"))
```

**Step 4: Compute DINOv2 embeddings**
```python
# Load DINOv2 model (cached in Modal image)
model = torch.hub.load("facebookresearch/dinov2", "dinov2_vitb14")
model.eval().cuda()
transform = transforms.Compose([
    transforms.Resize(224),
    transforms.CenterCrop(224),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
])

embeddings = []
batch_size = 32
for i in range(0, len(frame_paths), batch_size):
    batch = [transform(Image.open(p)) for p in frame_paths[i:i+batch_size]]
    tensor = torch.stack(batch).cuda()
    with torch.no_grad():
        emb = model(tensor)  # (batch, 768)
    embeddings.extend(emb.cpu().numpy())
```

**Step 5: K-medoids keyframe selection**
```python
from sklearn_extra.cluster import KMedoids

n_keyframes = min(int(duration_sec / 60 * CONFIG.KEYFRAMES_PER_MIN), len(frame_paths))
kmedoids = KMedoids(n_clusters=n_keyframes, metric="cosine", random_state=42)
kmedoids.fit(np.array(embeddings))
keyframe_indices = sorted(kmedoids.medoid_indices_)
keyframe_paths = [frame_paths[i] for i in keyframe_indices]
```

**Step 6: Upload keyframes and register artifacts**
```python
raw_frame_artifact_ids = []
for idx, path in zip(keyframe_indices, keyframe_paths):
    frame_bytes = open(path, "rb").read()
    ts_ms = int((idx / CONFIG.FRAME_SAMPLE_FPS) * 1000)
    artifact_id = self.upload_artifact(
        data=frame_bytes,
        artifact_type="RAW_FRAME",
        filename=f"frame_{idx:05d}.jpg",
        content_type="image/jpeg",
        producer_agent="VIDEO_AGENT",
    )
    # Store frame metadata in artifact.metadata JSONB
    self.supabase.table("artifacts").update({
        "metadata": {"frame_index": idx, "ts_ms": ts_ms, "embedding_computed": True}
    }).eq("id", artifact_id).execute()
    raw_frame_artifact_ids.append(artifact_id)
```

**Step 7: Store DINOv2 embeddings in search_embeddings table** *(optional — skipped if DB quota low)*
```python
for artifact_id, embedding in zip(raw_frame_artifact_ids, selected_embeddings):
    self.supabase.table("search_embeddings").insert({
        "job_id": self.job_id,
        "action_id": None,
        "segment_id": None,
        "embedding": embedding.tolist(),
        "embedding_model": "dinov2_vitb14",
        "text_content": f"frame_{artifact_id}",
        "metadata": {"source": "video_agent", "artifact_id": artifact_id},
    }).execute()
```

### Outputs
- `raw_frame_artifact_ids: list[str]` — added to PipelineState
- `N` entries in `artifacts` table
- Optional `N` entries in `search_embeddings` table

### Expected Runtime
- p50: 12 seconds (100 frames, T4 GPU for DINOv2)
- p95: 25 seconds (300 frames, cold DINOv2 model load)
- GPU: T4 (DINOv2 batch inference) — falls back to CPU if T4 unavailable (adds ~15s)

### Failure Recovery
| Error Class | Detection | Recovery |
|---|---|---|
| Corrupt video | ffprobe exception | Non-retryable → `FAILED_VIDEO_AGENT` |
| Unsupported codec | codec_name assertion fails | Non-retryable → `FAILED_VIDEO_AGENT` |
| Video > 360s | duration assertion fails | Non-retryable → `FAILED_VIDEO_AGENT` |
| Storage download network error | requests.Timeout | Retryable (3x, exponential backoff) |
| DINOv2 CUDA OOM | CUDA RuntimeError | Halve batch_size and retry once |

---

## 6.3 Agent 2 — Quality Agent

### Purpose
Eliminates frames that would corrupt downstream model inference: blurry frames (camera shake, motion blur), underlit frames (too dark to detect objects), and overexposed frames (blown highlights obscure hands/objects).

### Why these exact filters?
- **Laplacian blur:** The Laplacian operator emphasizes high-frequency edges. A sharp image has high variance in Laplacian response; a blurry image has low variance. Threshold of 100 is empirically chosen for 1080p factory footage.
- **Brightness filter:** YOLOE and HaWoR both fail silently on near-black or blown-white frames — their confidence scores are confidently wrong. Filtering prevents this.
- **Overexposure ratio:** A frame with 15% blown pixels (>250 intensity) will have corrupted mask boundaries near windows or reflective surfaces.

### Inputs
```python
clean_frame_artifact_ids: list[str]  # From Video Agent
```

### Internal Pipeline

```python
# modal_backend/agents/quality_agent.py
import cv2
import numpy as np
from PIL import Image

def assess_frame_quality(frame_bytes: bytes) -> QualityAssessment:
    img_array = np.frombuffer(frame_bytes, np.uint8)
    img_bgr = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
    img_gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)

    # Blur score (Laplacian variance)
    laplacian_var = cv2.Laplacian(img_gray, cv2.CV_64F).var()

    # Brightness (mean pixel intensity of grayscale)
    brightness_mean = float(img_gray.mean())

    # Overexposed pixel ratio (pixels > 250 in any channel)
    img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    overexposed_pixels = np.any(img_rgb > 250, axis=2).sum()
    overexposed_ratio = overexposed_pixels / (img_gray.shape[0] * img_gray.shape[1])

    is_clean = (
        laplacian_var >= CONFIG.BLUR_LAPLACIAN_MIN
        and CONFIG.BRIGHTNESS_MIN <= brightness_mean <= CONFIG.BRIGHTNESS_MAX
        and overexposed_ratio <= CONFIG.OVEREXPOSED_RATIO_MAX
    )

    return QualityAssessment(
        laplacian_var=laplacian_var,
        brightness_mean=brightness_mean,
        overexposed_ratio=overexposed_ratio,
        is_clean=is_clean,
        reject_reason=(
            "blur" if laplacian_var < CONFIG.BLUR_LAPLACIAN_MIN
            else "underlit" if brightness_mean < CONFIG.BRIGHTNESS_MIN
            else "overlit" if brightness_mean > CONFIG.BRIGHTNESS_MAX
            else "overexposed" if overexposed_ratio > CONFIG.OVEREXPOSED_RATIO_MAX
            else None
        ),
    )

def run(self, state: PipelineState) -> AgentResult:
    results = []
    for artifact_id in state["raw_frame_artifact_ids"]:
        frame_bytes = self.download_artifact(artifact_id)
        assessment = assess_frame_quality(frame_bytes)
        results.append((artifact_id, assessment))

    clean_ids = [aid for aid, a in results if a.is_clean]
    rejected = [a for _, a in results if not a.is_clean]

    # Aggregate Quality Metrics
    metrics = QualityMetrics(
        total_frames=len(results),
        accepted_frames=len(clean_ids),
        rejected_blur=sum(1 for _, a in results if a.reject_reason == "blur"),
        rejected_brightness=sum(1 for _, a in results if a.reject_reason in ("underlit","overlit")),
        rejected_overexposed=sum(1 for _, a in results if a.reject_reason == "overexposed"),
        avg_blur_score=np.mean([a.laplacian_var for _, a in results]),
    )

    # Write metrics to job metadata
    self.supabase.table("processing_jobs").update({
        "failure_details": {"quality_metrics": metrics.dict()}
    }).eq("id", self.job_id).execute()

    # Promote clean frame artifact_type to CLEAN_FRAME
    for artifact_id in clean_ids:
        self.supabase.table("artifacts").update({
            "artifact_type": "CLEAN_FRAME"
        }).eq("id", artifact_id).execute()

    if len(clean_ids) == 0:
        raise AgentFailure("FAILED_QUALITY_AGENT", "ZERO_CLEAN_FRAMES",
                           f"All {len(results)} frames rejected")
    if len(clean_ids) < CONFIG.MIN_CLEAN_FRAMES:
        state["warnings"].append(f"Only {len(clean_ids)} clean frames — degraded mode")

    return AgentResult(
        job_id=self.job_id, agent="QUALITY_AGENT", attempt=1,
        status=AgentStatus.SUCCEEDED,
        state_updates={"clean_frame_artifact_ids": clean_ids},
        metrics=metrics.dict(),
        output_count=len(clean_ids),
    )
```

### Outputs
- `clean_frame_artifact_ids: list[str]` — added to PipelineState
- `QualityMetrics` stored in `processing_jobs.failure_details.quality_metrics`

### Expected Runtime
- p50: 4 seconds (120 frames, pure CPU NumPy)
- p95: 8 seconds (300 frames)
- GPU: None — runs on CPU only

### Failure Recovery
| Error Class | Detection | Recovery |
|---|---|---|
| All frames rejected | `len(clean_ids) == 0` | Non-retryable → `FAILED_QUALITY_AGENT` |
| < 10 clean frames | `len(clean_ids) < MIN` | Continue in degraded mode with warning |
| Download error | network exception | Retryable (3x) — skip frame, continue if >50% frames OK |

---

## 6.4 Agent 3 — Perception Agent

### Purpose
The most compute-intensive agent. Performs dense visual grounding across all clean frames: detects every object with pixel-precise segmentation masks, tracks masks temporally, recovers 3D hand poses, and computes contact events (when hands touch objects).

### Why three models instead of one?
YOLOE-26x-seg is the best open-source object detector for scene-level understanding. SAM 2.1 is the best video segmentation model. HaWoR is the only production-ready 3D hand recovery model for egocentric video. No single model does all three well.

### Parallel Execution Architecture

```python
# perception_prepare_node: fan-out coordinator
def perception_prepare_node(state: PipelineState) -> PipelineState:
    """Broadcast clean_frame_artifact_ids to all three branches via state."""
    return state  # No computation — just enables LangGraph fan-out

# Object Branch (YOLOE-26x-seg)
@app.function(gpu="T4", timeout=240, image=YOLOE_IMAGE)
def perception_object_branch_node(state: PipelineState) -> dict:
    from agents.perception_object import ObjectPerceptionAgent
    agent = ObjectPerceptionAgent(state["job_id"], state["trace_id"])
    return agent.run(state)

# Mask Branch (SAM 2.1)
@app.function(gpu="T4", timeout=240, image=SAM_IMAGE)
def perception_mask_branch_node(state: PipelineState) -> dict:
    from agents.perception_mask import MaskPerceptionAgent
    agent = MaskPerceptionAgent(state["job_id"], state["trace_id"])
    return agent.run(state)

# Hand Branch (HaWoR)
@app.function(gpu="A10G", timeout=240, image=HAWOR_IMAGE)
def perception_hand_branch_node(state: PipelineState) -> dict:
    from agents.perception_hand import HandPerceptionAgent
    agent = HandPerceptionAgent(state["job_id"], state["trace_id"])
    return agent.run(state)
```

### Object Branch — YOLOE-26x-seg

```python
# modal_backend/agents/perception_object.py
from ultralytics import YOLOE

class ObjectPerceptionAgent(BaseAgent):
    MODEL_PATH = "/model-cache/yoloe-26x-seg.pt"

    def run(self, state: PipelineState) -> AgentResult:
        model = YOLOE(self.MODEL_PATH)
        model.cuda()

        all_detections = []
        for artifact_id in state["clean_frame_artifact_ids"]:
            frame_bytes = self.download_artifact(artifact_id)
            img = Image.frombytes(frame_bytes)
            results = model.predict(img, conf=0.25, iou=0.45, verbose=False)

            frame_detections = []
            for r in results:
                for box, mask, cls, conf in zip(r.boxes.xyxy, r.masks.data, r.boxes.cls, r.boxes.conf):
                    frame_detections.append({
                        "class": model.names[int(cls)],
                        "confidence": float(conf),
                        "bbox": box.tolist(),  # [x1, y1, x2, y2]
                        "mask_rle": mask_to_rle(mask.cpu().numpy()),  # run-length encoded
                    })
            all_detections.append({
                "artifact_id": artifact_id,
                "detections": frame_detections,
            })

        # Write consolidated perception data to storage
        data_bytes = json.dumps(all_detections).encode()
        artifact_id = self.upload_artifact(
            data=data_bytes, artifact_type="PERCEPTION_JSON",
            filename="object_detections.json", content_type="application/json",
            producer_agent="PERCEPTION_OBJECT_BRANCH",
        )

        return AgentResult(
            job_id=self.job_id, agent="PERCEPTION_OBJECT_BRANCH", attempt=1,
            status=AgentStatus.SUCCEEDED,
            state_updates={"object_perception_artifact_id": artifact_id},
            output_count=sum(len(d["detections"]) for d in all_detections),
        )
```

### Mask Branch — SAM 2.1

```python
# modal_backend/agents/perception_mask.py
import torch
from sam2.build_sam import build_sam2_video_predictor

class MaskPerceptionAgent(BaseAgent):
    def run(self, state: PipelineState) -> AgentResult:
        predictor = build_sam2_video_predictor("sam2.1_hiera_large.pt")
        predictor.cuda()

        # Download all clean frames
        frames = []
        for artifact_id in state["clean_frame_artifact_ids"]:
            frame_bytes = self.download_artifact(artifact_id)
            frames.append(np.array(Image.open(io.BytesIO(frame_bytes)).convert("RGB")))

        # SAM 2.1 video prediction
        with torch.inference_mode():
            state_sav, video_segments = predictor.propagate_in_video(
                frames=frames,
                video_segments=None,
            )

        # Convert to serializable format
        mask_data = []
        for frame_idx, seg_dict in enumerate(video_segments):
            frame_masks = []
            for obj_id, mask_tensor in seg_dict.items():
                frame_masks.append({
                    "object_id": int(obj_id),
                    "mask_rle": mask_to_rle(mask_tensor.cpu().numpy()),
                    "mask_area": int(mask_tensor.sum()),
                })
            mask_data.append({"frame_index": frame_idx, "masks": frame_masks})

        data_bytes = json.dumps(mask_data).encode()
        artifact_id = self.upload_artifact(
            data=data_bytes, artifact_type="PERCEPTION_JSON",
            filename="sam_masks.json", content_type="application/json",
            producer_agent="PERCEPTION_MASK_BRANCH",
        )

        return AgentResult(
            job_id=self.job_id, agent="PERCEPTION_MASK_BRANCH", attempt=1,
            status=AgentStatus.SUCCEEDED,
            state_updates={"mask_perception_artifact_id": artifact_id},
            output_count=len(mask_data),
        )
```

### Hand Branch — HaWoR

```python
# modal_backend/agents/perception_hand.py
import torch
from hawor import HaWoRPredictor

class HandPerceptionAgent(BaseAgent):
    def run(self, state: PipelineState) -> AgentResult:
        predictor = HaWoRPredictor(checkpoint="/model-cache/hawor_checkpoint.pt")
        predictor.cuda()

        hand_data = []
        for artifact_id in state["clean_frame_artifact_ids"]:
            frame_bytes = self.download_artifact(artifact_id)
            img = np.array(Image.open(io.BytesIO(frame_bytes)))

            with torch.no_grad():
                result = predictor.predict(img)  # Returns HaWoRResult

            if result is None or result.num_hands == 0:
                hand_data.append({"artifact_id": artifact_id, "hands": []})
                continue

            hands = []
            for hand in result.hands:
                hands.append({
                    "hand_side": hand.side,           # "left" or "right"
                    "mano_pose": hand.pose.tolist(),   # (51,) MANO pose params
                    "wrist_position_3d": hand.wrist_3d.tolist(),  # (3,)
                    "fingertip_positions_3d": hand.fingertips_3d.tolist(),  # (5, 3)
                    "contact_probability": float(hand.contact_prob),
                    "keypoints_2d": hand.keypoints_2d.tolist(),  # (21, 2)
                })
            hand_data.append({"artifact_id": artifact_id, "hands": hands})

        data_bytes = json.dumps(hand_data).encode()
        artifact_id = self.upload_artifact(
            data=data_bytes, artifact_type="PERCEPTION_JSON",
            filename="hand_poses.json", content_type="application/json",
            producer_agent="PERCEPTION_HAND_BRANCH",
        )

        return AgentResult(
            job_id=self.job_id, agent="PERCEPTION_HAND_BRANCH", attempt=1,
            status=AgentStatus.SUCCEEDED,
            state_updates={"hand_perception_artifact_id": artifact_id},
            output_count=len([h for d in hand_data for h in d["hands"]]),
        )
```

### Merge Node — Fusion + Contact Detection

```python
# modal_backend/agents/perception_merge.py
def perception_merge_node(state: PipelineState) -> PipelineState:
    """
    Downloads results from all 3 branches.
    Fuses per-frame data into PerceptionFrame objects.
    Computes contact events using hand-object mask overlap heuristic.
    """
    object_data = load_json_artifact(state["object_perception_artifact_id"])
    mask_data = load_json_artifact(state["mask_perception_artifact_id"])
    hand_data = load_json_artifact(state["hand_perception_artifact_id"])

    # Build per-frame lookup (indexed by artifact_id)
    obj_by_frame = {d["artifact_id"]: d["detections"] for d in object_data}
    mask_by_frame = {d["frame_index"]: d["masks"] for i, d in enumerate(mask_data)}
    hand_by_frame = {d["artifact_id"]: d["hands"] for d in hand_data}

    perception_frames = []
    for frame_idx, artifact_id in enumerate(state["clean_frame_artifact_ids"]):
        objects = obj_by_frame.get(artifact_id, [])
        masks = mask_by_frame.get(frame_idx, [])
        hands = hand_by_frame.get(artifact_id, [])

        # Contact heuristic: hand bbox overlaps with object mask
        contacts = []
        for hand in hands:
            for obj in objects:
                if hand.get("contact_probability", 0) > 0.5:
                    hand_kp = hand["keypoints_2d"]
                    hand_bbox = get_bbox_from_keypoints(hand_kp)
                    obj_mask = decode_rle(obj["mask_rle"])
                    if compute_iou(hand_bbox, obj_mask) > 0.15:
                        contacts.append({
                            "hand_side": hand["hand_side"],
                            "object_class": obj["class"],
                            "iou": compute_iou(hand_bbox, obj_mask),
                        })

        perception_frames.append(PerceptionFrame(
            artifact_id=artifact_id,
            frame_index=frame_idx,
            ts_ms=get_ts_from_artifact(artifact_id),
            objects=objects,
            masks=masks,
            hands=hands,
            contacts=contacts,
        ))

    # Serialize and upload
    data_bytes = json.dumps([f.dict() for f in perception_frames]).encode()
    artifact_id_out = upload_artifact(
        data=data_bytes, artifact_type="PERCEPTION_JSON",
        filename="perception_merged.json", producer_agent="PERCEPTION_MERGE",
    )

    state["perception_artifact_id"] = artifact_id_out
    return state
```

### Expected Runtime (Total Perception Stage)
| Sub-agent | Hardware | p50 | p95 |
|---|---|---|---|
| Object Branch (YOLOE) | T4 | 25s | 50s |
| Mask Branch (SAM 2.1) | T4 | 35s | 65s |
| Hand Branch (HaWoR) | A10G | 30s | 55s |
| Merge Node | CPU | 5s | 10s |
| **Total (parallel)** | mixed | **~75s** | **~140s** |

---

## 6.5 Agent 4 — Segmentation Agent

### Purpose
Converts the continuous stream of perception signals into a discrete sequence of atomic skill episodes. This is purely deterministic signal processing — no model inference.

### Algorithm: Dual-Signal Boundary Detection

```python
# modal_backend/agents/segmentation_agent.py

def detect_skill_boundaries(perception_frames: list[PerceptionFrame]) -> list[SkillSegment]:
    """
    Two independent boundary signals are computed and fused:
    Signal 1: Mask-Delta — Jaccard distance between consecutive frame masks
    Signal 2: Contact — transitions of hand-object contact state (on → off → on)
    """
    n = len(perception_frames)
    mask_delta_curve = np.zeros(n - 1)
    contact_state = []

    # === Signal 1: Mask Delta ===
    for i in range(n - 1):
        masks_t = set(
            m["object_id"] for m in perception_frames[i].masks
        )
        masks_t1 = set(
            m["object_id"] for m in perception_frames[i+1].masks
        )
        # Jaccard distance = 1 - |intersection| / |union|
        if not masks_t and not masks_t1:
            mask_delta_curve[i] = 0.0
        else:
            intersection = len(masks_t & masks_t1)
            union = len(masks_t | masks_t1)
            mask_delta_curve[i] = 1.0 - (intersection / union)

    # Smooth the curve (5-frame rolling average)
    smoothed_delta = np.convolve(mask_delta_curve, np.ones(5)/5, mode='same')
    mask_boundaries = np.where(smoothed_delta > CONFIG.MASK_DELTA_THRESHOLD)[0]

    # === Signal 2: Contact Transitions ===
    for frame in perception_frames:
        contact_state.append(1 if frame.contacts else 0)

    # Find rising edges (0→1) and falling edges (1→0) with hysteresis
    contact_boundaries = []
    window = CONFIG.CONTACT_HYSTERESIS_FRAMES
    for i in range(window, n - window):
        prev_avg = np.mean(contact_state[i-window:i])
        next_avg = np.mean(contact_state[i:i+window])
        if abs(next_avg - prev_avg) > 0.6:  # significant transition
            contact_boundaries.append(i)

    # === Fuse signals: union of all boundary frames ===
    all_boundary_indices = sorted(set(mask_boundaries) | set(contact_boundaries))

    # Determine trigger_type for each boundary
    trigger_map = {}
    for b in mask_boundaries:
        trigger_map[b] = "MASK_DELTA"
    for b in contact_boundaries:
        if b in trigger_map:
            trigger_map[b] = "DUAL"
        else:
            trigger_map[b] = "CONTACT"

    # === Build Segments from boundaries ===
    if not all_boundary_indices:
        # Fallback: one segment spanning full timeline
        return [SkillSegment(
            segment_index=0,
            start_frame_idx=0, end_frame_idx=n-1,
            start_ts_ms=perception_frames[0].ts_ms,
            end_ts_ms=perception_frames[-1].ts_ms,
            trigger_type="FALLBACK",
            confidence=0.1,
        )]

    boundaries = [0] + all_boundary_indices + [n]
    segments = []
    for seg_idx, (start, end) in enumerate(zip(boundaries[:-1], boundaries[1:])):
        duration_ms = perception_frames[min(end-1, n-1)].ts_ms - perception_frames[start].ts_ms
        if duration_ms < CONFIG.MIN_SEGMENT_DURATION_MS and seg_idx > 0:
            # Merge short segment into previous
            prev = segments[-1]
            prev.end_frame_idx = min(end-1, n-1)
            prev.end_ts_ms = perception_frames[prev.end_frame_idx].ts_ms
            continue

        trigger = trigger_map.get(all_boundary_indices[max(0, seg_idx-1)], "MASK_DELTA")
        confidence = 0.9 if trigger == "DUAL" else 0.7 if trigger == "CONTACT" else 0.6

        # Primary object: most frequently detected object in segment
        segment_objects = []
        for f in perception_frames[start:min(end, n)]:
            for obj in f.objects:
                segment_objects.append(obj["class"])
        primary_object = Counter(segment_objects).most_common(1)[0][0] if segment_objects else None

        # Primary hand side
        segment_hands = []
        for f in perception_frames[start:min(end, n)]:
            for h in f.hands:
                segment_hands.append(h["hand_side"])
        hand_side = Counter(segment_hands).most_common(1)[0][0] if segment_hands else "unknown"

        segments.append(SkillSegment(
            segment_index=seg_idx,
            start_frame_idx=start,
            end_frame_idx=min(end-1, n-1),
            start_ts_ms=perception_frames[start].ts_ms,
            end_ts_ms=perception_frames[min(end-1, n-1)].ts_ms,
            trigger_type=trigger,
            confidence=confidence,
            primary_object=primary_object,
            hand_side=hand_side,
        ))

    return segments
```

### Outputs — Written to `skill_segments` table

```python
# After detecting segments, write to DB
for seg in segments:
    result = supabase.table("skill_segments").insert({
        "job_id": job_id,
        "segment_index": seg.segment_index,
        "start_ts_ms": seg.start_ts_ms,
        "end_ts_ms": seg.end_ts_ms,
        "start_frame_idx": seg.start_frame_idx,
        "end_frame_idx": seg.end_frame_idx,
        "trigger_type": seg.trigger_type,
        "confidence": seg.confidence,
        "primary_object": seg.primary_object,
        "hand_side": seg.hand_side,
    }).execute()
```

### Expected Runtime: p50 8s, p95 16s (CPU-only, numpy signal processing)

---

## 6.6 Agent 5 — Action Agent

### Purpose
Maps each skill segment to a structured action record. Uses EgoVLM-3B as the primary model with Gemini 3.1 Pro as a confidence-gated fallback. Outputs structured `(verb, object, tool, target)` decomposition.

### Primary Path: EgoVLM-3B

```python
# modal_backend/agents/action_agent.py
import torch
from transformers import AutoModelForVision2Seq, AutoProcessor

class ActionAgent(BaseAgent):
    MODEL_ID = "egoalpha/EgoVLM-3B"

    ACTION_PROMPT = """
You are analyzing an egocentric factory video clip.
Describe the skill being performed as a structured action.

Respond ONLY with this JSON (no other text):
{
  "action_label": "<verb> <object> [with <tool>] [to <target_location>]",
  "verb": "<primary action verb>",
  "object": "<primary object being manipulated>",
  "tool": "<tool used, or null>",
  "target": "<destination/target, or null>",
  "confidence": <0.0 to 1.0>
}

Examples:
- {"action_label": "grasp screwdriver from tray", "verb": "grasp", "object": "screwdriver", "tool": null, "target": "tray", "confidence": 0.92}
- {"action_label": "tighten bolt with wrench", "verb": "tighten", "object": "bolt", "tool": "wrench", "target": null, "confidence": 0.88}
"""

    def run(self, state: PipelineState) -> AgentResult:
        model = AutoModelForVision2Seq.from_pretrained(
            self.MODEL_ID, torch_dtype=torch.bfloat16
        ).cuda()
        processor = AutoProcessor.from_pretrained(self.MODEL_ID)

        action_ids = []
        segments = load_segments_from_db(self.job_id, state["segment_ids"])

        for seg in segments:
            # Get representative frames for this segment
            seg_frames = get_frames_for_segment(
                state["clean_frame_artifact_ids"],
                seg.start_frame_idx, seg.end_frame_idx,
                max_frames=4,  # Use 4 representative frames for VLM context
            )

            # Build multi-image prompt
            images = [Image.open(io.BytesIO(self.download_artifact(aid))) for aid in seg_frames]

            inputs = processor(
                text=self.ACTION_PROMPT,
                images=images,
                return_tensors="pt",
            ).to("cuda")

            with torch.inference_mode():
                outputs = model.generate(**inputs, max_new_tokens=200, temperature=0.1)

            response_text = processor.decode(outputs[0], skip_special_tokens=True)
            action_dict = parse_action_json(response_text)

            # Confidence gating
            if action_dict is None or action_dict.get("confidence", 0) < CONFIG.ACTION_CONFIDENCE_MIN:
                action_dict = self._gemini_fallback(seg, seg_frames)

            action_id = self._write_action(seg, action_dict)
            action_ids.append(action_id)

            # Write search embedding for this action
            self._write_action_embedding(seg, action_dict, action_id)

        return AgentResult(
            job_id=self.job_id, agent="ACTION_AGENT", attempt=1,
            status=AgentStatus.SUCCEEDED,
            state_updates={"action_ids": action_ids},
            output_count=len(action_ids),
        )
```

### Fallback Path: Gemini 3.1 Pro

```python
    def _gemini_fallback(self, seg: SkillSegment, frame_artifact_ids: list[str]) -> dict:
        """Called when EgoVLM confidence < threshold."""
        import google.generativeai as genai
        genai.configure(api_key=os.environ["GOOGLE_API_KEY"])

        model = genai.GenerativeModel("gemini-exp-1206")

        # Build image parts
        image_parts = []
        for artifact_id in frame_artifact_ids[:2]:  # Max 2 frames for Gemini cost control
            frame_bytes = self.download_artifact(artifact_id)
            image_parts.append({"mime_type": "image/jpeg", "data": base64.b64encode(frame_bytes).decode()})

        prompt = f"""
Analyze these frames from an egocentric factory video.
The worker is performing a manual task with hands visible.
Segment context: primary object = {seg.primary_object}, hand = {seg.hand_side}

{self.ACTION_PROMPT}
"""
        # use instructor for structured output
        import instructor
        client = instructor.from_gemini(genai.GenerativeModel("gemini-exp-1206"))
        action = client.chat.completions.create(
            messages=[{"role": "user", "content": [{"type": "text", "text": prompt}, *image_parts]}],
            response_model=ActionOutput,
        )
        action_dict = action.dict()
        action_dict["fallback_used"] = True
        action_dict["model_used"] = "gemini-exp-1206"
        return action_dict
```

### Expected Runtime: p50 28s, p95 60s (A10G, ~5-15 segments)

---

## 6.7 Agent 6 — Task Graph Agent

### Purpose
Takes the ordered sequence of action records and synthesizes a hierarchical Directed Acyclic Graph (DAG) representing the task structure: what the overall goal was, how it decomposed into subtasks, and how atomic actions map to those subtasks.

### Why Gemini with deep thinking?
This is the only agent that requires **semantic reasoning**, not pattern matching. The task graph requires understanding:
- Which actions belong to the same subtask (e.g., "grasp bolt" + "position bolt" + "tighten bolt" = "install bolt subtask")
- What the implied goal is from the action sequence
- Causality and prerequisite relationships between subtasks

Gemini 3.1 Pro with `thinking_budget=4096` gives the model enough compute to do genuine multi-step reasoning over the action timeline.

### Prompt Engineering

```python
# modal_backend/agents/task_graph_agent.py

TASK_GRAPH_PROMPT = """
You are analyzing a structured sequence of actions from an egocentric factory video.
Your task is to synthesize a hierarchical task graph that represents the complete task being performed.

INPUT — Ordered action sequence:
{action_sequence_json}

OUTPUT — You must produce a valid JSON object with this exact schema:
{
  "goal": "<high-level task goal>",
  "nodes": [
    {
      "id": "node_0",
      "type": "goal|subtask|action",
      "label": "<descriptive label>",
      "action_indices": [<list of action_index values that belong here>],
      "description": "<what this node represents>"
    }
  ],
  "edges": [
    {
      "from": "node_id",
      "to": "node_id",
      "relation": "has_subtask|precedes|enables"
    }
  ],
  "root_node_id": "node_0"
}

Rules:
1. Every action index must appear in exactly one leaf node.
2. The graph must be a valid DAG (no cycles).
3. The root node must be of type "goal".
4. Subtask nodes group related actions.
5. Action nodes are leaf nodes containing exactly one action_index.
"""

def run(self, state: PipelineState) -> AgentResult:
    # Load all actions
    actions = supabase.table("actions").select("*") \
        .eq("job_id", self.job_id) \
        .order("action_index").execute().data

    action_sequence = [{
        "action_index": a["action_index"],
        "action_label": a["action_label"],
        "verb": a["verb"],
        "object": a["object"],
        "tool": a["tool"],
        "primary_object": a["target"],
    } for a in actions]

    prompt = TASK_GRAPH_PROMPT.format(
        action_sequence_json=json.dumps(action_sequence, indent=2)
    )

    import google.generativeai as genai
    import instructor

    client = instructor.from_gemini(
        genai.GenerativeModel(
            "gemini-exp-1206",
            generation_config={"thinking_budget": 4096},  # Deep think mode
        )
    )

    task_graph = client.chat.completions.create(
        messages=[{"role": "user", "content": prompt}],
        response_model=TaskGraph,
        max_retries=2,  # instructor handles validation retries
    )

    # Validate DAG integrity
    validate_dag(task_graph)

    # Write to task_graphs table
    result = supabase.table("task_graphs").insert({
        "job_id": self.job_id,
        "model_name": "gemini-exp-1206",
        "graph_json": task_graph.dict(),
        "graph_hash": sha256(json.dumps(task_graph.dict()).encode()).hexdigest(),
    }).execute()

    return AgentResult(
        job_id=self.job_id, agent="TASK_GRAPH_AGENT", attempt=1,
        status=AgentStatus.SUCCEEDED,
        state_updates={"task_graph_id": result.data[0]["id"]},
    )
```

### Fallback: Deterministic Template Graph
If Gemini fails after 3 retries, build a simple linear graph from actions:
```python
def build_template_graph(actions: list[dict]) -> TaskGraph:
    nodes = [{"id": "goal", "type": "goal", "label": "Unknown Task", "action_indices": []}]
    edges = []
    for a in actions:
        node_id = f"action_{a['action_index']}"
        nodes.append({"id": node_id, "type": "action", "label": a["action_label"],
                      "action_indices": [a["action_index"]]})
        nodes[0]["action_indices"].append(a["action_index"])
        if len(nodes) > 2:
            edges.append({"from": f"action_{actions[len(nodes)-3]['action_index']}",
                          "to": node_id, "relation": "precedes"})
    return TaskGraph(nodes=nodes, edges=edges, root_node_id="goal")
```

### Expected Runtime: p50 18s, p95 40s (external Gemini API, network-bound)

---

## 6.8 Agent 7 — Dataset Builder

### Purpose
Final compilation stage. Loads all structured outputs from all upstream agents, assembles them into a validated VLA training record, writes the JSON and RLDS artifact files to storage, and registers the dataset manifest.

### Data Assembly

```python
# modal_backend/agents/dataset_builder.py

def run(self, state: PipelineState) -> AgentResult:
    # Load all structured data
    job = supabase.table("processing_jobs").select("*").eq("id", self.job_id).single().execute().data
    segments = supabase.table("skill_segments").select("*").eq("job_id", self.job_id).order("segment_index").execute().data
    actions = supabase.table("actions").select("*").eq("job_id", self.job_id).order("action_index").execute().data
    task_graph = supabase.table("task_graphs").select("*").eq("job_id", self.job_id).single().execute().data

    # Build VLA records (one per action)
    vla_records = []
    for action in actions:
        seg = next(s for s in segments if s["id"] == action["segment_id"])
        # Get key frame for this action (middle frame of segment)
        frame_artifact_id = get_middle_frame_for_segment(
            state["clean_frame_artifact_ids"],
            seg["start_frame_idx"], seg["end_frame_idx"]
        )
        vla_records.append(VLARecord(
            record_index=action["action_index"],
            observation_image_artifact_id=frame_artifact_id,
            language_instruction=action["action_label"],
            action_verb=action["verb"],
            action_object=action["object"],
            action_tool=action["tool"],
            action_target=action["target"],
            timestamp_start_ms=seg["start_ts_ms"],
            timestamp_end_ms=seg["end_ts_ms"],
            confidence=action["confidence"],
            model_used=action["model_used"],
        ))

    # Validate full dataset with Pydantic
    dataset = VLADataset(
        schema_version="v1",
        job_id=self.job_id,
        video_duration_sec=job["video_duration_sec"],
        records=vla_records,
        task_graph=TaskGraph(**task_graph["graph_json"]),
        quality_metrics=job.get("failure_details", {}).get("quality_metrics"),
    )
    dataset_validated = VLADataset.model_validate(dataset.model_dump())  # Pydantic v2

    # Write dataset.json
    json_bytes = dataset_validated.model_dump_json(indent=2).encode()
    json_artifact_id = self.upload_artifact(
        data=json_bytes, artifact_type="DATASET_JSON",
        filename="dataset.json", content_type="application/json",
        producer_agent="DATASET_BUILDER",
    )

    # Write dataset.rlds (TensorFlow Records format)
    rlds_bytes = build_rlds_bundle(dataset_validated, state)
    rlds_artifact_id = self.upload_artifact(
        data=rlds_bytes, artifact_type="DATASET_RLDS",
        filename="dataset.tfrecord", content_type="application/octet-stream",
        producer_agent="DATASET_BUILDER",
    )

    # Register dataset manifest
    manifest_result = supabase.table("dataset_manifests").insert({
        "job_id": self.job_id,
        "schema_version": "v1",
        "dataset_version": f"v1.{int(time.time())}",
        "dataset_json_artifact_id": json_artifact_id,
        "dataset_rlds_artifact_id": rlds_artifact_id,
        "record_count": len(vla_records),
        "warnings": state.get("warnings", []),
        "manifest_json": {
            "segment_count": len(segments),
            "action_count": len(actions),
            "task_graph_node_count": len(task_graph["graph_json"]["nodes"]),
        },
    }).execute()

    return AgentResult(
        job_id=self.job_id, agent="DATASET_BUILDER", attempt=1,
        status=AgentStatus.SUCCEEDED,
        state_updates={"dataset_manifest_id": manifest_result.data[0]["id"]},
        output_count=len(vla_records),
    )
```

### Expected Runtime: p50 4s, p95 10s (CPU, JSON serialization + file I/O)

---
