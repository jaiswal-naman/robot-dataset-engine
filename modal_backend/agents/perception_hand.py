"""
HandPerceptionAgent — HaWoR 3D Hand Pose Recovery
Runs on Modal A10G GPU. Recovers camera-space 3D hand meshes, MANO pose params,
wrist + fingertip positions, and contact probability from egocentric frames.
"""
import json
import io
import numpy as np
from PIL import Image
from modal_backend.agents.base import BaseAgent, AgentResult, AgentStatus

# NOTE: 'hawor' and 'torch' are only available inside the Modal HAWOR_IMAGE container.

HAWOR_CHECKPOINT = "/model-cache/hawor_checkpoint.pt"


class HandPerceptionAgent(BaseAgent):
    def run(self, state: dict) -> AgentResult:
        try:
            import torch  # type: ignore
            from hawor import HaWoRPredictor  # type: ignore

            predictor = HaWoRPredictor(checkpoint=HAWOR_CHECKPOINT)
            predictor.cuda()

            clean_frame_ids = state.get("clean_frame_artifact_ids", [])
            hand_data = []
            total_hand_instances = 0

            with torch.no_grad():
                for artifact_id in clean_frame_ids:
                    frame_bytes = self.download_artifact(artifact_id)
                    img_rgb = np.array(
                        Image.open(io.BytesIO(frame_bytes)).convert("RGB")
                    )

                    # HaWoR prediction — returns None if no hands detected
                    result = predictor.predict(img_rgb)

                    if result is None or result.num_hands == 0:
                        hand_data.append({"artifact_id": artifact_id, "hands": []})
                        continue

                    hands = []
                    for hand in result.hands:
                        hands.append({
                            "hand_side": hand.side,                           # "left" | "right"
                            "mano_pose": hand.pose.tolist(),                  # (51,) MANO params
                            "wrist_position_3d": hand.wrist_3d.tolist(),      # (3,) camera-space
                            "fingertip_positions_3d": hand.fingertips_3d.tolist(),  # (5, 3)
                            "contact_probability": float(hand.contact_prob),  # 0..1
                            "keypoints_2d": hand.keypoints_2d.tolist(),       # (21, 2) px
                        })
                        total_hand_instances += 1

                    hand_data.append({"artifact_id": artifact_id, "hands": hands})

            data_bytes = json.dumps(hand_data).encode()
            artifact_id_out = self.upload_artifact(
                data=data_bytes,
                artifact_type="PERCEPTION_JSON",
                filename="hand_poses.json",
                content_type="application/json",
                producer_agent="PERCEPTION_HAND_BRANCH",
            )

            frames_with_hands = sum(1 for d in hand_data if d["hands"])
            return AgentResult(
                job_id=self.job_id,
                agent="PERCEPTION_HAND_BRANCH",
                attempt=1,
                status=AgentStatus.SUCCEEDED,
                state_updates={"hand_perception_artifact_id": artifact_id_out},
                output_count=total_hand_instances,
                metrics={
                    "frames_processed": len(hand_data),
                    "frames_with_hands": frames_with_hands,
                    "total_hand_instances": total_hand_instances,
                    "hand_detection_rate": round(
                        frames_with_hands / max(len(hand_data), 1), 3
                    ),
                },
            )

        except Exception as e:
            import traceback
            traceback.print_exc()
            return AgentResult(
                job_id=self.job_id,
                agent="PERCEPTION_HAND_BRANCH",
                attempt=1,
                status=AgentStatus.FAILED,
                error_code="HAND_PERCEPTION_ERROR",
                error_message=str(e),
            )
