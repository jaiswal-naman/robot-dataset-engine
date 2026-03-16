# AutoEgoLab v3.0 — Future Extensions & Roadmap
**Document owner:** AI Systems Engineering  
**Revision:** 2.0 | **Date:** 2026-03-16 | **Status:** Build-Ready

---

## 19.1 Extension Design Philosophy

All future extensions MUST:
1. **Preserve the existing API surface** — v1 API contracts remain valid; add new endpoints, never breaking-change existing ones
2. **Not require schema migrations to existing tables** — new features get new tables; use FK references to existing IDs
3. **Be opt-in at the job level** — a query parameter or job metadata flag enables new behavior; existing jobs are unaffected
4. **Be independently deployable** — each extension ships without requiring changes to unrelated agents

---

## 19.2 Extension 1: Multi-Camera Egocentric Learning

**Current limitation:** System processes only a single frontal egocentric camera.

**Problem this solves:** Advanced robot training requires multi-view observation — headcam, wrist cam, and overhead cam simultaneously. Fusing these views enables spatial understanding unavailable from a single perspective.

### Architecture Changes Required

```
New component: CameraSync Service (before Video Agent)
New artifact type: SYNCHRONIZED_FRAME (replaces RAW_FRAME for multi-cam jobs)
New agent: CameraCalibration Agent (before Perception Agent)
Modified: Perception Agent (reads N frame paths instead of 1)
```

### New Upload API (backward compatible)

```typescript
// POST /api/upload — extended request body
{
  "file_name": "headcam.mp4",
  "file_size_bytes": 128734221,
  "mime_type": "video/mp4",
  "sha256": "abc123...",
  
  // NEW: multi-camera mode (optional)
  "camera_pair": {
    "camera_role": "primary",        // primary | overhead | wrist
    "pair_id": "session_xyz",        // shared ID for synchronization
    "sync_mode": "timestamp",        // timestamp | frame_count | audio_sync
  }
}
```

### Sync Algorithm

```python
# modal_backend/agents/camera_sync_agent.py

def sync_camera_pair(primary_path: str, secondary_paths: list[str], sync_mode: str):
    """
    Temporal alignment of multi-camera video streams.
    
    For timestamp sync: offset = first_common_ts(primary, secondary)
    For audio sync: cross-correlate audio tracks to find offset
    For frame_count: assume identical start frame
    """
    offsets = {}
    
    if sync_mode == "audio_sync":
        import librosa
        primary_audio, sr = librosa.load(primary_path, sr=22050)
        for path in secondary_paths:
            sec_audio, _ = librosa.load(path, sr=22050)
            # Cross-correlation
            correlation = np.correlate(primary_audio, sec_audio, mode="full")
            offset_frames = np.argmax(correlation) - len(sec_audio) + 1
            offsets[path] = offset_frames / sr  # seconds
    
    elif sync_mode == "timestamp":
        # Use EXIF/file metadata embedded timestamps
        # Extract from MP4 container metadata
        primary_ts = get_mp4_start_timestamp(primary_path)
        for path in secondary_paths:
            sec_ts = get_mp4_start_timestamp(path)
            offsets[path] = (sec_ts - primary_ts).total_seconds()
    
    return offsets  # Dict[camera_path, offset_seconds]
```

### Edge Cases

| Scenario | Handling |
|---|---|
| Clock drift between cameras (common on wireless cams) | Max tolerable drift = 50ms; above → raise `SYNC_DRIFT_TOO_HIGH` |
| Dropped frames on one camera | Mark affected frames as `sync_quality: partial`; Perception uses only primary for those frames |
| Different resolutions | Each camera processed at its native resolution; Perception Agent normalizes to common frame space |
| One camera starts late | Use `pair_start_offset` from sync result; clip lead camera to match |

**Estimated implementation effort:** 2 weeks (1 week sync agent + 1 week Perception Agent extension)

---

## 19.3 Extension 2: Robot Policy Training Loop Integration

**Current state:** AutoEgoLab produces a `dataset.tfrecord` (RLDS format). Robot teams must manually download and run training.

**Extension goal:** Trigger fine-tuning on a connected policy training cluster directly from the AutoEgoLab UI.

### Architecture

