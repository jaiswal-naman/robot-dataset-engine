"""
ObjectPerceptionAgent — YOLOE-26x-seg
Runs on Modal T4 GPU. Detects all objects per frame with pixel-level segmentation masks.
"""
import json
import io
import numpy as np
from PIL import Image
from modal_backend.agents.base import BaseAgent, AgentResult, AgentStatus

# NOTE: 'ultralytics' is only available inside the Modal YOLOE_IMAGE container.
# This import is intentionally at runtime (inside run()) so the module can be
# imported locally without failing (local env doesn't have GPU deps installed).


def mask_to_rle(mask_np: np.ndarray) -> dict:
    """Convert a binary 2D mask numpy array to COCO-style RLE dict.
    Falls back to simple run-length encoding if pycocotools not available.
    """
    try:
        from pycocotools import mask as coco_mask  # type: ignore
        mask_uint8 = np.asfortranarray(mask_np.astype(np.uint8))
        rle = coco_mask.encode(mask_uint8)
        rle["counts"] = rle["counts"].decode("utf-8")
        return rle
    except ImportError:
        # Fallback: flat run-length encoding as list of [start, length] pairs
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


class ObjectPerceptionAgent(BaseAgent):
    MODEL_PATH = "/model-cache/yoloe-26x-seg.pt"

    def run(self, state: dict) -> AgentResult:
        try:
            # Import at runtime — only resolves inside Modal YOLOE_IMAGE container
            from ultralytics import YOLOE  # type: ignore

            model = YOLOE(self.MODEL_PATH)
            model.cuda()

            all_detections = []
            for artifact_id in state.get("clean_frame_artifact_ids", []):
                frame_bytes = self.download_artifact(artifact_id)
                img = Image.open(io.BytesIO(frame_bytes)).convert("RGB")

                # Run inference
                results = model.predict(img, conf=0.25, iou=0.45, verbose=False)

                frame_detections = []
                for r in results:
                    if r.masks is None:
                        # Detection without mask (shouldn't happen with -seg model)
                        for box, cls, conf in zip(r.boxes.xyxy, r.boxes.cls, r.boxes.conf):
                            frame_detections.append({
                                "class": model.names[int(cls)],
                                "confidence": float(conf),
                                "bbox": box.tolist(),
                                "mask_rle": None,
                            })
                    else:
                        for box, mask, cls, conf in zip(
                            r.boxes.xyxy, r.masks.data, r.boxes.cls, r.boxes.conf
                        ):
                            frame_detections.append({
                                "class": model.names[int(cls)],
                                "confidence": float(conf),
                                "bbox": box.tolist(),   # [x1, y1, x2, y2]
                                "mask_rle": mask_to_rle(mask.cpu().numpy()),
                            })

                all_detections.append({
                    "artifact_id": artifact_id,
                    "detections": frame_detections,
                })

            # Upload consolidated object detections JSON
            data_bytes = json.dumps(all_detections).encode()
            artifact_id_out = self.upload_artifact(
                data=data_bytes,
                artifact_type="PERCEPTION_JSON",
                filename="object_detections.json",
                content_type="application/json",
                producer_agent="PERCEPTION_OBJECT_BRANCH",
            )

            total_detections = sum(len(d["detections"]) for d in all_detections)
            return AgentResult(
                job_id=self.job_id,
                agent="PERCEPTION_OBJECT_BRANCH",
                attempt=1,
                status=AgentStatus.SUCCEEDED,
                state_updates={"object_perception_artifact_id": artifact_id_out},
                output_count=total_detections,
                metrics={
                    "frames_processed": len(all_detections),
                    "total_detections": total_detections,
                    "avg_detections_per_frame": round(
                        total_detections / max(len(all_detections), 1), 2
                    ),
                },
            )

        except Exception as e:
            import traceback
            traceback.print_exc()
            return AgentResult(
                job_id=self.job_id,
                agent="PERCEPTION_OBJECT_BRANCH",
                attempt=1,
                status=AgentStatus.FAILED,
                error_code="OBJECT_PERCEPTION_ERROR",
                error_message=str(e),
            )
