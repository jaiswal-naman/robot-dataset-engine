# AutoEgoLab v3.0 — Frontend Architecture
**Document owner:** AI Systems Engineering  
**Revision:** 2.0 | **Date:** 2026-03-16 | **Status:** Build-Ready

---

## 11.1 Technology Stack

| Technology | Version | Purpose |
|---|---|---|
| Next.js | 15 (App Router) | Framework — server/client components, API routes, routing |
| TypeScript | 5.x | Type safety across all frontend code |
| Zustand | 4.x | Client state management (session, job status, results) |
| React Query | 5.x | Server state — fetch, cache, background refetch |
| Supabase JS | 2.x | Realtime subscriptions, browser-side auth |
| React Flow | 11.x | Interactive task graph visualization |
| react-dropzone | 14.x | Video file drag-and-drop upload zone |
| Framer Motion | 11.x | Micro-animations (step transitions, skeleton loaders) |
| Dagre | 1.x | Automatic graph layout for task graph |
| Zod | 3.x | Client-side form and API response validation |

**Fonts:** `Inter` (body text), `JetBrains Mono` (code/JSON viewer) — both from Google Fonts.  
**Color palette:** Dark mode primary. Background: `#0f0f13`. Surface: `#1a1a22`. Accent: `#6366f1` (indigo). Success: `#10b981`. Error: `#ef4444`.

---

## 11.2 Route Map

```
/                         → Landing page (static, fast)
/demo                     → New demo session (upload + process + results)
/demo/[jobId]             → Resumable job view (token-gated)
/library                  → Skill library (semantic search across all jobs)
/coverage                 → Analytics dashboard (extraction coverage stats)
```

**Route types:**
- `/` — Server Component (SSG) — renders static landing page, no auth needed
- `/demo` — Client Component — manages upload state, Realtime subscription
- `/demo/[jobId]` — Client Component — reads jobId from params, restores session from localStorage
- `/library` — Client Component — search + paginated results
- `/coverage` — Server Component with client islands — fetches aggregated stats server-side

---

## 11.3 Page Structure: Landing Page (`app/page.tsx`)

```
app/page.tsx
└── layout sections (all server-rendered):
    ├── <NavBar />           — Logo + "Try Demo" CTA button
    ├── <HeroSection />      — Headline + animated diagram + primary CTA
    ├── <HowItWorksSection />  — 3-column step cards
    ├── <AgentsSection />    — 7 agent cards (icon + name + model + runtime)
    ├── <SampleOutputSection />  — Static screenshot of results UI
    ├── <TechStackSection />     — Model/infra logos
    └── <FooterSection />         — Links
```

**HeroSection design:**
```tsx
// components/landing/HeroSection.tsx
export function HeroSection() {
  return (
    <section className="relative flex flex-col items-center justify-center min-h-screen overflow-hidden">
      {/* Animated background gradient */}
      <div className="absolute inset-0 bg-gradient-radial from-indigo-900/20 via-transparent to-transparent" />
      
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
        className="z-10 text-center max-w-4xl px-6"
      >
        <span className="text-indigo-400 text-sm font-mono tracking-widest uppercase mb-4 block">
          Autonomous Robotics Data Pipeline
        </span>
        <h1 className="text-5xl md:text-7xl font-bold text-white leading-tight mb-6">
          Factory Video →
          <span className="text-indigo-400"> Robot Training Data</span>
        </h1>
        <p className="text-zinc-400 text-xl mb-10 max-w-2xl mx-auto">
          7 specialized AI agents process egocentric video into 
          structured VLA datasets. Zero annotation. 5 minutes.
        </p>
        <a href="/demo" className="btn-primary text-lg px-8 py-4">
          Try Live Demo →
        </a>
      </motion.div>
    </section>
  );
}
```

---

## 11.4 Page Structure: Demo Page (`app/demo/page.tsx`)

This is the most complex page. It manages 4 distinct phases: idle (upload), uploading, processing, and completed.

