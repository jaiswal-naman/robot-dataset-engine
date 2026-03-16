# AutoEgoLab v3.0: 3. Core System Architecture

## Components
1. **Frontend Layer**: Next.js 15 (App Router) deployed on Vercel. Handles user sessions, video uploads to Supabase, UI state, and server-sent real-time updates.
2. **Backend Orchestration Layer**: Next.js API Routes acting as the gateway, dispatching webhooks to Modal.
3. **AI Compute Layer**: Modal.com powering a LangGraph 0.3 execution graph. Different agents are mapped to specific GPU classes (T4s for classical vision, A10Gs for large VLMs).
4. **Data Storage Layer**: Supabase PostgreSQL 16. Uses `pgvector` for semantic skill search and Supabase Storage for storing blobs (MP4s, frames).
5. **Real-time Event System**: Supabase Realtime (Postgres CDC + Websockets) to track row-level changes in the `processing_jobs` table, pushed to the Next.js client.
6. **API Gateway**: Vercel acts as the rate-limiter and request authenticator before invoking Modal workloads.

## Tech Interaction & Flow Request
- **Next.js** authenticates and uploads the file directly to **Supabase Storage** via a signed URL.
- **Next.js** inserts a row into the `processing_jobs` table in **Supabase** via Prisma/Supabase JS.
- **Next.js** calls a **Modal** Webhook HTTP endpoint, passing the `job_id` and file path.
- **Modal** spins up a **LangGraph** orchestrator.
- **LangGraph** routes tasks to 7 distinct Agents (Modal functions), occasionally polling **Gemini API** for reasoning.
- After each agent completes, **LangGraph** updates the `processing_jobs` table in **Supabase**, triggering a **Supabase Realtime** broadcast back to the **Next.js** frontend.
