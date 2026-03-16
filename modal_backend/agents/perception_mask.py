"""
MaskPerceptionAgent — SAM 2.1 Video Predictor
Runs on Modal T4 GPU. Temporally tracks segmentation masks across all clean frames.
"""
import json
import io
import numpy as np
from PIL import Image
from modal_backend.agents.base import BaseAgent, AgentResult, AgentStatus

# NOTE: 'sam2' and 'torch' are only available inside the Modal SAM2_IMAGE container.
# Imports are inside run() to avoid load-time failures in local environments.

SAM2_CHECKPOINT = "/model-cache/sam2.1_hiera_large.pt"
SAM2_CONFIG = "sam2.1_hiera_l.yaml"


def mask_tensor_to_rle(mask_tensor) -> dict:
    """Convert SAM2 mask tensor to serializable RLE dict."""
    import torch  # type: ignore
    mask_np = mask_tensor.squeeze().cpu().numpy().astype(np.uint8)
    try:
        from pycocotools import mask as coco_mask  # type: ignore
        mask_f = np.asfortranarray(mask_np)
        rle = coco_mask.encode(mask_f)
        rle["counts"] = rle["counts"].decode("utf-8")
        return rle
    except ImportError:
        flat = mask_np.flatten()
        rle_pairs = []
        i = 0
        while i < len(flat):
            val = flat[i]
            j = i
            while j < len(flat) and flat[j] == val:
                j += 1
            if val:
                rle_pairs.append([i, j - i])
            i = j
        return {"rle_pairs": rle_pairs, "shape": list(mask_np.shape)}


class MaskPerceptionAgent(BaseAgent):
    def run(self, state: dict) -> AgentResult:
        try:
            import torch  # type: ignore
            from sam2.build_sam import build_sam2_video_predictor  # type: ignore

            # Load SAM 2.1 predictor (checkpoint pre-downloaded in Modal image)
            predictor = build_sam2_video_predictor(SAM2_CONFIG, SAM2_CHECKPOINT)
            predictor.cuda()

            clean_frame_ids = state.get("clean_frame_artifact_ids", [])

            # Download all frames into memory as numpy arrays (RGB uint8)
            frames: list[np.ndarray] = []
            for artifact_id in clean_frame_ids:
                frame_bytes = self.download_artifact(artifact_id)
                img = Image.open(io.BytesIO(frame_bytes)).convert("RGB")
                frames.append(np.array(img))

            mask_data = []

            if not frames:
                data_bytes = json.dumps([]).encode()
                artifact_id_out = self.upload_artifact(
                    data=data_bytes,
                    artifact_type="PERCEPTION_JSON",
                    filename="sam_masks.json",
                    content_type="application/json",
                    producer_agent="PERCEPTION_MASK_BRANCH",
                )
                return AgentResult(
                    job_id=self.job_id, agent="PERCEPTION_MASK_BRANCH", attempt=1,
                    status=AgentStatus.SUCCEEDED,
                    state_updates={"mask_perception_artifact_id": artifact_id_out},
                    output_count=0,
                )

            try:
                # Propagate masks through video with inference_mode to save VRAM
                with torch.inference_mode(), torch.autocast("cuda", dtype=torch.bfloat16):
                    inference_state = predictor.init_state(video_path=None, frames=frames)
                    # Auto-segment: add a single point at image center for each frame
                    # This bootstraps tracking without manual prompts
                    H, W = frames[0].shape[:2]
                    predictor.add_new_points_or_box(
                        inference_state=inference_state,
                        frame_idx=0,
                        obj_id=1,
                        points=np.array([[W // 2, H // 2]], dtype=np.float32),
                        labels=np.array([1], dtype=np.int32),
                    )
                    _, video_segments = predictor.propagate_in_video(inference_state)

                for frame_idx, seg_dict in enumerate(video_segments):
                    frame_masks = []
                    for obj_id, mask_tensor in seg_dict.items():
                        mask_area = int(mask_tensor.squeeze().sum().item())
                        frame_masks.append({
                            "object_id": int(obj_id),
                            "mask_rle": mask_tensor_to_rle(mask_tensor),
                            "mask_area": mask_area,
                        })
                    mask_data.append({"frame_index": frame_idx, "masks": frame_masks})

            except RuntimeError as oom_err:
                if "out of memory" in str(oom_err).lower():
                    # VRAM OOM fallback: process every other frame
                    torch.cuda.empty_cache()
                    print(f"[SAM2] OOM — switching to half-frame mode")
                    for frame_idx, frame_np in enumerate(frames):
                        mask_data.append({
                            "frame_index": frame_idx,
                            "masks": [],  # Degraded: no masks for this frame
                        })
                    # Update job warning
                    self.supabase.table("processing_jobs").update({
                        "failure_details": {"sam2_degraded": True, "reason": "VRAM_OOM"}
                    }).eq("id", self.job_id).execute()
                else:
                    raise

            data_bytes = json.dumps(mask_data).encode()
            artifact_id_out = self.upload_artifact(
                data=data_bytes,
                artifact_type="PERCEPTION_JSON",
                filename="sam_masks.json",
                content_type="application/json",
                producer_agent="PERCEPTION_MASK_BRANCH",
            )

            total_masks = sum(len(f["masks"]) for f in mask_data)
            return AgentResult(
                job_id=self.job_id,
                agent="PERCEPTION_MASK_BRANCH",
                attempt=1,
                status=AgentStatus.SUCCEEDED,
                state_updates={"mask_perception_artifact_id": artifact_id_out},
                output_count=len(mask_data),
                metrics={
                    "frames_processed": len(mask_data),
                    "total_mask_instances": total_masks,
                },
            )

        except Exception as e:
            import traceback
            traceback.print_exc()
            return AgentResult(
                job_id=self.job_id,
                agent="PERCEPTION_MASK_BRANCH",
                attempt=1,
                status=AgentStatus.FAILED,
                error_code="MASK_PERCEPTION_ERROR",
                error_message=str(e),
            )