```tsx
// app/demo/page.tsx
'use client';

import { useStore } from '@/lib/store';
import { UploadZone } from '@/components/demo/UploadZone';
import { UploadProgressBar } from '@/components/demo/UploadProgressBar';
import { PipelineTracker } from '@/components/demo/PipelineTracker';
import { ResultsTabs } from '@/components/demo/ResultsTabs';
import { ErrorBanner } from '@/components/demo/ErrorBanner';
import { useJobRealtime } from '@/lib/realtime/useJobRealtime';

type Phase = 'idle' | 'uploading' | 'processing' | 'completed' | 'failed';

export default function DemoPage() {
  const { session, job } = useStore();
  
  // Subscribe to Realtime when we have a jobId
  useJobRealtime(session.jobId);
  
  const phase: Phase = (() => {
    if (!session.jobId) return 'idle';
    if (session.isUploading) return 'uploading';
    if (!job.status) return 'processing';
    if (job.status === 'COMPLETED') return 'completed';
    if (job.status?.startsWith('FAILED_')) return 'failed';
    return 'processing';
  })();
  
  return (
    <main className="min-h-screen bg-[#0f0f13] text-white">
      <div className="max-w-4xl mx-auto px-6 py-16">
        <h1 className="text-3xl font-bold mb-2">AutoEgoLab Demo</h1>
        <p className="text-zinc-400 mb-12">Upload a factory egocentric video. Watch the AI work.</p>
        
        {phase === 'idle' && <UploadZone />}
        {phase === 'uploading' && <UploadProgressBar />}
        {(phase === 'processing' || phase === 'completed' || phase === 'failed') && (
          <>
            <PipelineTracker />
            {phase === 'failed' && <ErrorBanner />}
            {phase === 'completed' && <ResultsTabs />}
          </>
        )}
      </div>
    </main>
  );
}
```

---

## 11.5 UploadZone Component

```tsx
// components/demo/UploadZone.tsx
'use client';

import { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { useStore } from '@/lib/store';
import { uploadVideo } from '@/lib/api/upload';

export function UploadZone() {
  const { setSession, setIsUploading, setUploadProgress, setJobId, setJobToken } = useStore();

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;
    
    // Client-side validation
    if (file.size > 300 * 1024 * 1024) {
      alert('File too large. Maximum 300MB.');
      return;
    }
    
    setIsUploading(true);
    
    try {
      // Step 1: Create job + get signed URL
      const sha256 = await computeFileSha256(file);
      const initResponse = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_name: file.name,
          file_size_bytes: file.size,
          mime_type: file.type,
          sha256,
        }),
      });
      const { job_id, job_access_token, upload } = await initResponse.json();
      
      // Store token in localStorage for session recovery
      localStorage.setItem(`ael_token_${job_id}`, job_access_token);
      setJobId(job_id);
      setJobToken(job_access_token);
      
      // Step 2: Upload directly to Supabase Storage
      await uploadVideoXHR(upload.signed_url, file, (pct) => setUploadProgress(pct));
      
      // Step 3: Trigger pipeline
      await fetch('/api/process', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${job_access_token}`,
        },
        body: JSON.stringify({ job_id, upload_complete: true }),
      });
      
      setIsUploading(false);
    } catch (err) {
      setIsUploading(false);
      console.error('Upload failed:', err);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'video/mp4': ['.mp4'] },
    maxFiles: 1,
    multiple: false,
  });

  return (
    <div
      {...getRootProps()}
      className={`
        border-2 border-dashed rounded-2xl p-16 text-center cursor-pointer
        transition-all duration-300
        ${isDragActive
          ? 'border-indigo-400 bg-indigo-500/10'
          : 'border-zinc-700 hover:border-zinc-500 hover:bg-white/[0.02]'
        }
      `}
    >
      <input {...getInputProps()} />
      <div className="text-6xl mb-4">🎬</div>
      <p className="text-xl font-medium text-white mb-2">
        {isDragActive ? 'Drop your video here' : 'Drag & drop your factory video'}
      </p>
      <p className="text-zinc-500 text-sm">MP4 format • Up to 5 minutes • Max 300MB</p>
    </div>
  );
}
```

---

## 11.6 PipelineTracker Component

```tsx
// components/demo/PipelineTracker.tsx
'use client';

import { useStore } from '@/lib/store';
import { motion, AnimatePresence } from 'framer-motion';
import { useElapsedTimer } from '@/lib/hooks/useElapsedTimer';