```
Dataset Builder completes → Policy Training Trigger (new optional node)
    │
    ├─ Calls robot team's Training API endpoint with signed dataset URL
    ├─ Returns training_run_id
    └─ UI shows "Policy training started" with link to training dashboard
```

### New API: POST `/api/job/:id/train-policy`

```typescript
// POST /api/job/:id/train-policy

// Request body:
{
  "policy_format": "ALOHA_V1" | "RT2" | "PI0",           // Export format
  "training_endpoint": "https://train.robotics-lab.com",   // Team's training server
  "base_model": "pi0-base-v1",                            // Starting checkpoint
  "hyperparams": {
    "learning_rate": 0.0001,
    "num_epochs": 50,
    "batch_size": 16
  }
}

// Response 202:
{
  "job_id": "...",
  "training_run_id": "train_abc123",
  "status": "TRAINING_QUEUED",
  "policy_format": "ALOHA_V1",
  "training_endpoint": "https://train.robotics-lab.com"
}
```

### Export Format Adapters

```python
# modal_backend/utils/policy_exporters.py

def export_aloha_v1(vla_records: list[VLARecord]) -> bytes:
    """Convert VLA dataset to ALOHA-compatible episode format."""
    episodes = []
    for rec in vla_records:
        episode = {
            "observations": {
                "images": {"cam_high": rec.frame_data},
                "state": rec.hand_pose_data,
            },
            "actions": serialize_action_for_aloha(rec.action_label, rec.hand_pose_data),
            "language_instruction": rec.action_label,
        }
        episodes.append(episode)
    return pickle.dumps(episodes)

def export_rt2_format(vla_records: list[VLARecord]) -> bytes:
    """Convert to RT-2 tokenized format."""
    # ... RT-2 specific serialization
    pass
```

---

## 19.4 Extension 3: Fleet Ingestion — Batch Mode

**Current limit:** One video per demo session.

**Extension goal:** Support uploading an entire day's factory footage in bulk — potentially hundreds of videos — and processing them as a unified batch job.

### Architecture Changes

```
New component: Batch Job Manager (groups N videos into one batch job)
New table: batch_jobs (aggregates multiple processing_jobs)
New API endpoints:
  POST /api/batch         — create a batch with N upload slots
  GET  /api/batch/:id     — aggregate status + per-job sub-status
  GET  /api/batch/:id/dataset — combined dataset download
```

### Database Changes

```sql
-- New table (does not modify existing tables)
CREATE TABLE public.batch_jobs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status      TEXT NOT NULL DEFAULT 'PENDING',   -- PENDING, PROCESSING, COMPLETED, PARTIAL_FAILED
    total_videos INT NOT NULL,
    completed   INT NOT NULL DEFAULT 0,
    failed      INT NOT NULL DEFAULT 0,
    token_hash  TEXT NOT NULL UNIQUE,             -- Batch-level token
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Link individual jobs to a batch (new column on existing table — additive only)
ALTER TABLE public.processing_jobs ADD COLUMN batch_id UUID REFERENCES public.batch_jobs(id);
CREATE INDEX idx_jobs_batch ON public.processing_jobs(batch_id);
```

### Throughput Model (Batch Mode)

```
100 videos × 5 min average = 500 total minutes of footage
At MAX_CONCURRENT_JOBS = 10:
  Total time = 100 jobs × 154s p50 / 10 concurrent = 1,540s ≈ 26 minutes
```

**Estimated implementation effort:** 1.5 weeks

---

## 19.5 Extension 4: Human-in-the-Loop (HITL) Correction

**Problem:** For edge cases (novel tools, unusual actions), AI agents may produce incorrect action labels or poor skill segmentation. Currently these errors silently flow into the dataset.

**Extension goal:** Provide a correction UI where humans can review low-confidence outputs and correct them before they enter the dataset.

### New Status States

```python
# Additional status values after COMPLETED
"PENDING_REVIEW",           # Flagged for human review
"UNDER_REVIEW",             # Annotator is actively reviewing  
"REVIEW_COMPLETE",          # All corrections applied
```

### Low-Confidence Flagging

