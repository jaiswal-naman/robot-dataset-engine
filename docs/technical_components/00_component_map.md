# AutoEgoLab v3.0 — Technical Documentation Index
**Last updated:** 2026-03-16 | **Revision:** 2.0

---

## Quick Navigation

| # | Document | Primary Topics | Size |
|---|---|---|---|
| 01 | [System Overview](01_system_overview.md) | Vision, why it exists, component responsibilities, data flow, scalability | 12KB |
| 02 | [Requirements & SLOs](02_requirements_and_slos.md) | Functional + non-functional requirements, latency/throughput SLOs | 3KB |
| 03 | [Core Architecture](03_core_architecture.md) | 6-layer system breakdown, request flow, technology interaction matrix | 3KB |
| 04 | [End-to-End Flow](04_end_to_end_flow.md) | Job FSM, 8-step lifecycle with code, realtime contract, state recovery | 18KB |
| 05 | [AI Pipeline Architecture](05_ai_pipeline.md) | Agent DAG, parallel perception branches, data contracts, checkpointing | 13KB |
| 06 | [Agent Specifications](06_agent_specifications.md) | Full implementation code for all 7 agents with models, runtime, failure modes | 42KB |
| 07 | [LangGraph Orchestration](07_langgraph_orchestration.md) | Graph assembly, PipelineState schema, retry logic, watchdog, timing | 20KB |
| 08 | [Database Architecture](08_database_architecture.md) | Full SQL schema with pgvector, RLS policies, indexes, migration order | 13KB |
| 09 | [Storage Architecture](09_storage_architecture.md) | Bucket taxonomy, naming conventions, lifecycle, GC logic | 2KB |
| 10 | [API Architecture](10_api_architecture.md) | 5 API endpoints, request/response contracts, error envelopes, auth | 4KB |
| 11 | [Frontend Architecture](11_frontend_architecture.md) | All components, Zustand store, Realtime hook, status-to-UI mapping | 23KB |
| 12 | [Infrastructure & Deployment](12_infrastructure_deployment.md) | Vercel, Modal, Supabase, CI/CD, env vars matrix | 4KB |
| 13 | [Observability](13_observability.md) | LangSmith tracing, logging contract, metrics, alerts | 2KB |
| 14 | [Performance & Capacity](14_performance_capacity.md) | Stage-by-stage runtime estimates, GPU requirements, bottlenecks | 2KB |
| 15 | [Failure Handling](15_failure_handling.md) | Retry policy, error taxonomy, degraded mode, recovery flows | 2KB |
| 16 | [Security](16_security.md) | Job-scoped tokens, file validation, RLS, rate limiting | 2KB |
| 17 | [Implementation Phases](17_implementation_phases.md) | 5-phase plan with exact commands, file paths, validation tests | 31KB |
| 18 | [Repository Structure](18_repository_structure.md) | Every file mapped with purpose, key contents, package.json | 21KB |
| 19 | [Future Extensions](19_future_extensions.md) | Multi-camera, robot policy integration, fleet ingestion, active learning | 3KB |

---

## Architecture Decision Index

| Decision | Documented In |
|---|---|
| Why multi-agent instead of monolithic VLM | 01 § 1.4 + 05 § 5.1 |
| Why LangGraph instead of Celery/Airflow | 07 § 7.1 |
| Why Perception has internal parallelism | 05 § 5.4 |
| Why agents pass artifact IDs, not raw bytes | 05 § 5.3 |
| Why Modal instead of AWS Lambda | 12 (GPU warm-start semantics) |
| Why Supabase Realtime instead of polling | 04 § 4.2 Step 7 + 11 § 11.9 |
| Why Gemini for Task Graph but EgoVLM for actions | 06 § 6.6 + 06 § 6.7 |
| Why k-medoids for keyframe selection | 06 § 6.2 |

---

## Build Order (Use with Implementation Phases)

Follow this order when building. Never skip ahead — each layer depends on the previous.

1. **Supabase** (08, 09) — schema and buckets first
2. **API Layer** (10) — backend API routes  
3. **Modal Pipeline Skeleton** (07) — mock agents
4. **Realtime Integration** (04, 11) — status updates to UI
5. **Real Agent Implementation** (05, 06) — replace mocks
6. **Frontend UI** (11) — components, store, results display
7. **Infrastructure** (12) — CI/CD, production secrets, monitoring

---