const PIPELINE_STEPS = [
  { key: 'VIDEO_AGENT',        label: 'Keyframe Extraction',  icon: '🎬', runningStatus: 'VIDEO_AGENT_RUNNING',        model: 'DINOv2-base',     expectedSecs: 12 },
  { key: 'QUALITY_AGENT',      label: 'Quality Filtering',    icon: '✨', runningStatus: 'QUALITY_AGENT_RUNNING',      model: 'OpenCV',          expectedSecs: 4  },
  { key: 'PERCEPTION_AGENT',   label: 'Visual Perception',    icon: '👁️', runningStatus: 'PERCEPTION_AGENT_RUNNING',  model: 'YOLOE + SAM + HaWoR', expectedSecs: 75 },
  { key: 'SEGMENTATION_AGENT', label: 'Skill Segmentation',   icon: '✂️', runningStatus: 'SEGMENTATION_AGENT_RUNNING', model: 'Signal Processing', expectedSecs: 8 },
  { key: 'ACTION_AGENT',       label: 'Action Labeling',      icon: '🏷️', runningStatus: 'ACTION_AGENT_RUNNING',      model: 'EgoVLM-3B',       expectedSecs: 28 },
  { key: 'TASK_GRAPH_AGENT',   label: 'Task Graph Synthesis', icon: '🗺️', runningStatus: 'TASK_GRAPH_AGENT_RUNNING',  model: 'Gemini 3.1 Pro',  expectedSecs: 18 },
  { key: 'DATASET_BUILDER',    label: 'Dataset Assembly',     icon: '📦', runningStatus: 'DATASET_BUILDER_RUNNING',   model: 'Pydantic v2',     expectedSecs: 4  },
];

type StepState = 'pending' | 'running' | 'done' | 'error';

function getStepState(stepKey: string, runningStatus: string, currentStatus: string): StepState {
  if (currentStatus === runningStatus) return 'running';
  if (currentStatus === `FAILED_${stepKey}`) return 'error';
  
  const runningIdx = PIPELINE_STEPS.findIndex(s => s.runningStatus === currentStatus);
  const stepIdx = PIPELINE_STEPS.findIndex(s => s.key === stepKey);
  if (runningIdx > stepIdx || currentStatus === 'COMPLETED') return 'done';
  return 'pending';
}

export function PipelineTracker() {
  const { job } = useStore();
  const status = job.status || 'QUEUED';
  const elapsed = useElapsedTimer(job.startedAt);
  
  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-white">Processing Pipeline</h2>
          <p className="text-zinc-500 text-sm mt-1">7 AI agents running in sequence</p>
        </div>
        <div className="text-right">
          <div className="text-zinc-400 text-sm">Elapsed</div>
          <div className="text-white font-mono text-lg">{formatElapsed(elapsed)}</div>
        </div>
      </div>
      
      {/* Progress bar */}
      <div className="w-full h-1 bg-zinc-800 rounded-full mb-6 overflow-hidden">
        <motion.div
          className="h-full bg-indigo-500 rounded-full"
          animate={{ width: `${job.progressPercent || 0}%` }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        />
      </div>
      
      {/* Steps */}
      <div className="space-y-2">
        {PIPELINE_STEPS.map((step, idx) => {
          const state = getStepState(step.key, step.runningStatus, status);
          return (
            <PipelineStep
              key={step.key}
              step={step}
              stepNumber={idx + 1}
              state={state}
            />
          );
        })}
      </div>
    </div>
  );
}

function PipelineStep({ step, stepNumber, state }: {
  step: typeof PIPELINE_STEPS[0];
  stepNumber: number;
  state: StepState;
}) {
  const elapsed = useElapsedTimer(state === 'running' ? Date.now() : null);
  
  const borderColor = {
    pending: 'border-zinc-800',
    running: 'border-indigo-500',
    done:    'border-emerald-500/30',
    error:   'border-red-500',
  }[state];
  
  const bgColor = {
    pending: 'bg-zinc-900',
    running: 'bg-indigo-500/10',
    done:    'bg-emerald-500/5',
    error:   'bg-red-500/10',
  }[state];
  
  return (
    <motion.div
      className={`flex items-center gap-4 p-4 rounded-xl border ${borderColor} ${bgColor} transition-all duration-300`}
      animate={state === 'running' ? { borderColor: ['#6366f1', '#818cf8', '#6366f1'] } : {}}
      transition={{ duration: 2, repeat: Infinity }}
    >
      {/* Step number / status icon */}
      <div className="w-8 h-8 flex items-center justify-center rounded-full flex-shrink-0">
        {state === 'done'    && <span className="text-emerald-400 text-lg">✓</span>}
        {state === 'error'   && <span className="text-red-400 text-lg">✗</span>}
        {state === 'pending' && <span className="text-zinc-600 text-sm font-mono">{stepNumber}</span>}
        {state === 'running' && (
          <motion.div
            className="w-5 h-5 border-2 border-indigo-400 border-t-transparent rounded-full"
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          />
        )}
      </div>
      
      {/* Icon + label */}
      <div className="text-xl">{step.icon}</div>
      <div className="flex-1">
        <div className={`font-medium ${state === 'pending' ? 'text-zinc-500' : 'text-white'}`}>
          {step.label}
        </div>
        <div className="text-zinc-600 text-xs mt-0.5">{step.model}</div>
      </div>
      
      {/* Duration / ETA */}
      <div className="text-right text-sm">
        {state === 'running' && (
          <span className="text-indigo-300 font-mono">{formatElapsed(elapsed)}</span>
        )}
        {state === 'done' && (
          <span className="text-emerald-400 text-xs">Complete</span>
        )}
        {state === 'pending' && (
          <span className="text-zinc-700 text-xs">~{step.expectedSecs}s</span>
        )}
        {state === 'error' && (
          <span className="text-red-400 text-xs">Failed</span>
        )}
      </div>
    </motion.div>
  );
}
```

---

## 11.7 ResultsTabs Component

```tsx
// components/demo/ResultsTabs.tsx
'use client';

