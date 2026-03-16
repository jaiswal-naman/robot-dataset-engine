'use client';

import { useRef, useEffect } from 'react';
import { useStore } from '@/lib/store';
import { motion } from 'framer-motion';
import { useElapsedTimer, formatElapsed } from '@/lib/hooks/useElapsedTimer';

const PIPELINE_STEPS = [
  { key: 'VIDEO_AGENT',        label: 'Video Input',          icon: '🎬', runningStatus: 'VIDEO_AGENT_RUNNING',        model: 'DINOv2-base',          expectedSecs: 12 },
  { key: 'QUALITY_AGENT',      label: 'Quality Check',        icon: '✨', runningStatus: 'QUALITY_AGENT_RUNNING',      model: 'OpenCV',               expectedSecs: 4  },
  { key: 'PERCEPTION_AGENT',   label: 'Perception (DINOv2)',  icon: '👁️', runningStatus: 'PERCEPTION_AGENT_RUNNING',  model: 'YOLOE + SAM2 + HaWoR', expectedSecs: 75 },
  { key: 'SEGMENTATION_AGENT', label: 'Segmentation (SAM)',   icon: '✂️', runningStatus: 'SEGMENTATION_AGENT_RUNNING', model: 'Signal Processing',    expectedSecs: 8  },
  { key: 'ACTION_AGENT',       label: 'Action Recognition',   icon: '🏷️', runningStatus: 'ACTION_AGENT_RUNNING',      model: 'EgoVLM-3B',            expectedSecs: 28 },
  { key: 'TASK_GRAPH_AGENT',   label: 'Task Graph Gen',       icon: '🌐', runningStatus: 'TASK_GRAPH_AGENT_RUNNING',  model: 'Gemini 2.5 Pro',       expectedSecs: 18 },
  { key: 'DATASET_BUILDER',    label: 'Output RLDS Builder',  icon: '📦', runningStatus: 'DATASET_BUILDER_RUNNING',   model: 'Pydantic v2',          expectedSecs: 4  },
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
    <div className="glass rounded-2xl p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5 pb-4 border-b border-white/[0.06]">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold text-white">Pipeline Tracker</h2>
          <span className="badge badge-indigo">07 agents</span>
        </div>
        <div className="text-right">
          <span className="text-white font-mono text-sm">{formatElapsed(elapsed)}</span>
        </div>
      </div>
      
      {/* Progress bar */}
      <div className="w-full h-1.5 bg-white/[0.04] rounded-full mb-5 overflow-hidden">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-indigo-600 to-indigo-400"
          animate={{ width: `${job.progressPercent || 0}%` }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          style={{ boxShadow: '0 0 12px rgba(99,102,241,0.4)' }}
        />
      </div>
      
      {/* Steps */}
      <div className="space-y-1.5">
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
  const startTimeRef = useRef<string | null>(null);
  useEffect(() => {
    if (state === 'running' && !startTimeRef.current) {
      startTimeRef.current = new Date().toISOString();
    }
    if (state !== 'running') {
      startTimeRef.current = null;
    }
  }, [state]);

  const elapsed = useElapsedTimer(state === 'running' ? startTimeRef.current : null);
  
  const styles = {
    pending: 'border-transparent bg-transparent',
    running: 'border-indigo-500/30 bg-indigo-500/[0.06]',
    done:    'border-transparent bg-emerald-500/[0.03]',
    error:   'border-red-500/30 bg-red-500/[0.06]',
  }[state];
  
  return (
    <motion.div
      className={`flex items-center gap-3.5 px-4 py-3 rounded-xl border transition-all duration-300 ${styles}`}
      animate={state === 'running' ? { borderColor: ['rgba(99,102,241,0.3)', 'rgba(99,102,241,0.5)', 'rgba(99,102,241,0.3)'] } : {}}
      transition={{ duration: 2, repeat: Infinity }}
    >
      {/* Status indicator */}
      <div className="w-7 h-7 flex items-center justify-center rounded-full flex-shrink-0">
        {state === 'done'    && <span className="text-emerald-400 text-sm">✓</span>}
        {state === 'error'   && <span className="text-red-400 text-sm">✗</span>}
        {state === 'pending' && <span className="text-[#4a4a5a] text-xs font-mono">{String(stepNumber).padStart(2, '0')}</span>}
        {state === 'running' && (
          <motion.div
            className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full"
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          />
        )}
      </div>
      
      {/* Icon + label */}
      <span className="text-base shrink-0">{step.icon}</span>
      <div className="flex-1 min-w-0">
        <span className={`text-sm font-medium ${state === 'pending' ? 'text-[#4a4a5a]' : state === 'done' ? 'text-[#8b8b9a]' : 'text-white'}`}>
          {step.label}
        </span>
      </div>
      
      {/* Right side status */}
      <div className="text-right shrink-0">
        {state === 'running' && (
          <span className="text-indigo-300 font-mono text-xs">{formatElapsed(elapsed)}</span>
        )}
        {state === 'done' && (
          <span className="text-emerald-400/60 text-[11px] font-mono">Completed</span>
        )}
        {state === 'pending' && (
          <span className="text-[#4a4a5a] text-[11px] font-mono">Pending</span>
        )}
        {state === 'error' && (
          <span className="text-red-400 text-[11px] font-mono">Failed</span>
        )}
      </div>
    </motion.div>
  );
}
