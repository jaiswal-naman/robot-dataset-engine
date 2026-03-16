from typing import TypedDict, List

class PipelineState(TypedDict):
    job_id: str
    trace_id: str
    
    # State References
    video_artifact_id: str
    raw_frame_artifact_ids: List[str]
    clean_frame_artifact_ids: List[str]
    
    # Branch Artifact IDs
    object_perception_artifact_id: str
    mask_perception_artifact_id: str
    hand_perception_artifact_id: str
    
    # Final perception artifact
    perception_artifact_id: str
    
    # Outcomes
    segment_ids: List[str]
    action_ids: List[str]
    task_graph_id: str
    dataset_manifest_id: str
    
    # Warnings and errors
    warnings: List[str]