import { useState } from 'react';
import { TaskGraphView } from './TaskGraphView';
import { SkillSegmentsTable } from './SkillSegmentsTable';
import { ActionTimeline } from './ActionTimeline';
import { DownloadPanel } from './DownloadPanel';

const TABS = [
  { id: 'graph',    label: '🗺️ Task Graph' },
  { id: 'segments', label: '✂️ Skill Segments' },
  { id: 'actions',  label: '🏷️ Action Records' },
  { id: 'download', label: '📦 Download' },
] as const;

export function ResultsTabs() {
  const [activeTab, setActiveTab] = useState<typeof TABS[number]['id']>('graph');
  
  return (
    <div className="mt-8">
      <div className="flex bg-zinc-900 rounded-xl p-1 mb-6 gap-1">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`
              flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-all
              ${activeTab === tab.id
                ? 'bg-indigo-600 text-white'
                : 'text-zinc-500 hover:text-zinc-300'
              }
            `}
          >
            {tab.label}
          </button>
        ))}
      </div>
      
      {activeTab === 'graph'    && <TaskGraphView />}
      {activeTab === 'segments' && <SkillSegmentsTable />}
      {activeTab === 'actions'  && <ActionTimeline />}
      {activeTab === 'download' && <DownloadPanel />}
    </div>
  );
}
```

---

## 11.8 State Management — Zustand Store

```typescript
// lib/store.ts
import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

interface SessionState {
  jobId: string | null;
  jobToken: string | null;
  traceId: string | null;
  isUploading: boolean;
  uploadProgress: number;
}

interface JobState {
  status: string | null;
  progressPercent: number;
  currentAgent: string | null;
  startedAt: string | null;
  failureCode: string | null;
}

interface ResultsState {
  segments: SkillSegment[];
  actions: ActionRecord[];
  taskGraph: TaskGraph | null;
  manifestRecordCount: number | null;
}

interface Store {
  session: SessionState;
  job: JobState;
  results: ResultsState;
  
  // Session actions
  setJobId: (id: string) => void;
  setJobToken: (token: string) => void;
  setIsUploading: (v: boolean) => void;
  setUploadProgress: (pct: number) => void;
  
  // Job update (called by Realtime subscription)
  updateJobStatus: (event: JobStatusEvent) => void;
  
  // Results actions
  setResults: (data: Partial<ResultsState>) => void;
  
  // Reset
  reset: () => void;
}

const INITIAL_SESSION: SessionState = { jobId: null, jobToken: null, traceId: null, isUploading: false, uploadProgress: 0 };
const INITIAL_JOB: JobState = { status: null, progressPercent: 0, currentAgent: null, startedAt: null, failureCode: null };
const INITIAL_RESULTS: ResultsState = { segments: [], actions: [], taskGraph: null, manifestRecordCount: null };

export const useStore = create<Store>()(
  devtools(
    persist(
      (set) => ({
        session: INITIAL_SESSION,
        job: INITIAL_JOB,
        results: INITIAL_RESULTS,
        
        setJobId: (id) => set(s => ({ session: { ...s.session, jobId: id } })),
        setJobToken: (token) => set(s => ({ session: { ...s.session, jobToken: token } })),
        setIsUploading: (v) => set(s => ({ session: { ...s.session, isUploading: v } })),
        setUploadProgress: (pct) => set(s => ({ session: { ...s.session, uploadProgress: pct } })),
        
        updateJobStatus: (event) => set(s => ({
          job: {
            ...s.job,
            status: event.status,
            progressPercent: event.progressPercent,
            currentAgent: event.currentAgent,
            startedAt: s.job.startedAt ?? (event.status === 'VIDEO_AGENT_RUNNING' ? new Date().toISOString() : null),
            failureCode: event.status?.startsWith('FAILED_') ? event.status : null,
          },
        })),
        
        setResults: (data) => set(s => ({ results: { ...s.results, ...data } })),
        
        reset: () => set({ session: INITIAL_SESSION, job: INITIAL_JOB, results: INITIAL_RESULTS }),
      }),
      { name: 'ael-store', partialize: (s) => ({ session: { jobId: s.session.jobId, jobToken: s.session.jobToken } }) }
    )
  )
);
```

---

## 11.9 Realtime Hook

```typescript
// lib/realtime/useJobRealtime.ts
'use client';

