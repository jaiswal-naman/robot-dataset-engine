import hashlib
import os
from abc import ABC, abstractmethod
from typing import Generic, TypeVar
from pydantic import BaseModel, UUID4
from enum import Enum
from supabase import create_client, Client

T = TypeVar("T")

class AgentStatus(str, Enum):
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    RETRYABLE_FAILED = "RETRYABLE_FAILED"

class AgentResult(BaseModel, Generic[T]):
    job_id: str
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

BUCKET_FOR_TYPE = {
    "RAW_VIDEO": "raw-videos",
    "RAW_FRAME": "frames",
    "CLEAN_FRAME": "frames",
    "PERCEPTION_JSON": "intermediate",
    "SEGMENTATION_JSON": "intermediate",
    "ACTION_JSON": "intermediate",
    "TASK_GRAPH_JSON": "intermediate",
    "DATASET_JSON": "datasets",
    "DATASET_RLDS": "datasets",
    "THUMBNAIL": "thumbnails"
}

from modal_backend.schema import PipelineState

class BaseAgent(ABC):
    def __init__(self, job_id: str, trace_id: str):
        self.job_id = job_id
        self.trace_id = trace_id
        supabase_url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
        supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
        self.supabase: Client = create_client(supabase_url, supabase_key)
        self.storage = self.supabase.storage

    @abstractmethod
    def run(self, state: dict) -> AgentResult:
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
        bucket_name = BUCKET_FOR_TYPE.get(artifact_type, "intermediate")
        object_key = f"jobs/{self.job_id}/{artifact_type}/v1/{filename}"
        self.storage.from_(bucket_name).upload(
            path=object_key, file=data, file_options={"content_type": content_type}
        )
        result = self.supabase.table("artifacts").insert({
            "job_id": self.job_id,
            "artifact_type": artifact_type,
            "producer_agent": producer_agent,
            "bucket": bucket_name,
            "object_key": object_key,
            "content_type": content_type,
            "size_bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
        }).execute()
        return result.data[0]["id"]
