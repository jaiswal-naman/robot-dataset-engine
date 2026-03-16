import numpy as np
from collections import Counter
from pydantic import BaseModel
from typing import Optional, List
from modal_backend.config import CONFIG
from modal_backend.agents.base import BaseAgent, AgentResult, AgentStatus
from modal_backend.schema import PipelineState
import json

class SkillSegment(BaseModel):
    segment_index: int
    start_frame_idx: int
    end_frame_idx: int
    start_ts_ms: int
    end_ts_ms: int
    trigger_type: str
    confidence: float
    primary_object: Optional[str] = None
    hand_side: Optional[str] = None

class PerceptionFrame(BaseModel):
    artifact_id: str
    frame_index: int
    ts_ms: int
    objects: list
    masks: list
    hands: list
    contacts: list

def detect_skill_boundaries(perception_frames: List[PerceptionFrame]) -> List[SkillSegment]:
    n = len(perception_frames)
    if n == 0:
        return []
        
    mask_delta_curve = np.zeros(max(1, n - 1))
    contact_state = []

    # === Signal 1: Mask Delta ===
    for i in range(n - 1):
        masks_t = set(m.get("object_id") for m in perception_frames[i].masks)
        masks_t1 = set(m.get("object_id") for m in perception_frames[i+1].masks)
        
        if not masks_t and not masks_t1:
            mask_delta_curve[i] = 0.0
        else:
            intersection = len(masks_t & masks_t1)
            union = len(masks_t | masks_t1)
            mask_delta_curve[i] = 1.0 - (intersection / union)

    # Smooth the curve (5-frame rolling average)
    if len(mask_delta_curve) > 0:
        smoothed_delta = np.convolve(mask_delta_curve, np.ones(5)/5, mode='same')
        mask_boundaries = np.where(smoothed_delta > CONFIG.MASK_DELTA_THRESHOLD)[0].tolist()
    else:
        mask_boundaries = []

    # === Signal 2: Contact Transitions ===
    for frame in perception_frames:
        contact_state.append(1 if frame.contacts else 0)

    # Find rising edges and falling edges with hysteresis
    contact_boundaries = []
    window = CONFIG.CONTACT_HYSTERESIS_FRAMES
    for i in range(window, n - window):
        prev_avg = np.mean(contact_state[i-window:i])
        next_avg = np.mean(contact_state[i:i+window])
        if abs(next_avg - prev_avg) > 0.6:  # significant transition
            contact_boundaries.append(i)

    # === Fuse signals: union of all boundary frames ===
    all_boundary_indices = sorted(set(mask_boundaries) | set(contact_boundaries))

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
    
    current_seg_idx = 0
    for i in range(len(boundaries) - 1):
        start = boundaries[i]
        end = boundaries[i+1]
        
        # Ensure indices stay within bounds
        real_end_idx = min(end - 1, n - 1)
        if start > real_end_idx:
            continue
            
        duration_ms = perception_frames[real_end_idx].ts_ms - perception_frames[start].ts_ms
        if duration_ms < CONFIG.MIN_SEGMENT_DURATION_MS and current_seg_idx > 0 and segments:
            # Merge short segment into previous
            prev = segments[-1]
            prev.end_frame_idx = real_end_idx
            prev.end_ts_ms = perception_frames[prev.end_frame_idx].ts_ms
            continue

        boundary_idx_val = all_boundary_indices[max(0, i-1)] if i > 0 and all_boundary_indices else -1
        trigger = trigger_map.get(boundary_idx_val, "MASK_DELTA")
        confidence = 0.9 if trigger == "DUAL" else 0.7 if trigger == "CONTACT" else 0.6

        segment_objects = []
        for f in perception_frames[start:min(end, n)]:
            for obj in f.objects:
                segment_objects.append(obj.get("class"))
        primary_object = Counter(segment_objects).most_common(1)[0][0] if segment_objects else None

        segment_hands = []
        for f in perception_frames[start:min(end, n)]:
            for h in f.hands:
                segment_hands.append(h.get("hand_side"))
        hand_side = Counter(segment_hands).most_common(1)[0][0] if segment_hands else "unknown"

        segments.append(SkillSegment(
            segment_index=current_seg_idx,
            start_frame_idx=start,
            end_frame_idx=real_end_idx,
            start_ts_ms=perception_frames[start].ts_ms,
            end_ts_ms=perception_frames[real_end_idx].ts_ms,
            trigger_type=trigger,
            confidence=confidence,
            primary_object=primary_object,
            hand_side=hand_side,
        ))
        current_seg_idx += 1

    return segments

class SegmentationAgent(BaseAgent):
    def run(self, state: PipelineState) -> AgentResult:
        try:
            perception_bytes = self.download_artifact(state["perception_artifact_id"])
            perception_json = json.loads(perception_bytes.decode("utf-8"))
            
            perception_frames = [PerceptionFrame(**f) for f in perception_json]
            segments = detect_skill_boundaries(perception_frames)
            
            segment_ids = []
            for seg in segments:
                row_data = {
                    "job_id": self.job_id,
                    "segment_index": seg.segment_index,
                    "start_ts_ms": seg.start_ts_ms,
                    "end_ts_ms": seg.end_ts_ms,
                    "start_frame_idx": seg.start_frame_idx,
                    "end_frame_idx": seg.end_frame_idx,
                    "trigger_type": seg.trigger_type,
                    "confidence": seg.confidence,
                    "primary_object": seg.primary_object,
                    "hand_side": seg.hand_side,
                }
                result = self.supabase.table("skill_segments").insert(row_data).execute()
                if result.data and len(result.data) > 0:
                     segment_ids.append(result.data[0]["id"])
                     
            if not segment_ids:
                warnings = state.get("warnings", [])
                warnings.append("Segmentation produced 0 segments")
                return AgentResult(
                    job_id=self.job_id, agent="SEGMENTATION_AGENT", attempt=1,
                    status=AgentStatus.SUCCEEDED,
                    state_updates={"segment_ids": [], "warnings": warnings},
                    output_count=0
                )
                
            return AgentResult(
                job_id=self.job_id, agent="SEGMENTATION_AGENT", attempt=1,
                status=AgentStatus.SUCCEEDED,
                state_updates={"segment_ids": segment_ids},
                output_count=len(segment_ids)
            )

        except Exception as e:
            return AgentResult(
                job_id=self.job_id, agent="SEGMENTATION_AGENT", attempt=1,
                status=AgentStatus.FAILED, error_code="SEGMENTATION_ERROR", error_message=str(e)
            )
