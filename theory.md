# AutoEgoLab — Deep Theoretical Explanation

> This document explains **every theoretical concept** behind AutoEgoLab — the models, algorithms, design patterns, and mathematical ideas — in plain language and with technical depth.

---

# Table of Contents

1. [The Problem Domain — Robot Learning](#1-the-problem-domain--robot-learning)
2. [Vision Transformers — The Foundation](#2-vision-transformers--the-foundation)
3. [Self-Supervised Learning and DINOv2](#3-self-supervised-learning-and-dinov2)
4. [Keyframe Selection — K-Medoids Clustering](#4-keyframe-selection--k-medoids-clustering)
5. [Image Quality Metrics — Classical Computer Vision](#5-image-quality-metrics--classical-computer-vision)
6. [Object Detection — YOLOE Architecture](#6-object-detection--yoloe-architecture)
7. [Promptable Segmentation — SAM 2.1 and Memory Banks](#7-promptable-segmentation--sam-21-and-memory-banks)
8. [3D Hand Reconstruction — HaWoR and the MANO Model](#8-3d-hand-reconstruction--hawor-and-the-mano-model)
9. [Temporal Segmentation — Signal Processing Approach](#9-temporal-segmentation--signal-processing-approach)
10. [Egocentric VLMs — EgoVLM and Action Recognition](#10-egocentric-vlms--egovlm-and-action-recognition)
11. [Structured Output Extraction — Instructor Library](#11-structured-output-extraction--instructor-library)
12. [Task Graph Generation — Causal Reasoning with LLMs](#12-task-graph-generation--causal-reasoning-with-llms)
13. [VLA Datasets and RLDS Format](#13-vla-datasets-and-rlds-format)
14. [LangGraph — Stateful AI Pipelines](#14-langgraph--stateful-ai-pipelines)
15. [Supabase CDC and Real-Time Architecture](#15-supabase-cdc-and-real-time-architecture)
16. [Vector Embeddings and pgvector Search](#16-vector-embeddings-and-pgvector-search)
17. [Fault Tolerance — Tenacity, Checkpoints, Watchdogs](#17-fault-tolerance--tenacity-checkpoints-watchdogs)
18. [GPU Architecture — Why T4 vs A10G](#18-gpu-architecture--why-t4-vs-a10g)
19. [Modal.com — Serverless GPU Computing](#19-modalcom--serverless-gpu-computing)
20. [Security — JWT, HMAC, RLS, Signed URLs](#20-security--jwt-hmac-rls-signed-urls)

---

# 1. The Problem Domain — Robot Learning

## What Is Robot Imitation Learning?

Imitation learning (IL) is a paradigm in which a robot learns to perform a task by observing demonstrations of that task being performed by a human or an expert agent. The robot does not need to be explicitly programmed with the rules of the task — instead, it generalises from examples.

There are two main branches:
- **Behavioural Cloning (BC):** The robot trains a policy network π(a|s) — a function mapping states to actions — using supervised learning directly on (state, action) pairs from demonstrations.
- **Inverse Reinforcement Learning (IRL):** The robot infers the reward function that explains the demonstrator's behaviour, then optimises a policy against that inferred reward.

AutoEgoLab primarily targets **behavioural cloning** datasets. Each frame of a demonstration video is treated as a state `s`, and the associated action label (verb, object, tool, target) is treated as the action `a`. The pipeline converts raw video into (s, a) pairs stored as VLA records.

## What Is a VLA Dataset?

**VLA = Vision-Language-Action.** A VLA dataset extends traditional (state, action) pairs with natural language instruction. Each record contains:
- **Vision:** An image or sequence of images (the observation)
- **Language:** A natural language description of what the agent should do ("tighten the bolt with a wrench")
- **Action:** The corresponding motor command or action label

Modern robot learning frameworks such as OpenVLA, RT-2, and π0 consume VLA datasets to train generalised robot policies that can follow novel language instructions.

## Why Egocentric Video?

**Egocentric (first-person) video** is the natural data format for imitation learning because:
1. The robot's own camera will be in a first-person configuration
2. The demonstrator's hands and tools are always visible and centred
3. The camera is aligned with the task workspace — what the human sees is what the robot needs to see

Traditional research datasets collected frontal "third-person" views. But a robot mounted with an eye-in-hand camera will encounter a dramatically different visual perspective. Egocentric video training provides better sim-to-real transfer because the viewpoint matches deployment conditions.

---

# 2. Vision Transformers — The Foundation

## The Core Idea

**Transformers** were originally invented for natural language processing (NLP) by Vaswani et al. in 2017 ("Attention is All You Need"). The canonical insight was: instead of processing sequences recurrently (LSTM, GRU), process all tokens simultaneously using **self-attention** — a mechanism that computes pairwise relationships between every element in a sequence.

**Vision Transformers (ViT)** apply this principle to images. An image is divided into a grid of fixed-size patches (e.g., 14×14 pixels). Each patch is linearly projected into a high-dimensional vector (called a token or embedding). These patch tokens, plus a special classification [CLS] token, are fed as a sequence into a standard multi-head self-attention Transformer encoder.

## How Self-Attention Works (Simplified)

For each token, the Transformer computes three vectors:
- **Query (Q):** "What am I looking for?"
- **Key (K):** "What information do I offer?"
- **Value (V):** "What actual content do I carry?"

The attention score between token i and token j is:

```
Attention(i, j) = softmax( Q_i · K_j / sqrt(d_k) )
```

The output of each token is a weighted sum of all other tokens' Value vectors, weighted by their attention scores. This means every patch in the image can attend to every other patch simultaneously — a drastic departure from CNNs, which only process local neighbourhoods.

## Why ViT Over CNN for This Task?

Convolutional Neural Networks (CNNs) excel at local feature extraction through their convolutional filters. However:
- CNNs have an **inductive bias towards translation invariance** — they assume features repeat across space. This is useful for classification but can suppress global structural reasoning.
- ViTs have **no such inductive bias**. They learn which parts of the image are relevant for any given downstream task from scratch, through global attention.
- ViTs produce **rich patch-level feature maps** — every patch has its own embedding representing its semantic content in the context of the entire image. These patch features are what DINOv2 uses for dense visual representation.

---

# 3. Self-Supervised Learning and DINOv2

## Why Self-Supervised?

Supervised learning requires labelled data. For ImageNet-scale vision, that means millions of human-annotated images. Labels introduce bias: a model trained for ImageNet classification learns to distinguish between 1000 categories of ImageNet objects, which may not align at all with what you need for a robotics application.

**Self-supervised learning (SSL)** trains models using the structure of the data itself as a supervision signal — no human labels required. The model learns to be consistent across transformations: if you show it two augmented views of the same image, it should produce similar representations.

## The DINO / DINOv2 Objective

DINO (Self-DIstillation with NO labels) uses a **teacher-student framework**:
- A **student network** takes one augmented crop of an image
- A **teacher network** (an exponentially-moving-average copy of the student) takes another augmented crop
- The student is trained to predict the teacher's output distribution

Both crops come from the same original image, so the student must learn that two visually different-looking patches are semantically the same thing. This forces the model to learn **semantic visual features that are invariant to augmentation** — colour jitter, rotation, cropping, blurring.

**DINOv2** scales this with:
- 142 million deduped images from a curated dataset (not ImageNet)
- ViT-B/14 architecture: 86M parameters, patch size 14×14
- Mixed-resolution training
- A distillation component from a larger teacher (ViT-L)

The result is a 768-dimensional embedding per image that encodes **structural and semantic visual information** without any class label bias. Two frames from the same scene at different viewing angles → close embeddings. Two frames from different tasks → distant embeddings.

## Why This Is Perfect for Keyframe Selection

The 768-dim DINOv2 space is a **semantic proximity space**. Frames that look visually similar (same objects, same pose, same background) cluster tightly. Frames capturing unique moments (object being lifted, bolt being inserted) are spread apart. Keyframe selection in this space naturally identifies moments of **maximum semantic diversity** — which is exactly what you want for a training dataset.

---

# 4. Keyframe Selection — K-Medoids Clustering

## Why Clustering?

A 5-minute factory video at 1 FPS has 300 frames. Of these, a large fraction will be near-identical: someone holding a tool motionless while repositioning, or panning the camera between tasks. Including all 300 frames in a training dataset would:
1. Massively bias the dataset towards static poses
2. Dramatically increase downstream processing cost
3. Add redundancy without adding information

The goal is to select a small, **maximally informative and diverse** subset.

## K-Means vs K-Medoids: A Critical Distinction

**K-Means:** An iterative algorithm that partitions n points into k clusters. The cluster centre (centroid) is the **mean** of all points in the cluster. The issue: the centroid is a mathematical average that may not correspond to any real data point.

For images: a K-Means centroid in embedding space doesn't correspond to any real frame. You'd have to synthesise a frame from the average embedding — which you can't do without a generative model.

**K-Medoids (PAM — Partitioning Around Medoids):** Instead of computing centroids, K-Medoids selects one actual data point per cluster as the representative — the **medoid**, defined as the point that minimises the sum of distances to all other points in the cluster. 

In the context of keyframe selection:
- Each cluster groups frames that are semantically similar
- The medoid is the single most representative frame from that cluster
- By definition, it's a real frame from the original video

This guarantees the selected keyframes are **real, representative, and non-redundant**.

## Cosine Distance in Embedding Spaces

For high-dimensional embedding vectors, **cosine distance** is more meaningful than Euclidean distance:

```
cosine_distance(A, B) = 1 - (A · B) / (||A|| × ||B||)
```

Euclidean distance measures absolute position in space. Two frames with the same semantic content but different overall illumination might have very different Euclidean distances. Cosine distance measures the **angle** between vectors — capturing semantic similarity independent of magnitude. This makes it the correct metric for comparing DINOv2 embeddings.

---

# 5. Image Quality Metrics — Classical Computer Vision

## The Laplacian Operator for Blur Detection

The **Laplacian** is a second-order differential operator. Applied to a grayscale image I, it computes:

```
∇²I = ∂²I/∂x² + ∂²I/∂y²
```

In discrete image processing, this is approximated by a convolution kernel:

```
[0,  1, 0]
[1, -4, 1]
[0,  1, 0]
```

The Laplacian responds strongly to **edges** and **high-frequency detail** (sharp transitions in pixel intensity). For a sharp image, edges are crisp — the Laplacian produces large positive and negative values. For a blurry image, edges are smoothed — the Laplacian produces small values.

**The variance of the Laplacian** is therefore a single number that captures the overall "sharpness" of an image:
- High variance → sharp image
- Low variance → blurry image
- Threshold: ≥ 100 in AutoEgoLab

This is entirely deterministic — same image always produces the same score. No GPU, no model, no randomness.

## Overexposure Detection

Overexposure occurs when pixel values are saturated (at or near the maximum 255 in an 8-bit image). Saturated pixels carry no information — all their detail has been "blown out." YOLOE and SAM both rely on edge gradients (fine transitions between object boundaries) that are destroyed by overexposed regions.

The heuristic checks: what fraction of pixels have any channel value > 250? If > 15% of pixels are "clipped," the frame is discarded.

## Why Not ML for Quality?

A learned quality classifier would:
1. Require training data (labelled "good" and "bad" frames)
2. Potentially hallucinate incorrect quality scores for novel image types
3. Add GPU inference time
4. Introduce non-determinism (floating-point differences across hardware)

Classical CV filters are: instantaneous, deterministic, interpretable, and require no training data. For a well-defined, bounded problem like exposure and blur detection, this is strictly superior.

---

# 6. Object Detection — YOLOE Architecture

## Brief History of Object Detection

Early detection approaches used two-stage pipelines:
1. **Region Proposal Network (RPN):** Generates candidate regions where objects might be
2. **Classification head:** Classifies each proposed region

Faster R-CNN (Ren et al., 2015) is the canonical two-stage detector. High accuracy, but slow due to the double pass through the network.

**Single-stage detectors** eliminated the region proposal step. The most famous: **YOLO (You Only Look Once)** — divides the image into a grid where each cell predicts bounding boxes and class probabilities simultaneously in one forward pass.

## YOLOE: The Modern YOLO

YOLOE-26x-seg is a modern evolution of YOLO with several key improvements:

**Anchor-free design:** Early YOLO versions required predefined "anchor boxes" — prior shapes matched to expected object sizes. YOLOE directly predicts object centre, width, and height as continuous offsets from grid positions, eliminating the need to hand-tune anchors for each domain.

**Instance segmentation head:** Beyond bounding boxes, YOLOE adds a parallel segmentation head. For each detected object, it outputs a **Run-Length Encoded (RLE) pixel mask** — a compact binary mask precisely delineating the object's boundary at pixel level.

**Why we need both bounding boxes AND masks:**
- Bounding boxes are axis-aligned rectangles — useful for contact heuristics (IoU computation with hand keypoints)
- Masks are pixel-precise — used for Jaccard distance computation in the Segmentation Agent and for accurate contact determination

The `26x` in YOLOE-26x-seg refers to the model variant (approximately 26M parameters scaled). It balances accuracy and real-time T4 GPU inference speed.

---

# 7. Promptable Segmentation — SAM 2.1 and Memory Banks

## What Is SAM?

**Segment Anything Model (SAM)** by Meta AI is a foundation model for image segmentation. Unlike classical segmentation models trained to segment specific categories, SAM is **category-agnostic and promptable**: given a point, box, or mask prompt, it segments whatever object is indicated.

SAM's architecture:
1. **Image Encoder:** A large ViT (MAE pre-trained) that produces dense image embeddings
2. **Prompt Encoder:** Encodes spatial prompts (points, boxes, masks) into embedding vectors
3. **Mask Decoder:** A transformer that takes image embeddings + prompt embeddings and predicts segmentation masks

## SAM 2 — Extending to Video

SAM 2 extends SAM from single images to video sequences via a **Streaming Memory Architecture**:

### Memory Bank
The memory bank maintains a buffer of memory features from recent frames:
- **Recent frame memories:** Detailed memory of the last N frames
- **Consolidated memories:** Compressed summaries of older frames

When processing frame t, the mask decoder attends not just to the current frame's image embedding, but also to **historical frame memories**. This gives the model persistent knowledge of tracked objects across time.

### Why This Solves Occlusion
Without memory: if object A is hidden behind object B for 5 frames, a frame-by-frame segmenter loses track of A. When A reappears, it assigns a new identity.

With SAM 2's memory bank: the memory stores the visual appearance and shape of object A. When A reappears, the decoder matches the current frame's features against stored memory → correctly re-identifies A with the same mask ID.

This **temporal consistency** is critical for the Segmentation Agent: it needs to know that the object picked up in frame 10 is the same object placed down in frame 80.

## SAM 2.1 Improvements
SAM 2.1 adds improved memory bank capacity, better handling of fast-moving objects, and upgraded training data with more diverse occlusion patterns.

---

# 8. 3D Hand Reconstruction — HaWoR and the MANO Model

## The MANO Parametric Hand Model

**MANO (Model of a hand with Articulations and Non-rigid deformations)** is a statistical parametric model of the human hand. Think of it like a template hand that can be deformed into any valid human hand pose and shape via low-dimensional parameters.

MANO was created by fitting a template hand mesh to thousands of 3D hand scans (from a 3D scanner), then extracting the principal components of variation.

**Shape parameters β (10 dimensions):**
Capture person-to-person shape variation: hand size, finger length ratios, palm width. 10 principal components are sufficient to describe ~95% of hand shape variation across humans.

**Pose parameters θ (51 dimensions):**
- 3 dimensions: global wrist rotation (axis-angle representation)
- 48 dimensions = 16 joints × 3 axes = 48 DoF for finger articulation

From (β, θ), MANO's linear blend skinning (LBS) function reconstructs a **778-vertex 3D mesh** of the hand. Every valid combination of β and θ produces an anatomically plausible hand — the model cannot generate impossible hand poses because the parameter space is constrained to the manifold of real hand observations.

## Why MANO Matters for Robotics

A robot gripper has specific degrees of freedom (DoF). MANO's parametric decomposition maps directly onto robot joint configurations:
- Finger joint angles → robot finger angles
- Wrist rotation → robot wrist orientation
- Fingertip 3D positions → robot end-effector targets

This is why VLA datasets with MANO parameters are more actionable than 2D keypoint datasets — the 3D structure is directly translatable to robot kinematics.

## HaWoR Architecture

**HaWoR (Hand-centric World Reconstruction)** is a method that estimates MANO parameters from monocular egocentric video.

The key challenge: single-camera (monocular) video is fundamentally ambiguous in 3D. A hand close to the camera and small, or a hand far from the camera and large, can produce the same 2D projection. HaWoR uses several strategies to disambiguate:

1. **Temporal consistency:** Pose changes should be smooth across frames (humans don't teleport). HaWoR uses temporal attention across multiple frames to enforce smooth trajectories.

2. **Egocentric-specific training data:** HaWoR is trained on large egocentric hand datasets (H2O, EPIC-Kitchens, Ego4D subsets). The model's priors are tuned to the typical viewpoints, poses, and occlusion patterns of first-person video.

3. **Contact reasoning:** HaWoR estimates a per-frame `contact_probability` — the likelihood that a fingertip is in contact with a surface. This comes from learned contact physics: when a hand squeezes an object, finger joints deform in characteristic ways.

## Why Not MediaPipe?

MediaPipe Hands is an excellent model for **frontal webcam views** — the camera is pointing at the face, and hands are in a natural open gesture. Its training data is dominated by this configuration.

In egocentric factory video:
- The camera is mounted on the worker's head, pointing downward toward the workspace
- Hands are frequently seen from unusual angles (dorsal view, lateral view)
- Fingers are often gripping tools, creating heavy inter-finger occlusion
- The background is a workbench, not empty space

HaWoR was specifically designed and evaluated on egocentric datasets. Its MANO-based output is also 3D, not 2D, making it fundamentally more informative for robot learning.

---

# 9. Temporal Segmentation — Signal Processing Approach

## The Problem of Action Boundaries

A continuous video of a factory worker performing a complex task contains dozens of distinct atomic actions. The boundary between two actions is often subtle — the worker finishes "positioning a bracket" and immediately begins "tightening a bolt" in a fluid motion. Identifying these boundaries is the core challenge of **temporal action segmentation**.

Two broad approaches exist:
1. **Learned approach:** Train a sequence model (TCN, Transformer) to classify each frame into an action category and infer boundaries from class transitions
2. **Signal-based approach:** Compute signal features from perception outputs and detect statistical anomalies that correspond to boundaries

AutoEgoLab uses the signal-based approach. Here is why.

## Signal 1: Jaccard Distance Between Frame Mask Sets

**Jaccard Index (IoU)** is defined as:
```
J(A, B) = |A ∩ B| / |A ∪ B|
```

For two binary pixel masks, J measures their overlap. A value of 1 means identical masks; 0 means completely disjoint masks.

**Jaccard Distance** = 1 - Jaccard Index. A large Jaccard distance between frame t and frame t+1 means the mask compositions changed significantly — new objects appeared, existing objects moved dramatically, or a completely new scene segment began.

The signal processing pipeline:
1. Extract per-frame mask sets from SAM 2.1
2. Compute pairwise Jaccard Distance for consecutive frames
3. Apply a **5-frame rolling average** to smooth out noise from transient occlusions
4. Detect peaks above threshold 0.15 → boundary candidates

## Signal 2: Contact Transition Events

HaWoR's contact_probability gives a per-frame binary-ish signal: is any hand touching any object?

Critical observation: **action boundaries typically coincide with contact events.** A worker picks up a tool (contact starts), positions it (contact maintained), then puts it down (contact ends). The rising edge (0→1) and falling edge (1→0) of the contact signal naturally demarcate action start and end.

**Hysteresis filtering** (3-frame window) prevents noisy bouncing between 0 and 1 for frames where the hand is near but not touching a surface.

## Fusion and Post-Processing

Union of both signal boundaries gives a combined set of candidates. Short segments (< 1500ms) are merged into their predecessor to prevent fragmenting continuous motions into micro-segments. The result: atomic skill segments with semantically meaningful boundaries.

**Why deterministic beats learned here:** The input signals (SAM masks + HaWoR contact) are already high-quality validated outputs from ML models. A second learned layer on top would add latency, require training data, and introduce compounding error. Deterministic signal processing is perfectly adequate and gives reproducible, auditable results.

---

# 10. Egocentric VLMs — EgoVLM and Action Recognition

## What Is a Vision-Language Model (VLM)?

A VLM is a neural network that jointly models images and text. Modern VLMs typically:
1. Encode images with a Vision Encoder (ViT or CNN)
2. Project image features into the language model's embedding space via a connector (linear projection or cross-attention)
3. Generate text autoregressively from a Language Model backbone

Examples: GPT-4V, LLaVA, Gemini Pro Vision, InternVL.

## The Ego4D Dataset

**Ego4D** is Meta's massive dataset of egocentric video with rich annotations, released in 2022:
- **3,670 hours** of first-person video collected across 9 countries
- 931 daily life scenarios: cooking, construction, gardening, factories
- Annotations: narrations (fine-grained action descriptions), clips, moment queries, freehand annotations

The fine-grained narrations follow a structure: `{verb} {object} [with {tool}] [from/to {target}]`. This is exactly the action label schema used in AutoEgoLab.

## EgoVLM — Domain-Specific Fine-Tuning

**EgoVLM-3B** is a VLM fine-tuned on Ego4D to understand the specific taxonomy of egocentric activities. The 3B parameter size (using models like LLaMA-3-3B or Phi-3 mini as backbones) is chosen for:

- **GPU feasibility:** 3B parameters in bfloat16 requires ~6GB VRAM — fits on a single A10G (24GB)
- **Speed:** Generates structured JSON in < 2s per segment
- **Domain accuracy:** Fine-tuned on Ego4D narrations, it understands factory-specific terminology

The input is 4 representative frames from the skill segment — selected as the cluster medoids from that segment's frame pool — and a structured system prompt specifying the output schema.

## Confidence-Gated Fallback to Gemini

EgoVLM reports a confidence score with each prediction. This is computed from the token probability distribution of the generated text: if the model confidently generates "tighten" with high probability, confidence is high. If it distributes probability mass across "tighten," "rotate," "press" equally, confidence is low.

Below confidence threshold 0.40, the system falls back to Gemini 3.1 Pro with structured output enforcement via `instructor`. This creates a **cost-quality tradeoff**: EgoVLM is cheap and fast; Gemini is expensive but more capable for ambiguous scenes.

---

# 11. Structured Output Extraction — Instructor Library

## The Problem with Raw LLM Outputs

VLMs and LLMs produce free-form text. In a production system, you need **strongly typed, validated data structures** — not arbitrary strings. If EgoVLM outputs "The person is tightening a bolt with their wrench on the bracket," you cannot directly store this in a PostgreSQL `actions` table.

## Instructor: Pydantic-Validated LLM Outputs

The `instructor` Python library wraps any OpenAI-compatible LLM and enforces JSON output matching a **Pydantic schema**:

```python
class ActionRecord(BaseModel):
    action_label: str
    verb: str
    object: str
    tool: Optional[str]
    target: Optional[str]
    confidence: float = Field(ge=0.0, le=1.0)
```

The library:
1. Converts the Pydantic model into a JSON Schema
2. Injects the schema into the LLM's system prompt as output format instructions
3. Parses the LLM's response against the schema
4. If parsing fails, automatically retries with the validation error as additional context (up to N retries)

This turns probabilistic VLM outputs into deterministic, type-safe database records. The validation is critical: a robot training pipeline cannot tolerate malformed data silently passing through.

---

# 12. Task Graph Generation — Causal Reasoning with LLMs

## What Is a Directed Acyclic Graph (DAG)?

A **DAG** is a graph structure where:
- **Nodes** represent entities (actions, subtasks, goals)
- **Directed edges** represent relationships (precedes, enables, is part of)
- **Acyclicity** guarantees that the graph has no circular dependencies (A cannot be a precondition of B if B is a precondition of A)

In task planning, DAGs represent task decomposition hierarchies:
- A **goal** node at the top
- **Subtask** nodes in the middle (logical groupings of related actions)
- **Action** nodes at the leaves (atomic operations)
- Edges encode prerequisite relations: "bracket must be positioned before bolt can be tightened"

## Why a DAG and Not a Simple Sequence?

Real tasks are not always linear. Consider:
- You can tighten bolt A and bolt B in either order (parallel)
- But you must position the bracket before tightening either bolt (prerequisite)

A flat action sequence cannot represent these partial-order constraints. A DAG can. Modern robot planning algorithms (HTN planners, MCTS with task decomposition) consume DAG task structures to efficiently explore execution strategies.

## Gemini 3.1 Pro With Extended Thinking

Task graph generation requires **semantic reasoning**: understanding that "grasp bolt" + "align bolt with hole" + "rotate bolt clockwise" are all semantically part of the "install bolt" subtask, even if they are temporally separated.

Gemini 3.1 Pro with `thinking_budget=4096` enables extended chain-of-thought reasoning. The model can spend up to 4096 thinking tokens reasoning about the causal structure of the action sequence before committing to a DAG structure. This produces significantly better task decomposition than standard greedy generation.

## Fallback: Template Graph

If Gemini fails (API error, JSON parse failure after 3 retries), the pipeline constructs a **deterministic template graph**: a linear chain where action_0 → action_1 → ... → action_n, all connected to a single "Unknown Task" goal node. This degrades gracefully rather than failing the entire job.

---

# 13. VLA Datasets and RLDS Format

## What Is RLDS?

**RLDS (Robot Learning Dataset Specification)** is an open standard for robot learning datasets, developed by Google Brain / DeepMind. It builds on **TensorFlow Datasets (TFDS)** and represents trajectory data as nested tensors in **TFRecord** format.

An RLDS episode contains:
- A sequence of **steps**, each containing:
  - `observation`: image tensor + robot state
  - `action`: motor command or action label
  - `reward`: scalar reward signal (optional for imitation)
  - `is_first / is_last / is_terminal`: episode boundary flags

## Why RLDS Matters

Major robot learning frameworks (OpenX-Embodiment, LeRobot, RT-X) standardise on RLDS as their data format. A dataset in RLDS format can be:
- Combined with other RLDS datasets for multi-task training
- Loaded with standard TFDS data pipelines with automatic batching and shuffling
- Hosted on Hugging Face datasets hub with full metadata

AutoEgoLab outputs `dataset.rlds` by serialising each (observation_frame, action_label) pair as a TFRecord. Each VLA record in the intermediate JSON maps directly to one RLDS step.

---

# 14. LangGraph — Stateful AI Pipelines

## What Is LangGraph?

LangGraph is a framework for building **stateful multi-agent workflows** as directed graphs. It extends LangChain with first-class support for:
- **Typed state:** A TypedDict that flows through the graph and accumulates results from each node
- **Conditional edges:** Routing logic that decides which node to execute next based on current state
- **Fan-out / Fan-in:** Parallel execution of multiple nodes followed by a merge node
- **Checkpointing:** Saving state at each node boundary for resumption

## Comparison With Celery

**Celery** is a distributed task queue. It excels at:
- Simple background job execution
- Horizontal scaling of idempotent tasks
- Scheduling periodic tasks

**Celery does NOT support:**
- Typed state flowing between tasks (you'd have to pass state through Redis manually)
- Graph-based conditional routing (all tasks execute on a flat queue)
- Fan-out/fan-in patterns natively
- Built-in checkpointing

LangGraph is designed specifically for **stateful branching AI pipelines** — exactly what AutoEgoLab needs.

## The PipelineState TypedDict

```python
class PipelineState(TypedDict):
    job_id: str
    trace_id: str
    raw_frame_artifact_ids: List[str]
    clean_frame_artifact_ids: List[str]
    perception_artifact_id: Optional[str]
    segment_ids: List[str]
    action_ids: List[str]
    task_graph_id: Optional[str]
    dataset_manifest_id: Optional[str]
    error: Optional[str]
```

Every agent reads from and writes to this state. The crucial design: **only UUID strings are stored in state, never raw bytes.** This keeps the serialised state under 1KB regardless of video length or number of frames.

## Fan-Out / Fan-In for Perception

LangGraph supports parallel execution by annotating multiple outgoing edges from a single node. The `perception_prepare` node fans out to three parallel branches. LangGraph's runtime schedules all three simultaneously (on separate Modal containers). The `perception_merge` node has an incoming edge from all three branches and executes only when all three have completed.

This is the Graph-based equivalent of `asyncio.gather()` at the infrastructure level.

---

# 15. Supabase CDC and Real-Time Architecture

## What Is Change Data Capture (CDC)?

**CDC** is a software design pattern that captures changes to a database — inserts, updates, deletes — as a stream of events, in real-time. Instead of polling "has the data changed?" every N seconds, a CDC consumer receives an event immediately when a change occurs.

## PostgreSQL WAL

PostgreSQL uses a **Write-Ahead Log (WAL)** — every change to any table is first written to the WAL before being applied to the actual tables. The WAL is an append-only sequence of change records. This architecture guarantees durability (if Postgres crashes, it can replay the WAL to recover) and also enables replication and CDC.

## Supabase Realtime

Supabase Realtime's CDC layer reads the PostgreSQL WAL using **logical replication slots** (PostgreSQL's native mechanism for streaming WAL records to external consumers). When a row in `processing_jobs` is updated (e.g., `status` changes to `SEGMENTATION_AGENT_RUNNING`), Realtime:
1. Receives the WAL event containing the old row values + new row values
2. Checks which WebSocket channels are subscribed to this table with matching row filters (e.g., `id=eq.{jobId}`)
3. Broadcasts the new row payload to all matching subscribers

**The frontend** subscribes on job start:
```js
supabase.channel(`job:${jobId}`)
  .on('postgres_changes', { table: 'processing_jobs', filter: `id=eq.${jobId}` }, handleUpdate)
  .subscribe()
```

This gives zero-latency status updates with no polling overhead.

---

# 16. Vector Embeddings and pgvector Search

## What Is a Vector Embedding?

A vector embedding is a **learned numerical representation** of unstructured data (text, image, audio) in a high-dimensional continuous space. The key property: **semantically similar inputs map to geometrically similar vectors.**

For text: the sentence "tighten the bolt" and "torque the fastener" are semantically similar. A text embedding model maps both to nearby vectors in embedding space, even though they share no words.

## How Semantic Search Works

Given a query like "pick up tool," the semantic search pipeline:
1. Encodes the query into an embedding vector using the same embedding model used to embed the database
2. Computes cosine similarity between the query vector and every stored embedding
3. Returns the top-k most similar stored records

This is fundamentally different from keyword search (which looks for exact word matches) — semantic search finds **conceptually related** actions even if the words are different.

## pgvector

**pgvector** is a PostgreSQL extension that adds a native `vector(N)` datatype and similarity search operators directly within SQL:

```sql
SELECT text_content, action_label
FROM search_embeddings
WHERE job_id = $1
ORDER BY embedding <=> $2  -- cosine distance operator
LIMIT 10;
```

The `<=>` operator is pgvector's cosine distance operator. pgvector creates an **IVFFlat index** (Inverted File Index with Flat quantisation) to speed up approximate nearest-neighbour search by partitioning the vector space into clusters and only searching relevant clusters.

At scale (millions of vectors), HNSW (Hierarchical Navigable Small World) graphs provide faster search with better recall.

---

# 17. Fault Tolerance — Tenacity, Checkpoints, Watchdogs

## Tenacity: Retry Policies

**Tenacity** is a Python library for configuring retry behaviour with fine-grained policies. The AutoEgoLab retry configuration:

```python
@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=2, min=2, max=30),
    retry=retry_if_exception_type((NetworkError, Supabase503, Gemini429, CUDAOOMError)),
    reraise=True
)
def call_model():
    ...
```

**Exponential backoff:** After the first failure, wait 2s. After the second, wait 4s. After the third, wait 8s (capped at 30s). Adding jitter (random small offset) prevents a thundering herd problem where many clients all retry simultaneously.

**Selective retry:** Not all errors should be retried. `ValueError` (bad input data) → don't retry; `httpx.TimeoutError` (transient network blip) → retry.

## CUDA OOM: Batch Size Halving

GPU out-of-memory (OOM) errors occur when model + data exceeds VRAM. Rather than failing outright, the retry wrapper catches `torch.cuda.OutOfMemoryError`, halves the batch size, clears the GPU cache (`torch.cuda.empty_cache()`), and retries. This handles variability in frame counts across different input videos.

## Heartbeat Watchdog Design

The watchdog is a **scheduled Modal function** that runs every 60 seconds independently of the main pipeline. It queries:

```sql
SELECT id FROM processing_jobs
WHERE status NOT IN ('COMPLETED', 'FAILED_*')
AND updated_at < NOW() - INTERVAL '180 seconds'
```

Any job returned by this query is "stuck" — a running agent crashed silently (process killed, Modal instance died, network partition). The watchdog attempts to rebuild the PipelineState from checkpoints and call `execute_pipeline.spawn()` again from the failed stage.

## Checkpoint-Based Recovery

Each agent, before updating its `agent_runs` status, writes checkpoint metadata to `processing_jobs.failure_details.checkpoints`:

```json
{
  "checkpoints": {
    "video_agent": {"artifact_ids": ["uuid1", "uuid2"]},
    "quality_agent": {"artifact_ids": ["uuid3", "uuid4"]},
    "perception_agent": null
  }
}
```

`build_resume_state()` reads completed checkpoints and reconstructs a PipelineState, which is passed to the graph starting from the first node that has no checkpoint.

---

# 18. GPU Architecture — Why T4 vs A10G

## NVIDIA T4 (Turing Architecture, 2018)

- **VRAM:** 16GB GDDR6
- **TF32 TFLOPS:** 65
- **FP16 TFLOPS:** 130
- **Target:** Inference workloads — balanced cost-per-token
- **Best for:** Models that fit in 16GB, medium throughput requirements

**Used for:** DINOv2 (350MB), YOLOE (200MB), SAM 2.1 Hiera Large (2.4GB). All fit comfortably within 16GB VRAM.

## NVIDIA A10G (Ampere Architecture, 2021)

- **VRAM:** 24GB GDDR6
- **TF32 TFLOPS:** 125
- **FP16 TFLOPS:** 250 (tensor cores)
- **Target:** Large model inference, moderate training
- **Best for:** Models requiring >16GB VRAM, or needing faster FP16 throughput

**Used for:** HaWoR (~1.5GB weights + large intermediate activations from temporal attention over many frames) and EgoVLM-3B (~6GB in bfloat16 + KV cache for long contexts).

## Why bfloat16?

**bfloat16** (Brain Float 16) is a 16-bit floating point format introduced by Google. It uses:
- 1 bit sign
- 8 bits exponent (same as float32)
- 7 bits mantissa

The key property: bfloat16 has the **same dynamic range as float32** (because the exponent width is the same). Standard FP16 has a smaller dynamic range, causing NaN/infinity issues during model inference with large activations. bfloat16 avoids this without the memory cost of full float32.

All large models in AutoEgoLab are loaded in bfloat16 to halve memory consumption from float32 while maintaining numerical stability.

---

# 19. Modal.com — Serverless GPU Computing

## The Cold Start Problem

Traditional containerised ML serving (Docker + Kubernetes) has a severe cold start problem:
1. Pod scheduled on a node: ~5s
2. Container image pulled from registry: ~30–120s depending on image size (GPU model images can be 10–20GB)
3. Model weights loaded into GPU VRAM: 10–60s for large models

Total coldstart: **1–3 minutes** before the first request is served. This is unacceptable for an interactive pipeline.

## Modal's Solution: Image Baking

Modal serialises Python environments and model weights **at build time into snapshots stored on Modal's infrastructure.** When a container is requested:
- The environment snapshot is restored (not pulled from a registry)
- GPU driver is attached
- Model weights are pre-loaded from Modal's high-speed storage

Result: **< 3 second warm container start.** The model is already in CPU memory; it's moved to GPU VRAM in seconds.

## Serverless GPU Economics

Traditional GPU allocation: reserve an NVIDIA A10G for $3.50/hour. If your job takes 30 seconds and you have 1 job per hour, you're paying for 3600 seconds of GPU but using 30 seconds — 99.2% waste.

Modal bills **per second of actual GPU usage**. For a pipeline with p50 GPU time of ~90s across all stages, the effective GPU cost per job is:
```
90s × ($0.00138/s for T4) + 60s × ($0.00231/s for A10G)
= $0.124 + $0.139
≈ $0.26 per video processed
```

This is dramatically cheaper than reserved infrastructure at any scale below constant saturation.

## @app.function Decorator — Python-Native GPU Specification

```python
@app.function(
    gpu="T4",
    memory=12288,
    timeout=120,
    image=video_agent_image
)
def run_video_agent(job_id: str) -> dict:
    ...
```

GPU requirements are expressed as Python decorators, not YAML manifests. Modal handles scheduling, container lifecycle, secret injection, and monitoring transparently.

---

# 20. Security — JWT, HMAC, RLS, Signed URLs

## HMAC-SHA256 for Job Tokens

**HMAC (Hash-based Message Authentication Code)** is a mechanism that uses a cryptographic hash function combined with a secret key to produce an authentication tag:

```
HMAC-SHA256(key, message) = SHA256(key XOR opad || SHA256(key XOR ipad || message))
```

In AutoEgoLab, when a job is created, the API mints an HMAC-SHA256 signed token:
- **Message:** `{job_id}:{timestamp_unix}:{user_id_hash}`
- **Key:** `HMAC_SECRET` environment variable (stored in Vercel secrets)

The token is returned to the browser and must be included in the `Authorization: Bearer {token}` header for all subsequent API calls for that job. The API validates the HMAC signature server-side — no database lookup required for validation.

**Why HMAC and not JWT?** JWTs embed claims in the token payload, requiring the receiver to decode and inspect them. HMAC tags are opaque — less surface area for token forgery or information leakage. For a simple job-scoped access control, HMAC is simpler and purpose-fit.

## Supabase Storage Signed URLs

Supabase Storage signed URLs use JWTs under the hood. The URL contains:
- The storage path (bucket + object key)
- An expiry timestamp
- A signature computed with the Storage service's JWT secret

The URL can be distributed without authentication — whoever has the URL can access the resource, but only until expiry. This is the standard pattern for:
- Short-lived upload permissions (15-minute TTL)
- Long-lived download links for completed datasets (24h TTL)

## Row Level Security (RLS)

PostgreSQL RLS allows defining access policies at the table level. Supabase tables have RLS enabled by default. AutoEgoLab uses a "deny all" policy for anon and authenticated roles:

```sql
CREATE POLICY "deny_all_anon" ON processing_jobs
  FOR ALL TO anon USING (false);
```

All database access goes through the `service_role` key (a privileged key never exposed to the browser). This means even if the Supabase project URL is guessed, no data can be read — every query without the service_role key is rejected at the database level.

## The Rate Limiter — Upstash Redis

The API gateway uses **Upstash Redis** (a serverless Redis with HTTP API, no persistent connection required) for rate limiting via sliding window counters:

```
Key: rate:{ip_address}:{endpoint}
Value: request count in the last 60s (via sorted set + TTL)
Limit: 10 requests / 60s for /api/process
```

Exceeding the limit returns `429 Too Many Requests`. This prevents GPU cost abuse from malicious or accidental request floods.

---

# Summary: Key Theoretical Decisions

| Decision | Chosen Approach | Theoretical Justification |
|---|---|---|
| Frame embeddings | DINOv2 (self-supervised ViT) | Self-supervised removes classification bias; ViT captures global structure |
| Clustering | K-Medoids (cosine distance) | Medoids are real frames; cosine metric appropriate for high-dim embeddings |
| Video segmentation | SAM 2.1 with memory bank | Memory bank gives temporal consistency across occlusions |
| Hand reconstruction | HaWoR + MANO parametric model | MANO gives 3D robot-actionable joint parameters; trained for egocentric views |
| Boundary detection | Jaccard Distance + Contact signal | Validated perception signals → deterministic math sufficient |
| Action labelling | EgoVLM-3B (Ego4D fine-tuned) | Domain-specific fine-tuning outperforms general VLMs for factory taxonomy |
| Task structure | Gemini + DAG | Causal reasoning requires semantic understanding; DAG encodes partial orders |
| State management | UUID references only in state | Prevents memory explosion in LangGraph serialisation |
| Database updates | CDC (Supabase Realtime) | Zero-latency push without polling; Postgres WAL provides reliable event source |
| Retries | Tenacity exponential backoff | Industry standard for transient error handling in distributed systems |
| GPU selection | T4 for fit/speed; A10G for size/throughput | Cost-optimal GPU allocation based on model VRAM requirements |

---

> *This document covers every major theoretical concept underlying AutoEgoLab. Each section is a standalone explanation — read in order for full depth, or jump to any section by topic.*