```python
# modal_backend/agents/dataset_builder.py

def flag_for_review(records: list[VLARecord]) -> list[dict]:
    """
    Identify records that need human review.
    A record is flagged if:
    - action_confidence < 0.55 (above FALLBACK_THRESHOLD but still uncertain)
    - model_used == "gemini_fallback" (EgoVLM wasn't confident)
    - action_label == "unknown" (both models failed)
    """
    flags = []
    for rec in records:
        if rec.action_confidence < 0.55 or rec.model_used == "gemini_fallback":
            flags.append({
                "record_index": rec.index,
                "action_id": rec.action_id,
                "segment_id": rec.segment_id,
                "reason": "LOW_CONFIDENCE" if rec.action_confidence < 0.55 else "FALLBACK_MODEL",
                "current_label": rec.action_label,
                "confidence": rec.action_confidence,
                "review_priority": 1 - rec.action_confidence,  # Higher priority = less confident
            })
    return sorted(flags, key=lambda x: x["review_priority"], reverse=True)
```

### Correction UI Schema

```typescript
// New API: GET /api/job/:id/review
// Returns flagged records for human correction

interface ReviewRecord {
  record_index: number;
  action_id: string;
  segment_id: string;
  reason: 'LOW_CONFIDENCE' | 'FALLBACK_MODEL' | 'UNKNOWN_ACTION';
  current_label: string;
  confidence: number;
  frame_urls: string[];     // Signed URLs for visible frames in this segment
  suggested_labels: string[];  // Top-5 most common labels from same job
}

// New API: POST /api/job/:id/corrections
interface Correction {
  action_id: string;
  corrected_label: string;
  corrector_note?: string;
}
```

**Estimated implementation effort:** 2 weeks (1 week backend + 1 week review UI component)

---

## 19.6 Extension 5: Semantic Dataset Library

**Current scope:** Search is limited to a single `job_id`.

**Extension goal:** Cross-job semantic search across all completed jobs — a searchable library of extracted skills.

### Key Change: Cross-Job Vector Index

```sql
-- Expand search_embeddings to be globally queryable (no longer job-scoped)
-- search_embeddings.job_id still exists for provenance

-- New RPC for global search
CREATE FUNCTION search_global_embeddings(
  p_query VECTOR(768),
  p_top_k INT DEFAULT 10,
  p_min_confidence FLOAT DEFAULT 0.5
)
RETURNS TABLE (
  job_id UUID, segment_id UUID, action_id UUID,
  text_content TEXT, similarity FLOAT
) AS $$
  SELECT se.job_id, se.segment_id, se.action_id, se.text_content,
         1 - (se.embedding <=> p_query_embedding) AS similarity
  FROM search_embeddings se
  JOIN processing_jobs pj ON pj.id = se.job_id
  WHERE pj.status = 'COMPLETED'
    AND 1 - (se.embedding <=> p_query_embedding) >= p_min_confidence
  ORDER BY se.embedding <=> p_query_embedding
  LIMIT p_top_k;
$$ LANGUAGE SQL STABLE;
```

### UI Change

The `/library` page becomes a global skill browser — shows the top 50 most common skills across all jobs (by embedding cluster), with example video segments.

**Estimated implementation effort:** 1 week

---

## 19.7 Extension 6: Active Learning Loop

**Research-grade extension.** Automatically identifies the most informative unlabeled segments for human annotation, guiding a model fine-tuning loop.

```
Completed jobs → Embedding clustering → Find cluster outliers (most dissimilar from labeled data)
→ Flag outlier segments for HITL review → Corrected labels → Model fine-tuning trigger
→ Updated EgoVLM weights deployed to Modal image → Higher confidence on next run
```

This is a **multi-month research engineering effort** requiring MLOps infrastructure beyond the current scope. Document it here as a north star so architecture decisions today don't block it tomorrow.

**Prerequisite:** Extension 4 (HITL Correction) must be shipped first.

---

## Appendix A — Canonical Type Reference

All Pydantic models for agent data contracts. These are the authoritative types — not the TypeScript mirrors.

