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
  segments: any[];
  actions: any[];
  taskGraph: any | null;
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
  updateJobStatus: (event: Partial<JobState>) => void;
  
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
            ...event,
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
