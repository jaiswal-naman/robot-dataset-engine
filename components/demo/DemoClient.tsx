'use client';

import { useStore } from '@/lib/store';
import { useJobRealtime } from '@/lib/realtime/useJobRealtime';
import { UploadZone } from './UploadZone';
import { UploadProgressBar } from './UploadProgressBar';
import { PipelineTracker } from './PipelineTracker';
import { ResultsTabs } from './ResultsTabs';
import { ErrorBanner } from './ErrorBanner';

const TERMINAL_STATUSES = ['COMPLETED', 'FAILED'];
const ACTIVE_STATUSES = [
  'QUEUED',
  'VIDEO_AGENT_RUNNING',
  'QUALITY_AGENT_RUNNING',
  'PERCEPTION_AGENT_RUNNING',
  'SEGMENTATION_AGENT_RUNNING',
  'ACTION_AGENT_RUNNING',
  'TASK_GRAPH_AGENT_RUNNING',
  'DATASET_BUILDER_RUNNING',
];

export function DemoClient() {
  const { session, job } = useStore();
  const { jobId } = session;

  // Subscribe to real-time updates whenever we have a jobId
  useJobRealtime(jobId);

  const isUploading = session.isUploading;
  const isProcessing = ACTIVE_STATUSES.includes(job.status ?? '');
  const isCompleted = job.status === 'COMPLETED';
  const isFailed = job.status?.startsWith('FAILED') ?? false;
  const progressPercent = job.progressPercent ?? 0;

  return (
    <>
      {/* LEFT SIDEBAR */}
      <aside className="w-80 flex flex-col gap-6 shrink-0">

        {/* ── Upload / Progress Zone ─────────────────────────────── */}
        <div className="glass p-6 rounded-xl flex flex-col gap-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="material-symbols-outlined text-[#1f44f9]">cloud_upload</span>
            <h3 className="font-bold text-sm">Data Acquisition</h3>
          </div>

          {isUploading ? (
            <UploadProgressBar />
          ) : (
            <div className="neon-border-blue rounded-xl overflow-hidden">
              <UploadZone />
            </div>
          )}
        </div>

        {/* ── Pipeline Tracker ───────────────────────────────────── */}
        {(jobId || isProcessing) && (
          <div className="glass flex-1 p-6 rounded-xl flex flex-col">
            <PipelineTracker />
          </div>
        )}

        {/* placeholder state — show before any upload */}
        {!jobId && !isUploading && (
          <div className="glass flex-1 p-6 rounded-xl flex flex-col">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[#10b981]">account_tree</span>
                <h3 className="font-bold text-sm">Pipeline Tracker</h3>
              </div>
              <span className="text-[10px] bg-slate-800 px-2 py-1 rounded text-slate-400">v3.0-STABLE</span>
            </div>
            <div className="flex flex-col flex-1 items-center justify-center text-center opacity-40 gap-3">
              <span className="material-symbols-outlined text-4xl text-slate-500">cloud_upload</span>
              <p className="text-sm text-slate-500">Upload a video to start the pipeline</p>
            </div>
          </div>
        )}
      </aside>

      {/* MAIN PANEL */}
      <section className="flex-1 glass rounded-xl flex flex-col overflow-hidden relative min-w-0">

        {/* Header */}
        <div className="p-6 border-b border-white/5 flex items-center justify-between glass-dark z-20">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-[#1f44f9]">visibility</span>
            <h2 className="text-xl font-bold tracking-tight">Live Perception Stream</h2>
          </div>
          {isProcessing && (
            <div className="flex items-center gap-2 bg-[#a855f7]/20 border border-[#a855f7]/30 px-3 py-1.5 rounded-full">
              <div className="w-2 h-2 rounded-full bg-[#a855f7] animate-pulse" />
              <span className="text-xs font-bold text-[#a855f7] tracking-wide">
                PROCESSING: {progressPercent}%
              </span>
            </div>
          )}
          {isCompleted && (
            <div className="flex items-center gap-2 bg-[#10b981]/20 border border-[#10b981]/30 px-3 py-1.5 rounded-full">
              <div className="w-2 h-2 rounded-full bg-[#10b981]" />
              <span className="text-xs font-bold text-[#10b981] tracking-wide">COMPLETED</span>
            </div>
          )}
          {!jobId && (
            <div className="flex items-center gap-2 bg-white/5 border border-white/10 px-3 py-1.5 rounded-full">
              <div className="w-2 h-2 rounded-full bg-slate-600" />
              <span className="text-xs font-bold text-slate-400 tracking-wide">IDLE</span>
            </div>
          )}
        </div>

        {/* Video / Results Area */}
        <div className="flex-1 relative bg-black overflow-hidden overflow-y-auto">
          {/* Idle state — no job yet */}
          {!jobId && !isUploading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center gap-4 opacity-50">
              <span className="material-symbols-outlined text-6xl text-slate-600">movie</span>
              <p className="text-slate-500 text-sm max-w-xs">
                Upload a factory video on the left to begin real-time AI perception.
              </p>
            </div>
          )}

          {/* Processing — show robot image + overlay annotations */}
          {(isProcessing || isCompleted) && (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className="w-full h-full object-cover opacity-60"
                alt="Industrial robot arm assembly line in factory"
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuBSJBBuEOMKGmSLCtOy8LAIxoXbssEpoOSl9Uvpt9Vr-zwCX7tGqw46Oe4ZyY-xBYxhbjLWdb1YQoc8Pi8_JJqUl_6ZEEiImLI_GmsyQAI7hzDDJXe0BZyumcubrT7CXiu--XtAzj4e2KShSh3fhoX3CP3zWSpsw2FFdKMDRUWCrGplYmPSBYQsryZNdWAjT7CXEpugmnjUdqeJPJvMJX6P6nLM-vGtahu0FPs8Z4rqH2LpVfP0GwCz1cEjY32AvJuME8yCz0BHUEI"
              />
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="absolute top-1/4 left-1/3 w-64 h-48 border-2 border-[#3b82f6] rounded-sm">
                  <div className="absolute -top-6 left-0 bg-[#3b82f6] text-white text-[10px] font-bold px-2 py-0.5 rounded-t">
                    DINOv2: ROBOTIC_ARM_L1
                  </div>
                  <div className="absolute top-2 right-2 flex flex-col items-end gap-1">
                    <div className="glass px-2 py-1 rounded text-[10px] text-white">CONF: 0.982</div>
                  </div>
                </div>
                <div className="absolute bottom-1/3 right-1/4 w-32 h-32 mask-overlay rounded-full blur-sm" />
                <div className="absolute bottom-1/3 right-1/4 w-32 h-32 border border-[#a855f7] flex items-center justify-center">
                  <div className="absolute -top-6 left-0 bg-[#a855f7] text-white text-[10px] font-bold px-2 py-0.5 rounded-t">SAM: WORKPIECE_04</div>
                </div>
                <div className="absolute top-10 left-10 flex flex-col gap-3">
                  <div className="glass-dark p-3 rounded-lg border-l-4 border-[#1f44f9] min-w-[140px]">
                    <p className="text-[10px] text-slate-400 uppercase font-bold tracking-widest">Global Coords</p>
                    <div className="flex flex-col mt-1 font-mono text-xs">
                      <div className="flex justify-between"><span>X:</span> <span className="text-[#1f44f9]">142.422</span></div>
                      <div className="flex justify-between"><span>Y:</span> <span className="text-[#1f44f9]">-12.891</span></div>
                      <div className="flex justify-between"><span>Z:</span> <span className="text-[#1f44f9]">894.103</span></div>
                    </div>
                  </div>
                  <div className="glass-dark p-3 rounded-lg border-l-4 border-[#a855f7] min-w-[140px]">
                    <p className="text-[10px] text-slate-400 uppercase font-bold tracking-widest">Joint State</p>
                    <div className="flex flex-col mt-1 font-mono text-xs">
                      <div className="flex justify-between"><span>J1:</span> <span className="text-[#a855f7]">0.14 rad</span></div>
                      <div className="flex justify-between"><span>J2:</span> <span className="text-[#a855f7]">-1.02 rad</span></div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="absolute bottom-6 right-6 flex flex-col gap-2">
                <div className="flex gap-2">
                  <button className="w-10 h-10 rounded-full glass-dark flex items-center justify-center hover:bg-white/10 transition-colors">
                    <span className="material-symbols-outlined text-white text-lg">videocam</span>
                  </button>
                  <button className="w-10 h-10 rounded-full glass-dark flex items-center justify-center hover:bg-white/10 transition-colors">
                    <span className="material-symbols-outlined text-white text-lg">layers</span>
                  </button>
                  <button className="w-10 h-10 rounded-full glass-dark flex items-center justify-center hover:bg-white/10 transition-colors">
                    <span className="material-symbols-outlined text-white text-lg">settings_overscan</span>
                  </button>
                </div>
              </div>
            </>
          )}

          {/* Error state */}
          {isFailed && (
            <div className="absolute inset-0 p-8 overflow-y-auto">
              <ErrorBanner />
            </div>
          )}

          {/* Completed — results tabs scroll within this panel */}
          {isCompleted && (
            <div className="absolute inset-0 overflow-y-auto bg-[#060812]/80 p-6">
              <ResultsTabs />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 glass-dark border-t border-white/5 flex flex-col gap-4 shrink-0">
          <div className="flex items-center justify-between relative group">
            <button
              disabled={!isCompleted}
              className={`flex-1 flex items-center justify-center gap-3 rounded-xl h-14 bg-[#1f44f9] text-white font-bold transition-all ${
                isCompleted
                  ? 'hover:bg-[#1f44f9]/90 shadow-[0_0_20px_rgba(31,68,249,0.3)] cursor-pointer'
                  : 'opacity-30 cursor-not-allowed'
              }`}
            >
              <span className="material-symbols-outlined">download</span>
              <span>Download RLDS Dataset</span>
            </button>
            {!isCompleted && (
              <div className="absolute -top-12 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-xs px-3 py-2 rounded-lg border border-white/10 shadow-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap">
                Processing must reach 100%
              </div>
            )}
          </div>
          <div className="flex justify-between text-[11px] text-slate-500 font-medium px-1">
            <div className="flex gap-4">
              <span>FPS: 24.2</span>
              <span>LATENCY: 42ms</span>
              <span>MODEL: ViT-H/14</span>
            </div>
            <div className="flex gap-4">
              <span>
                {isProcessing ? `PROCESSING: ${progressPercent}%` : isCompleted ? 'DONE' : 'IDLE'}
              </span>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