```python
# modal_backend/schemas/agent_results.py

class QualityMetrics(BaseModel):
    total_frames: int
    accepted_frames: int
    rejected_blur: int
    rejected_brightness: int
    rejected_overexposed: int
    avg_blur_score: float
    acceptance_rate: float  # accepted_frames / total_frames


class PerceptionObject(BaseModel):
    object_id: str
    label: str
    confidence: float
    bbox: list[float]    # [x1, y1, x2, y2] normalized 0–1
    mask_rle: str | None  # Run-length encoded mask


class PerceptionFrame(BaseModel):
    frame_idx: int
    ts_ms: int
    objects: list[PerceptionObject]
    masks_artifact_id: str | None
    hands: list[dict]    # HaWoR output: [{hand: 'L'|'R', joints_3d: [...], wrist_pose: [...]}]
    contacts: list[dict] # [{hand: 'L'|'R', object_id: str, iou: float}]


class SkillSegment(BaseModel):
    segment_index: int
    start_ts_ms: int
    end_ts_ms: int
    duration_ms: int
    confidence: float        # Segmentation signal strength (0–1)
    primary_object: str | None
    boundary_signal: str     # 'mask_delta' | 'contact_change' | 'both'


class ActionRecord(BaseModel):
    action_index: int
    segment_index: int
    action_label: str
    verb: str
    object: str
    tool: str | None
    pre_condition: str | None
    post_condition: str | None
    confidence: float
    model_used: str           # 'egovlm_3b' | 'gemini_fallback'


class TaskGraphNode(BaseModel):
    id: str
    label: str
    description: str
    parallel_group: str | None
    subtask_ids: list[str]
    action_indices: list[int]
    estimated_duration_ms: int | None


class TaskGraph(BaseModel):
    nodes: list[TaskGraphNode]
    edges: list[dict]          # [{from: str, to: str, condition: str | None}]
    root_node_id: str
    metadata: dict


class VLARecord(BaseModel):
    """One record in the VLA training dataset. Maps to one RLDS episode."""
    record_index: int
    job_id: str
    segment_index: int
    action_index: int
    
    # Observation
    frame_artifact_id: str    # UUID → download via /api/job/:id/artifact/:id
    ts_ms: int
    
    # Action label
    action_label: str
    verb: str
    object: str
    tool: str | None
    
    # Robot state
    hand_pose_data: dict | None   # HaWoR wrist pose + joint angles at ts_ms
    object_pose_data: dict | None # YOLOE bbox in world frame if calibrated
    
    # Metadata
    action_confidence: float
    model_used: str
    schema_version: str = "v1"


class DatasetManifest(BaseModel):
    schema_version: str = "v1"
    dataset_version: str
    job_id: str
    record_count: int
    segment_count: int
    action_count: int
    task_graph_node_count: int
    dataset_json_artifact_id: str
    dataset_rlds_artifact_id: str
    warnings: list[str] = []
    generated_at: str
```

---

## Appendix B — Launch Acceptance Criteria

The system is ready for public demo launch when ALL of these pass:

```
INFRASTRUCTURE
□ All 5 Supabase buckets created and confirmed private
□ pgvector extension enabled and IVFFlat index created
□ All 5 SQL migrations applied without error
□ Realtime enabled on processing_jobs, agent_runs, job_events tables
□ Modal secrets created and verified with: modal secret list
□ Modal deploy successful: modal deploy modal_backend/app.py
□ Vercel deployment successful with zero build errors
□ CI pipeline green on main branch

FUNCTIONALITY  
□ Upload → Processing → COMPLETED flow works end-to-end with 30s test clip
□ All 7 PipelineTracker steps turn green ✓
□ Task graph renders in UI with ≥ 2 nodes
□ Skill segments table shows ≥ 1 row
□ Dataset download returns valid signed URLs (200 response)
□ RLDS .tfrecord has valid TFRecord format (tf.data.TFRecordDataset reads without error)
□ Realtime events received within 2 seconds of status change
□ Polling fallback works when Realtime WebSocket manually disconnected

SECURITY
□ Service role key absent from browser bundle (bundle-analyzer confirms)
□ All buckets confirmed private (no public URLs)
□ Rate limiting active: 6th upload/hour from same IP returns 429
□ Cross-job token access returns 401

PERFORMANCE
□ 30-second test clip completes in < 60s
□ 5-minute test clip completes in < 300s p95
□ No agent exceeds expected VRAM budget (T4: 12GB cap, A10G: 20GB cap)

OBSERVABILITY
□ LangSmith traces visible in dashboard for all test runs
□ All agent_runs rows written with non-null trace_url
□ structlog JSON output valid (pipe to `jq .` without error)
```

---