import { useEffect, useRef } from 'react';
import { createBrowserClient } from '@/lib/supabase/client';
import { useStore } from '@/lib/store';
import { useQuery } from '@tanstack/react-query';

export function useJobRealtime(jobId: string | null) {
  const { session, updateJobStatus } = useStore();
  const token = session.jobToken;
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  
  // Fallback polling query (React Query)
  const { refetch } = useQuery({
    queryKey: ['job', jobId],
    queryFn: async () => {
      if (!jobId || !token) return null;
      const res = await fetch(`/api/job/${jobId}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await res.json();
      updateJobStatus({
        status: data.status,
        progressPercent: data.progress_percent,
        currentAgent: data.current_agent,
      });
      return data;
    },
    enabled: false,  // Manual trigger only (fallback)
    refetchInterval: false,
  });
  
  useEffect(() => {
    if (!jobId) return;
    
    const supabase = createBrowserClient();
    
    // Primary: Realtime subscription
    const channel = supabase
      .channel(`job-updates-${jobId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'processing_jobs',
        filter: `id=eq.${jobId}`,
      }, (payload) => {
        const row = payload.new as any;
        updateJobStatus({
          status: row.status,
          progressPercent: row.progress_percent,
          currentAgent: row.current_agent,
        });
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') {
          // Fallback: start polling
          const pollId = setInterval(() => refetch(), 5000);
          return () => clearInterval(pollId);
        }
      });
    
    channelRef.current = channel;
    
    return () => {
      supabase.removeChannel(channel);
    };
  }, [jobId, updateJobStatus, refetch]);
}
```

---

## 11.10 UI-to-Status Mapping (Complete)

| Backend Status | UI Phase | Step Highlighted | Progress |
|---|---|---|---|
| `UPLOADED` | Processing | — (queue message) | 0% |
| `QUEUED` | Processing | — (queue message) | 2% |
| `VIDEO_AGENT_RUNNING` | Processing | Step 1 pulsing | 10% |
| `QUALITY_AGENT_RUNNING` | Processing | Step 2 pulsing | 22% |
| `PERCEPTION_AGENT_RUNNING` | Processing | Step 3 pulsing | 35% |
| `SEGMENTATION_AGENT_RUNNING` | Processing | Step 4 pulsing | 62% |
| `ACTION_AGENT_RUNNING` | Processing | Step 5 pulsing | 72% |
| `TASK_GRAPH_AGENT_RUNNING` | Processing | Step 6 pulsing | 86% |
| `DATASET_BUILDER_RUNNING` | Processing | Step 7 pulsing | 94% |
| `COMPLETED` | Results | All steps green ✓ | 100% |
| `FAILED_VIDEO_AGENT` | Error | Step 1 red ✗ | — |
| `FAILED_QUALITY_AGENT` | Error | Step 2 red ✗ | — |
| `FAILED_PERCEPTION_AGENT` | Error | Step 3 red ✗ | — |
| `FAILED_SEGMENTATION_AGENT` | Error | Step 4 red ✗ | — |
| `FAILED_ACTION_AGENT` | Error | Step 5 red ✗ | — |
| `FAILED_TASK_GRAPH_AGENT` | Error | Step 6 red ✗ | — |
| `FAILED_DATASET_BUILDER` | Error | Step 7 red ✗ | — |
| `FAILED_ORCHESTRATOR` | Error | Red banner only | — |

---

## 11.11 Edge Cases

| Scenario | Detection | UI Behavior |
|---|---|---|
| User refreshes mid-run | Route reload with `jobId` in URL | Restore token from localStorage, poll GET /api/job/:id, resume Realtime |
| Realtime drops (network issue) | `CHANNEL_ERROR` event | Switch to 5s polling with polling indicator badge |
| Token expired after 24h | `401 TOKEN_EXPIRED` from API | Show "Session expired" banner with button to start new demo |
| Very slow pipeline (>5min) | Elapsed timer > 300s | Show "taking longer than expected" warning; suggest retry if >600s |
| Results too large to render | TaskGraph has >100 nodes | Paginate node list; render only visible nodes in React Flow viewport |

---
