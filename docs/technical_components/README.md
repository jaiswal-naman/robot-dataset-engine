# AutoEgoLab v3.0 — Engineering Documentation Hub
**Status:** Build-Ready | **Version:** 3.0 | **Last Updated:** 2026-03-16

---

## What Is This?

This directory is the **single source of truth** for building AutoEgoLab v3.0 — an autonomous multi-agent AI pipeline that converts egocentric factory video into structured VLA robot training datasets.

Every document in this directory is written to be **engineer-ready**: concrete, implementation-specific, with actual code and exact file paths. No vague explanations.

---

## Document Index

| # | Document | What You Get |
|---|---|---|
| [00](00_component_map.md) | **Component Map** | Full index with decision lookup and build order |
| [01](01_system_overview.md) | **System Overview** | Vision, problem statement, component responsibilities, data flow |
| [02](02_requirements_and_slos.md) | **Requirements & SLOs** | FR/NFR specs, performance SLOs, config `PipelineConfig` class |
| [03](03_core_architecture.md) | **Core Architecture** | 6-layer system, trust boundaries, request flow, tech decision matrix |
| [04](04_end_to_end_flow.md) | **End-to-End Flow** | Job FSM, lifecycle code, realtime contract, recovery paths |
| [05](05_ai_pipeline.md) | **AI Pipeline** | Multi-agent DAG, parallel perception, data contracts |
| [06](06_agent_specifications.md) | **Agent Specifications** | Complete code for all 7 agents with models, VRAM, failure recovery |
| [07](07_langgraph_orchestration.md) | **LangGraph Orchestration** | Graph assembly, PipelineState schema, retry wrapper, watchdog |
| [08](08_database_architecture.md) | **Database Architecture** | Full SQL schema, pgvector, RLS policies, migration order |
| [09](09_storage_architecture.md) | **Storage Architecture** | Buckets, key naming, artifact table, upload/download code, GC |
| [10](10_api_architecture.md) | **API Architecture** | All 5 endpoints with full TypeScript implementations |
| [11](11_frontend_architecture.md) | **Frontend Architecture** | All components, Zustand store, Realtime hook, UI-status map |
| [12](12_infrastructure_deployment.md) | **Infrastructure & Deployment** | Vercel/Modal/Supabase configs, CI/CD YAML, env matrix |
| [13](13_observability.md) | **Observability** | LangSmith tracing, log contract, SQL metrics, debugging runbook |
| [14](14_performance_capacity.md) | **Performance & Capacity** | Stage runtimes, GPU VRAM budgets, bottleneck analysis |
| [15](15_failure_handling.md) | **Failure Handling** | Failure taxonomy, retry code, watchdog, write-order protocol |
| [16](16_security.md) | **Security** | Token protocol, file validation, RLS, rate limiting, secret rotation |
| [17](17_implementation_phases.md) | **Implementation Phases** | 5-phase build plan with commands, file paths, validation tests |
| [18](18_repository_structure.md) | **Repository Structure** | Every file mapped + package.json + requirements.txt |
| [19](19_future_extensions.md) | **Future Extensions** | Multi-cam, HITL, batch mode + launch checklist |

---

## Where to Start

**First time on this project?** Read in this order:
1. `01_system_overview.md` — understand what we're building and why
2. `03_core_architecture.md` — understand the 6 layers and how they talk
3. `04_end_to_end_flow.md` — trace a single video from upload to results
4. `17_implementation_phases.md` — find your phase and follow its tasks

**Starting to build Phase 1?** You need:
- `08_database_architecture.md` — SQL migrations
- `09_storage_architecture.md` — bucket setup
- `12_infrastructure_deployment.md` — Supabase + Modal + Vercel config

**Working on an agent?** You need:
- `06_agent_specifications.md` — your specific agent section
- `05_ai_pipeline.md` — data contracts in/out
- `07_langgraph_orchestration.md` — how your node fits into the graph

**Debugging a failure?** Go to:
- `13_observability.md` — debugging runbook starting at §13.6
- `15_failure_handling.md` — failure taxonomy and error codes

---

## Key Realities

> **Supabase Storage is the only inter-agent communication.**  
> Agents never pass bytes through LangGraph state. State carries `{artifact_id: UUID}` references.

> **Every status write is a Realtime event.**  
> Supabase Realtime broadcasts every `processing_jobs` UPDATE to the subscribed browser channel.

> **Modal webhook returns 200 immediately.**  
> The pipeline runs asynchronously. The webhook response just confirms it started.

> **Job tokens are HMAC-hashed in the DB.**  
> The raw token is never stored. If the DB is compromised, no tokens are valid.

---
