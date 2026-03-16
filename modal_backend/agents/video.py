import tempfile
import glob
import os
import shutil
import ffmpeg
import torch
import numpy as np
from PIL import Image
from torchvision import transforms
from sklearn_extra.cluster import KMedoids
from modal_backend.config import CONFIG
from modal_backend.agents.base import BaseAgent, AgentResult, AgentStatus
from modal_backend.schema import PipelineState

class VideoAgent(BaseAgent):
    def run(self, state: PipelineState) -> AgentResult:
        video_artifact_id = state["video_artifact_id"]
        
        # Step 1: Download video
        video_bytes = self.download_artifact(video_artifact_id)
        video_path = None
        sampled_frames_dir = None

        try:
            with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as f:
                f.write(video_bytes)
                video_path = f.name
                
            # Step 2: Validate with ffprobe
            probe = ffmpeg.probe(video_path)
            video_stream = next(s for s in probe["streams"] if s["codec_type"] == "video")
            duration_sec = float(probe["format"]["duration"])
            
            # FPS calculation string matching e.g. "30000/1001"
            fps_str = video_stream["r_frame_rate"]
            num, den = map(int, fps_str.split('/')) if '/' in fps_str else (int(fps_str), 1)
            fps = num / den

            if duration_sec > CONFIG.PIPELINE_MAX_RUNTIME_SEC:
                return AgentResult(job_id=self.job_id, agent="VIDEO_AGENT", attempt=1, status=AgentStatus.FAILED, error_code="DURATION_EXCEEDED")
            if video_stream["codec_name"] not in ["h264", "h265", "vp9", "av1"]:
                 return AgentResult(job_id=self.job_id, agent="VIDEO_AGENT", attempt=1, status=AgentStatus.FAILED, error_code="UNSUPPORTED_CODEC")
        
            # Step 3: Extract sampled frames with ffmpeg
            sampled_frames_dir = tempfile.mkdtemp()
            (
                ffmpeg
                .input(video_path)
                .filter("fps", fps=CONFIG.FRAME_SAMPLE_FPS)
                .output(f"{sampled_frames_dir}/frame_%04d.jpg", qscale=2)
                .run(quiet=True)
            )
            frame_paths = sorted(glob.glob(f"{sampled_frames_dir}/frame_*.jpg"))
            
            if not frame_paths:
                return AgentResult(job_id=self.job_id, agent="VIDEO_AGENT", attempt=1, status=AgentStatus.FAILED, error_code="NO_FRAMES_EXTRACTED")
            
            # Step 4: Compute DINOv2 embeddings
            model = torch.hub.load("facebookresearch/dinov2", "dinov2_vitb14")
            model.eval()
            if torch.cuda.is_available():
                model = model.cuda()
            
            transform = transforms.Compose([
                transforms.Resize(224),
                transforms.CenterCrop(224),
                transforms.ToTensor(),
                transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
            ])
            
            embeddings = []
            batch_size = 32
            for i in range(0, len(frame_paths), batch_size):
                batch = [transform(Image.open(p).convert('RGB')) for p in frame_paths[i:i+batch_size]]
                if torch.cuda.is_available():
                    tensor = torch.stack(batch).cuda()
                else:
                    tensor = torch.stack(batch)
                with torch.no_grad():
                    emb = model(tensor)  # (batch, 768)
                embeddings.extend(emb.cpu().numpy())
            
            # Step 5: K-medoids keyframe selection
            n_keyframes = min(int(duration_sec / 60 * CONFIG.KEYFRAMES_PER_MIN), len(frame_paths))
            # Fallback if too short
            n_keyframes = max(1, n_keyframes)
            
            kmedoids = KMedoids(n_clusters=n_keyframes, metric="cosine", random_state=42)
            kmedoids.fit(np.array(embeddings))
            keyframe_indices = sorted(kmedoids.medoid_indices_)
            keyframe_paths = [frame_paths[i] for i in keyframe_indices]
            selected_embeddings = [embeddings[i] for i in keyframe_indices]
            
            # Step 6: Upload keyframes and register artifacts
            raw_frame_artifact_ids = []
            for idx, path in zip(keyframe_indices, keyframe_paths):
                with open(path, "rb") as fr:
                    frame_bytes = fr.read()
                ts_ms = int((idx / CONFIG.FRAME_SAMPLE_FPS) * 1000)
                artifact_id = self.upload_artifact(
                    data=frame_bytes,
                    artifact_type="RAW_FRAME",
                    filename=f"frame_{idx:05d}.jpg",
                    content_type="image/jpeg",
                    producer_agent="VIDEO_AGENT",
                )
                
                # Store frame metadata in artifact.metadata JSONB
                self.supabase.table("artifacts").update({
                    "metadata": {"frame_index": int(idx), "ts_ms": int(ts_ms), "embedding_computed": True}
                }).eq("id", artifact_id).execute()
                raw_frame_artifact_ids.append(artifact_id)
                
            # Step 7: Store DINOv2 embeddings in search_embeddings table
            for artifact_id, embedding in zip(raw_frame_artifact_ids, selected_embeddings):
                self.supabase.table("search_embeddings").insert({
                    "job_id": self.job_id,
                    "action_id": None,
                    "segment_id": None,
                    "embedding": embedding.tolist(),
                    "embedding_model": "dinov2_vitb14",
                    "text_content": f"frame '{artifact_id}'",
                    "metadata": {"source": "video_agent", "artifact_id": artifact_id},
                }).execute()
                
            return AgentResult(
                job_id=self.job_id, agent="VIDEO_AGENT", attempt=1,
                status=AgentStatus.SUCCEEDED,
                state_updates={"raw_frame_artifact_ids": raw_frame_artifact_ids},
                output_count=len(raw_frame_artifact_ids)
            )

        except Exception as e:
            return AgentResult(
                job_id=self.job_id, agent="VIDEO_AGENT", attempt=1,
                status=AgentStatus.FAILED, error_code="VIDEO_PROCESSING_ERROR", error_message=str(e)
            )
        finally:
            # FIX: Clean up temp files to prevent disk space leaks on warm containers
            if video_path and os.path.exists(video_path):
                try:
                    os.unlink(video_path)
                except OSError:
                    pass
            if sampled_frames_dir and os.path.exists(sampled_frames_dir):
                try:
                    shutil.rmtree(sampled_frames_dir, ignore_errors=True)
                except OSError:
                    pass
