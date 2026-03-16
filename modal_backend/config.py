from dataclasses import dataclass

@dataclass
class PipelineConfig:
    # Video Agent
    FRAME_SAMPLE_FPS: float = 1.0       # frames sampled per second
    KEYFRAMES_PER_MIN: int = 30          # max keyframes per minute of video

    # Quality Agent
    BLUR_LAPLACIAN_MIN: float = 100.0    # Laplacian variance blur threshold
    BRIGHTNESS_MIN: int = 20             # min mean pixel brightness
    BRIGHTNESS_MAX: int = 235            # max mean pixel brightness
    OVEREXPOSED_RATIO_MAX: float = 0.15  # max fraction of overexposed pixels
    MIN_CLEAN_FRAMES: int = 10           # below this -> FAILED_QUALITY_AGENT

    # Segmentation Agent
    MASK_DELTA_THRESHOLD: float = 0.15   # fraction mask area change = boundary
    CONTACT_HYSTERESIS_FRAMES: int = 3   # frames to confirm contact on/off
    MIN_SEGMENT_DURATION_MS: int = 1500  # merge segments shorter than this

    # Action Agent
    ACTION_CONFIDENCE_MIN: float = 0.40  # below this -> Gemini fallback
    MAX_UNKNOWN_ACTION_FRACTION: float = 0.50  # above this -> FAILED_ACTION_AGENT

    # General
    NODE_MAX_RETRIES: int = 3
    NODE_BACKOFF_BASE_SEC: int = 2
    PIPELINE_MAX_RUNTIME_SEC: int = 900
    HEARTBEAT_TIMEOUT_SEC: int = 180

CONFIG = PipelineConfig()
