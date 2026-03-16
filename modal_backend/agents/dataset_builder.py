"""
DatasetBuilderAgent — VLA Dataset JSON + Real RLDS TFRecord
Runs on Modal CPU container with TensorFlow installed.
Assembles all pipeline outputs into structured training records
and serializes them as TFRecord (RLDS format) for OpenVLA/RT-2.
"""
import json
import io
import time
from pydantic import BaseModel
from typing import List, Optional
from modal_backend.agents.base import BaseAgent, AgentResult, AgentStatus
from modal_backend.schema import PipelineState

# NOTE: 'tensorflow' only resolves inside the Modal TF_IMAGE container.
# Import is inside build_rlds_bundle() to avoid load-time failures locally.


class VLARecord(BaseModel):
    record_index: int
    observation_image_artifact_id: str
    language_instruction: str
    action_verb: str
    action_object: Optional[str]
    action_tool: Optional[str]
    action_target: Optional[str]
    timestamp_start_ms: int
    timestamp_end_ms: int
    confidence: float
    model_used: str


class VLADataset(BaseModel):
    schema_version: str
    job_id: str
    video_duration_sec: float
    records: List[VLARecord]
    task_graph: dict
    quality_metrics: Optional[dict] = None


def get_middle_frame_for_segment(frames: List[str], start_idx: int, end_idx: int) -> str:
    mid = start_idx + (end_idx - start_idx) // 2
    if 0 <= mid < len(frames):
        return frames[mid]
    elif frames:
        return frames[0]
    return ""


def build_rlds_bundle(dataset: VLADataset, download_fn) -> bytes:
    """
    Serialize all VLARecords as RLDS TFRecord format.
    Each record becomes one tf.train.Example with:
      - observation/image (raw JPEG bytes)
      - language_instruction (UTF-8 bytes)
      - action/verb, action/object, action/tool, action/target (UTF-8 bytes)
      - timestamp/start_ms, timestamp/end_ms (int64)
      - confidence (float)
    """
    import tensorflow as tf  # type: ignore

    buffer = io.BytesIO()
    with tf.io.TFRecordWriter(
        buffer,
        options=tf.io.TFRecordOptions(compression_type="GZIP"),
    ) as writer:
        for record in dataset.records:
            # Download the observation image (representative frame for this segment)
            if record.observation_image_artifact_id:
                try:
                    frame_bytes = download_fn(record.observation_image_artifact_id)
                except Exception:
                    frame_bytes = b""   # Degrade gracefully — write empty bytes
            else:
                frame_bytes = b""

            def bytes_feature(value: bytes) -> tf.train.Feature:
                return tf.train.Feature(bytes_list=tf.train.BytesList(value=[value]))

            def int64_feature(value: int) -> tf.train.Feature:
                return tf.train.Feature(int64_list=tf.train.Int64List(value=[value]))

            def float_feature(value: float) -> tf.train.Feature:
                return tf.train.Feature(float_list=tf.train.FloatList(value=[value]))

            feature = {
                "observation/image": bytes_feature(frame_bytes),
                "language_instruction": bytes_feature(
                    record.language_instruction.encode("utf-8")
                ),
                "action/verb": bytes_feature(
                    (record.action_verb or "").encode("utf-8")
                ),
                "action/object": bytes_feature(
                    (record.action_object or "").encode("utf-8")
                ),
                "action/tool": bytes_feature(
                    (record.action_tool or "").encode("utf-8")
                ),
                "action/target": bytes_feature(
                    (record.action_target or "").encode("utf-8")
                ),
                "timestamp/start_ms": int64_feature(record.timestamp_start_ms),
                "timestamp/end_ms": int64_feature(record.timestamp_end_ms),
                "confidence": float_feature(record.confidence),
                "record_index": int64_feature(record.record_index),
            }
            example = tf.train.Example(
                features=tf.train.Features(feature=feature)
            )
            writer.write(example.SerializeToString())

    return buffer.getvalue()


