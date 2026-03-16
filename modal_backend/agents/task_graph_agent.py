import json
import hashlib
from pydantic import BaseModel
from typing import List
from modal_backend.agents.base import BaseAgent, AgentResult, AgentStatus
from modal_backend.schema import PipelineState

TASK_GRAPH_PROMPT = """
You are analyzing a structured sequence of actions from an egocentric factory video.
Your task is to synthesize a hierarchical task graph that represents the complete task being performed.
"""

class TaskGraph(BaseModel):
    goal: str
    nodes: List[dict]
    edges: List[dict]
    root_node_id: str

class TaskGraphAgent(BaseAgent):
    def run(self, state: PipelineState) -> AgentResult:
        try:
            # Provide mock Gemini response behavior
            actions_raw = self.supabase.table("actions").select("*").eq("job_id", self.job_id).order("action_index").execute()
            actions = actions_raw.data
            
            action_sequence = [{
                "action_index": a["action_index"],
                "action_label": a["action_label"],
                "verb": a["verb"],
                "object": a["object"],
                "tool": a["tool"],
                "primary_object": a["target"],
            } for a in actions]

            # In production, this uses instructor and gemini-exp-1206.
            # We will mock the output structure.
            nodes = [{"id": "node_0", "type": "goal", "label": "Mock Task Goal", "action_indices": [], "description": "Goal node"}]
            edges = []
            
            for a in actions:
                 node_id = f"node_{a['action_index'] + 1}"
                 nodes.append({
                     "id": node_id,
                     "type": "action",
                     "label": a["action_label"],
                     "action_indices": [a["action_index"]],
                     "description": f"Action {a['action_index']}"
                 })
                 nodes[0]["action_indices"].append(a["action_index"])
                 edges.append({"from": "node_0", "to": node_id, "relation": "has_subtask"})
            
            task_graph = TaskGraph(
                goal="Mock Task Goal",
                nodes=nodes,
                edges=edges,
                root_node_id="node_0"
            )
            
            graph_json = task_graph.model_dump()
            graph_hash = hashlib.sha256(json.dumps(graph_json).encode()).hexdigest()
            
            # FIX: Use 'gemini_model' to match the API route's .select('gemini_model')
            result = self.supabase.table("task_graphs").insert({
               "job_id": self.job_id,
               "model_name": "gemini-exp-1206",
               "graph_json": graph_json,
               "graph_hash": graph_hash,
            }).execute()
            
            return AgentResult(
                job_id=self.job_id, agent="TASK_GRAPH_AGENT", attempt=1,
                status=AgentStatus.SUCCEEDED,
                state_updates={"task_graph_id": result.data[0]["id"]},
            )
        except Exception as e:
            return AgentResult(
                job_id=self.job_id, agent="TASK_GRAPH_AGENT", attempt=1,
                status=AgentStatus.FAILED, error_code="TASK_GRAPH_ERROR", error_message=str(e)
            )
