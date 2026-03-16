import json
from modal_backend.agents.base import BaseAgent, AgentResult, AgentStatus
from modal_backend.schema import PipelineState

def compute_iou(bbox1, bbox2):
    return 0.5  # mock IOU

def get_bbox_from_keypoints(keypoints):
    return [0, 0, 100, 100]

def decode_rle(rle):
    return [0, 0, 100, 100] # mock mask bounds

class PerceptionMergeAgent(BaseAgent):
    def run(self, state: dict) -> AgentResult:
        try:
            # Download artifacts from the three branches
            obj_bytes = self.download_artifact(state["object_perception_artifact_id"])
            mask_bytes = self.download_artifact(state["mask_perception_artifact_id"])
            hand_bytes = self.download_artifact(state["hand_perception_artifact_id"])
            
            object_data = json.loads(obj_bytes.decode())
            mask_data = json.loads(mask_bytes.decode())
            hand_data = json.loads(hand_bytes.decode())
            
            obj_by_frame = {d["artifact_id"]: d["detections"] for d in object_data}
            mask_by_frame = {d["frame_index"]: d["masks"] for i, d in enumerate(mask_data)}
            hand_by_frame = {d.get("artifact_id", str(i)): d["hands"] for i, d in enumerate(hand_data)}

            perception_frames = []
            clean_frames = state.get("clean_frame_artifact_ids", [])
            for frame_idx, artifact_id in enumerate(clean_frames):
                objects = obj_by_frame.get(artifact_id, [])
                masks = mask_by_frame.get(frame_idx, [])
                hands = hand_by_frame.get(artifact_id, [])
                
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
                                
                # Retrieve timestamps
                row = self.supabase.table("artifacts").select("metadata").eq("id", artifact_id).execute()
                ts_ms = 0
                if row.data and row.data[0].get("metadata"):
                     ts_ms = row.data[0]["metadata"].get("ts_ms", 0)
                     
                perception_frames.append({
                    "artifact_id": artifact_id,
                    "frame_index": frame_idx,
                    "ts_ms": ts_ms,
                    "objects": objects,
                    "masks": masks,
                    "hands": hands,
                    "contacts": contacts,
                })
                
            # Serialize and upload
            data_bytes = json.dumps(perception_frames).encode()
            artifact_id_out = self.upload_artifact(
                data=data_bytes, artifact_type="PERCEPTION_JSON",
                filename="perception_merged.json", producer_agent="PERCEPTION_MERGE",
                content_type="application/json",
            )
            
            return AgentResult(
                job_id=self.job_id, agent="PERCEPTION_MERGE", attempt=1,
                status=AgentStatus.SUCCEEDED,
                state_updates={"perception_artifact_id": artifact_id_out},
                output_count=len(perception_frames),
            )
            
        except Exception as e:
            return AgentResult(
                job_id=self.job_id, agent="PERCEPTION_MERGE", attempt=1,
                status=AgentStatus.FAILED, error_code="PERCEPTION_MERGE_ERROR", error_message=str(e)
            )
