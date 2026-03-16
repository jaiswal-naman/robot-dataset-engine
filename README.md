# 🤖 The Robot Training Data Problem No One Talks About

> *You've raised $5M. Your demo works beautifully. And then someone asks: "How are you getting your training data?"*

That's the moment every robotics founder realizes they've just signed up for months of manual annotation, expensive teleoperation sessions, and dataset sizes that would make even well-funded startups wince.

**You're not alone. This is the hidden bottleneck choking the entire robotics industry.**

---

# robot-dataset-engine

<p align="center">
  <strong>Turn raw factory video into production-ready VLA datasets in under 5 minutes.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Version-3.0-blue?style=flat-square" alt="Version">
  <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="License">
  <img src="https://img.shields.io/badge/Stack-Next.js_15%20%7C%20LangGraph%20%7C%20Modal%20%7C%20Supabase-orange?style=flat-square" alt="Tech Stack">
  <img src="https://img.shields.io/badge/Processing_Time-%3C5_minutes-success?style=flat-square" alt="Speed">
</p>

---

## The Pain Is Real

If you're building robots that learn from demonstration, you've lived this:

| Method | Cost | Time | Limitations |
|--------|------|------|-------------|
| **Human Teleoperation** | $150-300/hour | 30-60 min/task | Slow, hardware-dependent, physically exhausting |
| **Kinesthetic Teaching** | High hardware cost | 30-60 min/task | Fails on complex dexterous tasks |
| **Manual Annotation** | $10-30/frame | Weeks | Subjective, doesn't scale, soul-crushing |

*Source: Industry surveys, Multiple robotics startups (2023-2024)*

**The math doesn't work.** General-purpose robots need millions of demonstrations. At $20/frame, that's... let me calculate...

Yeah, it doesn't work. That's why **zero-shot learning** and **foundation models** have been the holy grail. But they need *quality training data* to fine-tune on your specific tasks.

---

## What If I Told You...

> **There's a fourth way no one mentioned.**

You already have hours of factory footage. Workers performing tasks. Demonstrations happening *right now* that you're not capturing.

**What if you could convert that existing video into structured, robot-trainable data—automatically?**

That's what robot-dataset-engine does.

---

## What This Actually Means For You