class DatasetBuilderAgent(BaseAgent):
    def run(self, state: dict) -> AgentResult:
        try:
            # 1. Load all pipeline artefacts from DB
            job = (
                self.supabase.table("processing_jobs")
                .select("*")
                .eq("id", self.job_id)
                .single()
                .execute()
                .data
            )
            segments = (
                self.supabase.table("skill_segments")
                .select("*")
                .eq("job_id", self.job_id)
                .order("segment_index")
                .execute()
                .data
            )
            actions = (
                self.supabase.table("actions")
                .select("*")
                .eq("job_id", self.job_id)
                .order("action_index")
                .execute()
                .data
            )
            task_graph_row = (
                self.supabase.table("task_graphs")
                .select("*")
                .eq("job_id", self.job_id)
                .single()
                .execute()
                .data
            )

            # 2. Build VLA records — one per action row
            vla_records: List[VLARecord] = []
            clean_frames = state.get("clean_frame_artifact_ids", [])

            for action in actions:
                seg = next(
                    (s for s in segments if s["id"] == action["segment_id"]), None
                )
                if not seg:
                    continue

                frame_artifact_id = get_middle_frame_for_segment(
                    clean_frames, seg["start_frame_idx"], seg["end_frame_idx"]
                )

                vla_records.append(
                    VLARecord(
                        record_index=action["action_index"],
                        observation_image_artifact_id=frame_artifact_id,
                        language_instruction=action["action_label"],
                        action_verb=action["verb"],
                        action_object=action.get("object"),
                        action_tool=action.get("tool"),
                        action_target=action.get("target"),
                        timestamp_start_ms=seg["start_ts_ms"],
                        timestamp_end_ms=seg["end_ts_ms"],
                        confidence=float(action["confidence"]),
                        model_used=action.get("model_used") or "EgoVLM-3B",
                    )
                )

            dataset = VLADataset(
                schema_version="v1",
                job_id=self.job_id,
                video_duration_sec=float(job.get("video_duration_sec") or 60.0),
                records=vla_records,
                task_graph=task_graph_row["graph_json"] if task_graph_row else {},
            )

            # Validate schema with Pydantic
            dataset_validated = VLADataset.model_validate(dataset.model_dump())

            # 3. Write DATASET_JSON artifact
            json_bytes = dataset_validated.model_dump_json(indent=2).encode()
            json_artifact_id = self.upload_artifact(
                data=json_bytes,
                artifact_type="DATASET_JSON",
                filename="dataset.json",
                content_type="application/json",
                producer_agent="DATASET_BUILDER",
            )

            # 4. Write DATASET_RLDS artifact — real TFRecord (GZIP-compressed)
            rlds_bytes = build_rlds_bundle(dataset_validated, self.download_artifact)
            rlds_artifact_id = self.upload_artifact(
                data=rlds_bytes,
                artifact_type="DATASET_RLDS",
                filename="dataset.tfrecord.gz",
                content_type="application/octet-stream",
                producer_agent="DATASET_BUILDER",
            )

            # 5. Build manifest JSON with counts
            manifest_json = {
                "segment_count": len(segments),
                "action_count": len(actions),
                "task_graph_node_count": (
                    len(task_graph_row["graph_json"].get("nodes", []))
                    if task_graph_row
                    else 0
                ),
                "rlds_record_count": len(vla_records),
                "rlds_compression": "GZIP",
                "rlds_size_bytes": len(rlds_bytes),
            }

            manifest_result = (
                self.supabase.table("dataset_manifests")
                .insert({
                    "job_id": self.job_id,
                    "schema_version": "v1",
                    "dataset_version": f"v1.{int(time.time())}",
                    "dataset_json_artifact_id": json_artifact_id,
                    "dataset_rlds_artifact_id": rlds_artifact_id,
                    "record_count": len(vla_records),
                    "warnings": state.get("warnings", []),
                    "manifest_json": manifest_json,
                })
                .execute()
            )

            return AgentResult(
                job_id=self.job_id,
                agent="DATASET_BUILDER",
                attempt=1,
                status=AgentStatus.SUCCEEDED,
                state_updates={"dataset_manifest_id": manifest_result.data[0]["id"]},
                output_count=len(vla_records),
                metrics={
                    "record_count": len(vla_records),
                    "json_size_bytes": len(json_bytes),
                    "rlds_size_bytes": len(rlds_bytes),
                    "segment_count": len(segments),
                },
            )

        except Exception as e:
            import traceback
            traceback.print_exc()
            return AgentResult(
                job_id=self.job_id,
                agent="DATASET_BUILDER",
                attempt=1,
                status=AgentStatus.FAILED,
                error_code="DATASET_BUILDER_ERROR",
                error_message=str(e),
            )
