import time
from langgraph.graph import StateGraph, END
from modal_backend.schema import PipelineState
from modal_backend.app import update_job_status, write_agent_run

# Agent Imports
from modal_backend.agents.video import VideoAgent
from modal_backend.agents.quality import QualityAgent
from modal_backend.agents.perception_object import ObjectPerceptionAgent
from modal_backend.agents.perception_mask import MaskPerceptionAgent
from modal_backend.agents.perception_hand import HandPerceptionAgent
from modal_backend.agents.perception_merge import PerceptionMergeAgent
from modal_backend.agents.segmentation import SegmentationAgent
from modal_backend.agents.action_agent import ActionAgent
from modal_backend.agents.task_graph_agent import TaskGraphAgent
from modal_backend.agents.dataset_builder import DatasetBuilderAgent

# Agent → DB status enum mapping (for processing_jobs.status column)
AGENT_STATUS_MAP = {
    "VideoAgent":            "VIDEO_AGENT_RUNNING",
    "QualityAgent":          "QUALITY_AGENT_RUNNING",
    "ObjectPerceptionAgent": "PERCEPTION_AGENT_RUNNING",
    "MaskPerceptionAgent":   "PERCEPTION_AGENT_RUNNING",
    "HandPerceptionAgent":   "PERCEPTION_AGENT_RUNNING",
    "PerceptionMergeAgent":  "PERCEPTION_AGENT_RUNNING",
    "SegmentationAgent":     "SEGMENTATION_AGENT_RUNNING",
    "ActionAgent":           "ACTION_AGENT_RUNNING",
    "TaskGraphAgent":        "TASK_GRAPH_AGENT_RUNNING",
    "DatasetBuilderAgent":   "DATASET_BUILDER_RUNNING",
}

AGENT_DB_NAME = {
    "VideoAgent":            "VIDEO_AGENT",
    "QualityAgent":          "QUALITY_AGENT",
    "ObjectPerceptionAgent": "PERCEPTION_OBJECT_BRANCH",
    "MaskPerceptionAgent":   "PERCEPTION_MASK_BRANCH",
    "HandPerceptionAgent":   "PERCEPTION_HAND_BRANCH",
    "PerceptionMergeAgent":  "PERCEPTION_MERGE",
    "SegmentationAgent":     "SEGMENTATION_AGENT",
    "ActionAgent":           "ACTION_AGENT",
    "TaskGraphAgent":        "TASK_GRAPH_AGENT",
    "DatasetBuilderAgent":   "DATASET_BUILDER",
}

def create_agent_node(agent_class):
    agent_name = agent_class.__name__
    running_status = AGENT_STATUS_MAP.get(agent_name, f"{agent_name}_RUNNING")
    db_agent_name = AGENT_DB_NAME.get(agent_name, agent_name)

    def node(state: PipelineState) -> PipelineState:
        job_id = state["job_id"]
        trace_id = state["trace_id"]
        start_ms = int(time.time() * 1000)

        # ── STEP 1: Set status BEFORE running (Fix for audit issue #3) ──────────
        update_job_status(job_id, running_status, current_agent=db_agent_name)

        # ── STEP 2: Write agent_runs RUNNING row ─────────────────────────────────
        write_agent_run(job_id, db_agent_name, "RUNNING")

        # ── STEP 3: Instantiate and execute agent ─────────────────────────────────
        try:
            agent = agent_class(job_id, trace_id)
            result = agent.run(state)
            duration_ms = int(time.time() * 1000) - start_ms

            if result.status == "SUCCEEDED":
                # ── STEP 4: Merge state updates ──────────────────────────────────
                for k, v in result.state_updates.items():
                    state[k] = v

                # ── STEP 5: Write agent_runs SUCCEEDED ───────────────────────────
                write_agent_run(job_id, db_agent_name, "SUCCEEDED",
                                output_count=result.output_count,
                                duration_ms=duration_ms)
            else:
                # Agent returned a failure result (non-exception path)
                error_code = result.error_code or "AGENT_FAILED"
                warnings = state.get("warnings", [])
                warnings.append(f"{agent_name} failed [{error_code}]: {result.error_message}")
                state["warnings"] = warnings

                write_agent_run(job_id, db_agent_name, "FAILED",
                                error_code=error_code,
                                error_message=result.error_message,
                                duration_ms=duration_ms)

                # Only mark job failed for critical agents
                # Perception branches are non-fatal individually; merge agent handles it
                critical_agents = {"VideoAgent", "QualityAgent", "DatasetBuilderAgent"}
                if agent_name in critical_agents:
                    update_job_status(job_id, f"FAILED_{db_agent_name}",
                                      failure_code=error_code,
                                      failure_details={"agent": db_agent_name, "error": result.error_message})

        except Exception as e:
            import traceback
            traceback.print_exc()
            duration_ms = int(time.time() * 1000) - start_ms
            write_agent_run(job_id, db_agent_name, "FAILED",
                            error_code="UNHANDLED_EXCEPTION",
                            error_message=str(e)[:500],
                            duration_ms=duration_ms)
            update_job_status(job_id, f"FAILED_{db_agent_name}",
                              failure_code="UNHANDLED_EXCEPTION",
                              failure_details={"agent": db_agent_name, "error": str(e)[:500]})

        return state

    node.__name__ = agent_name
    return node


def perception_prepare_node(state: PipelineState) -> PipelineState:
    """Fan-out coordinator — no-op passthrough."""
    return state


def build_pipeline():
    builder = StateGraph(PipelineState)

    # Nodes
    builder.add_node("video_agent",             create_agent_node(VideoAgent))
    builder.add_node("quality_agent",           create_agent_node(QualityAgent))
    builder.add_node("perception_prepare",      perception_prepare_node)
    builder.add_node("perception_object",       create_agent_node(ObjectPerceptionAgent))
    builder.add_node("perception_mask",         create_agent_node(MaskPerceptionAgent))
    builder.add_node("perception_hand",         create_agent_node(HandPerceptionAgent))
    builder.add_node("perception_merge",        create_agent_node(PerceptionMergeAgent))
    builder.add_node("segmentation_agent",      create_agent_node(SegmentationAgent))
    builder.add_node("action_agent",            create_agent_node(ActionAgent))
    builder.add_node("task_graph_agent",        create_agent_node(TaskGraphAgent))
    builder.add_node("dataset_builder",         create_agent_node(DatasetBuilderAgent))

    # Edges — sequential flow (reliable, correct status sequencing)
    builder.set_entry_point("video_agent")
    builder.add_edge("video_agent",       "quality_agent")
    builder.add_edge("quality_agent",     "perception_prepare")

    # Sequential perception (correct order: object → mask → hand → merge)
    # Note: True parallel requires LangGraph channels; sequencing is simpler and more observable
    builder.add_edge("perception_prepare", "perception_object")
    builder.add_edge("perception_object",  "perception_mask")
    builder.add_edge("perception_mask",    "perception_hand")
    builder.add_edge("perception_hand",    "perception_merge")

    builder.add_edge("perception_merge",   "segmentation_agent")
    builder.add_edge("segmentation_agent", "action_agent")
    builder.add_edge("action_agent",       "task_graph_agent")
    builder.add_edge("task_graph_agent",   "dataset_builder")
    builder.add_edge("dataset_builder",    END)

    return builder.compile()
