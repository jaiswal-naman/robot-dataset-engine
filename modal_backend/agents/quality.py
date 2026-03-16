import cv2
import numpy as np
from pydantic import BaseModel
from typing import Optional
from modal_backend.config import CONFIG
from modal_backend.agents.base import BaseAgent, AgentResult, AgentStatus
from modal_backend.schema import PipelineState

class QualityAssessment(BaseModel):
    laplacian_var: float
    brightness_mean: float
    overexposed_ratio: float
    is_clean: bool
    reject_reason: Optional[str]

class QualityMetrics(BaseModel):
    total_frames: int
    accepted_frames: int
    rejected_blur: int
    rejected_brightness: int
    rejected_overexposed: int
    avg_blur_score: float

def assess_frame_quality(frame_bytes: bytes) -> QualityAssessment:
    img_array = np.frombuffer(frame_bytes, np.uint8)
    img_bgr = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
    img_gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)

    # Blur score (Laplacian variance)
    laplacian_var = float(cv2.Laplacian(img_gray, cv2.CV_64F).var())

    # Brightness (mean pixel intensity of grayscale)
    brightness_mean = float(img_gray.mean())

    # Overexposed pixel ratio (pixels > 250 in any channel)
    img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    overexposed_pixels = np.any(img_rgb > 250, axis=2).sum()
    overexposed_ratio = float(overexposed_pixels / (img_gray.shape[0] * img_gray.shape[1]))

    is_clean = (
        laplacian_var >= CONFIG.BLUR_LAPLACIAN_MIN
        and CONFIG.BRIGHTNESS_MIN <= brightness_mean <= CONFIG.BRIGHTNESS_MAX
        and overexposed_ratio <= CONFIG.OVEREXPOSED_RATIO_MAX
    )
    
    reject_reason = None
    if laplacian_var < CONFIG.BLUR_LAPLACIAN_MIN:
        reject_reason = "blur"
    elif brightness_mean < CONFIG.BRIGHTNESS_MIN:
        reject_reason = "underlit"
    elif brightness_mean > CONFIG.BRIGHTNESS_MAX:
        reject_reason = "overlit"
    elif overexposed_ratio > CONFIG.OVEREXPOSED_RATIO_MAX:
        reject_reason = "overexposed"

    return QualityAssessment(
        laplacian_var=laplacian_var,
        brightness_mean=brightness_mean,
        overexposed_ratio=overexposed_ratio,
        is_clean=is_clean,
        reject_reason=reject_reason,
    )

class QualityAgent(BaseAgent):
    def run(self, state: dict) -> AgentResult:
        results = []
        raw_frames = state.get("raw_frame_artifact_ids", [])
        
        for artifact_id in raw_frames:
            frame_bytes = self.download_artifact(artifact_id)
            assessment = assess_frame_quality(frame_bytes)
            results.append((artifact_id, assessment))

        clean_ids = [aid for aid, a in results if a.is_clean]
        
        # Aggregate Quality Metrics
        metrics = QualityMetrics(
            total_frames=len(results),
            accepted_frames=len(clean_ids),
            rejected_blur=sum(1 for _, a in results if a.reject_reason == "blur"),
            rejected_brightness=sum(1 for _, a in results if a.reject_reason in ("underlit","overlit")),
            rejected_overexposed=sum(1 for _, a in results if a.reject_reason == "overexposed"),
            avg_blur_score=float(np.mean([a.laplacian_var for _, a in results])) if results else 0.0,
        )

        # FIX: Write quality metrics to agent_runs via the metrics field,
        # NOT to processing_jobs.failure_details (that column is for failures only).
        # The pipeline.py wrapper already writes agent_runs — we pass metrics via AgentResult.

        # Promote clean frame artifact_type to CLEAN_FRAME
        for artifact_id in clean_ids:
            self.supabase.table("artifacts").update({
                "artifact_type": "CLEAN_FRAME"
            }).eq("id", artifact_id).execute()

        if len(clean_ids) == 0:
            return AgentResult(
                job_id=self.job_id, agent="QUALITY_AGENT", attempt=1,
                status=AgentStatus.FAILED, error_code="ZERO_CLEAN_FRAMES",
                error_message=f"All {len(results)} frames rejected",
                metrics=metrics.model_dump(),
            )
            
        warnings = state.get("warnings", [])
        if len(clean_ids) < CONFIG.MIN_CLEAN_FRAMES:
            warnings.append(f"Only {len(clean_ids)} clean frames - degraded mode")

        return AgentResult(
            job_id=self.job_id, agent="QUALITY_AGENT", attempt=1,
            status=AgentStatus.SUCCEEDED,
            state_updates={
                "clean_frame_artifact_ids": clean_ids,
                "warnings": warnings
            },
            metrics=metrics.model_dump(),
            output_count=len(clean_ids),
        )