### Before robot-dataset-engine
- 📹 Hours of raw video sitting on hard drives
- 👨‍🔧 Workers performing tasks that get forgotten
- 💰 $150-300/hour for teleoperation
- ⏰ Weeks of manual annotation work
- 📊 Datasets with 50-200 examples (if you're lucky)

### After robot-dataset-engine
- 📹 Upload video → Get dataset
- ⚡ **2-5 minutes** processing time
- 💵 **$0.26** GPU cost per video (serverless)
- 📊 VLA dataset with skill segments, action labels, object masks, hand poses
- 🎯 RLDS format ready for OpenVLA, RT-X, π0 training

---

## How It Works

```
Raw Video (egocentric, factory)
         │
         ▼
    ┌─────────────────────────────────────────────┐
    │     7-Agent AI Pipeline (LangGraph)          │
    │                                              │
    │   1. Video Agent      → Keyframe selection   │
    │   2. Quality Agent    → Blur/exposure filter │
    │   3. Perception      → Objects + masks +     │
    │                         3D hand meshes       │
    │   4. Segmentation    → Skill boundaries     │
    │   5. Action Agent    → "pick up", "tighten"  │
    │   6. Task Graph     → Causal dependencies   │
    │   7. Dataset Builder→ RLDS export           │
    └─────────────────────────────────────────────┘
         │
         ▼
Output: VLA Dataset (JSON + TFRecord)
        ├── Skill segments with timestamps
        ├── Structured {verb, object, tool, target}
        ├── Pixel-precise object masks (SAM 2.1)
        ├── 3D hand meshes (MANO model)
        └── Hierarchical task DAG
```

---

## Why This Changes The Game

| Dimension | Traditional | robot-dataset-engine |
|-----------|-------------|---------------------|
| **Annotation** | Manual / VLM hallucination | 7-agent automated pipeline |
| **Object Tracking** | 2D bounding boxes | Pixel-level masks with temporal consistency |
| **Hand Pose** | None / 2D keypoints | Full 3D mesh via MANO parametric model |
| **Action Labels** | Free-text output | Structured `{verb, object, tool, target}` |
| **Task Structure** | Flat list | Hierarchical DAG with causal edges |
| **Speed** | Hours/Days | **~2-5 minutes** |
| **Cost** | $150-300/hr human | **$0.26/video** (serverless GPU) |
| **Scalability** | Linear with humans | Serverless auto-scaling |

---

## Who Is This For?

### 🤖 Robotics Startups
- Building manipulation robots? You need demonstration data.
- Raised a round? This saves you $500K-2M in annotation costs.
- Competing with well-funded incumbents? Now you can scale data faster.

### 🏭 Industrial Automation
- Have existing worker footage? Convert it to training data.
- Deploying new robot cells? Generate datasets in minutes.
- Need to retrain for new products? Just upload new video.

### 🔬 Research Labs
- Ego4D, EPIC-KITCHENS, H2O datasets need structure.
- Publish datasets in RLDS format—immediately usable by others.
- Focus on algorithms, not annotation drudgery.

---

## The Founder's ROI Calculator

Let's say you're building a general-purpose manipulation robot:

| Cost Factor | Traditional | robot-dataset-engine |
|-------------|-------------|----------------------|
| **1,000 demonstrations** | $45,000-90,000 (teleop) | ~$260 + your time |
| **Annotation team** | $200K/year (3 FTEs) | $0 |
| **Dataset iteration** | 2-3 weeks/iteration | Hours |
| **Scale to 10K demos** | $450K-900K | ~$2,600 |

**That's not a typo.** That's the difference between "we need more funding for data collection" and "we have 10x more data than our competitors."

---

## Technical Deep Dive (For Your Engineers)

### Architecture

```
┌──────────┐     ┌──────────────┐     ┌─────────────┐     ┌──────────────┐
│  Browser │────▶│  Next.js API │────▶│   Modal.com │────▶│  Supabase    │
│   (UI)   │     │  (Vercel)    │     │ (GPU Compute)│     │ (DB + Storage)│
└────┬─────┘     └──────┬───────┘     └──────┬──────┘     └──────┬───────┘
     │                  │                    │                   │
     │           ┌──────▼───────┐     ┌──────▼──────┐    ┌──────▼───────┐
     │           │  Upload      │     │ LangGraph    │    │   PostgreSQL │
     │           │  Trigger     │     │ Pipeline     │    │   + pgvector │
     │           └──────────────┘     │ (7 Agents)   │    └──────────────┘
     │                                └─────────────┘
     │                                        │
     │                          ┌────────────▼────────────┐
     │                          │   External Services     │
     │                          │  Gemini 3.1 | LangSmith │
     │                          │  DINOv2 | SAM 2.1 | HaWoR│
     │                          └─────────────────────────┘
```

### The 7 Agents

| # | Agent | Model | Runtime | Output |
|---|-------|-------|---------|--------|
| 1 | **Video Agent** | DINOv2 ViT-B/14 | 12s | 30-150 keyframes |
| 2 | **Quality Agent** | OpenCV (CPU) | 4s | Clean frames |
| 3 | **Perception** | YOLOE + SAM 2.1 + HaWoR | 40s | Objects + masks + 3D hands |
| 4 | **Segmentation** | Signal processing | 8s | Skill boundaries |
| 5 | **Action Agent** | EgoVLM-3B / Gemini | 28s | Action labels |
| 6 | **Task Graph** | Gemini 3.1 Pro | 18s | Hierarchical DAG |
| 7 | **Dataset Builder** | Pydantic + TFRecord | 4s | RLDS export |

### Why These Models?

- **DINOv2**: Self-supervised ViT—learns structural semantics without classification bias
- **SAM 2.1**: Memory bank mechanism tracks objects through occlusions
- **HaWoR**: Egocentric-specific 3D hand mesh (MANO model) — not MediaPipe
- **EgoVLM-3B**: Fine-tuned on Ego4D for factory-specific action taxonomy
- **LangGraph**: Typed state, fan-out/fan-in, checkpointing—built for AI pipelines

---

## Quick Start

```bash
# Clone
git clone https://github.com/jaiswal-naman/robot-dataset-engine.git
cd robot-dataset-engine

# Install
npm install

# Set environment
cp .env.example .env.local
# Fill in: SUPABASE_URL, SUPABASE_ANON_KEY, MODAL_WEBHOOK_SECRET, GEMINI_API_KEY

# Run
npm run dev
```

### Deployment

```bash
# Frontend → Vercel
vercel deploy

# AI Pipeline → Modal
cd modal_backend
modal deploy app.py
```

---

## The Story Behind This

I built this because I watched brilliant robotics teams spend *months* on data collection instead of building their actual product.

The insight: **Everyone has video. No one has data.**

Workers are already performing tasks. Cameras are already recording. The missing piece is the conversion pipeline—and that's exactly what this is.

If you're a founder building robots, your competitive advantage should be your **model architecture**, your **deployment infrastructure**, your **product-market fit**—not your ability to annotate frames manually.

**Let the machines build the data. You build the future.**

---

## Roadmap

- [ ] Multi-camera support
- [ ] Robot policy integration (ALOHA, RT-X)
- [ ] Fleet ingestion for batch processing
- [ ] Active learning for quality improvement
- [ ] HuggingFace dataset hub integration

---

## License

MIT — Use it, build on it, make something great.

---

## Let's Connect

- 🐦 Twitter: [@namanjaiswal](https://twitter.com/namanjaiswal)
- 💼 LinkedIn: [Naman Jaiswal](https://linkedin.com/in/naman-jaiswal)
- 📧 Email: [naman@autoegolab.com](mailto:naman@autoegolab.com)

*Built with Next.js, LangGraph, Modal, and Supabase.*
