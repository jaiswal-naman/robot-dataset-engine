'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { useStore } from '@/lib/store';
import { PipelineTracker } from '@/components/demo/PipelineTracker';
import { ResultsTabs } from '@/components/demo/ResultsTabs';
import { ErrorBanner } from '@/components/demo/ErrorBanner';
import { useJobRealtime } from '@/lib/realtime/useJobRealtime';

type Phase = 'loading' | 'processing' | 'completed' | 'failed';

export default function ResumableJobPage({ params }: { params: Promise<{ jobId: string }> }) {
  const resolvedParams = use(params);
  const router = useRouter();
  const { session, job, setJobId, setJobToken } = useStore();
  const [isInitializing, setIsInitializing] = useState(true);

  useEffect(() => {
    // 1. Recover token from localStorage
    const savedToken = localStorage.getItem(`ael_token_${resolvedParams.jobId}`);
    if (!savedToken) {
      alert('Session expired or invalid link. Access token not found in this browser.');
      router.push('/demo');
      return;
    }

    // 2. Hydrate store
    if (session.jobId !== resolvedParams.jobId) {
      setJobId(resolvedParams.jobId);
      setJobToken(savedToken);
    }
    
    setIsInitializing(false);
  }, [resolvedParams.jobId, session.jobId, setJobId, setJobToken, router]);

  // Subscribe to Realtime
  useJobRealtime(isInitializing ? null : resolvedParams.jobId);

  if (isInitializing) {
    return (
      <main className="min-h-screen bg-[#0f0f13] text-white flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </main>
    );
  }

  const phase: Phase = (() => {
    if (!job.status) return 'loading';
    if (job.status === 'COMPLETED') return 'completed';
    if (job.status?.startsWith('FAILED_')) return 'failed';
    return 'processing';
  })();

  return (
    <main className="min-h-screen bg-[#0f0f13] text-white py-16">
      <div className="max-w-4xl mx-auto px-6">
        <h1 className="text-3xl font-bold mb-2">Job {resolvedParams.jobId.slice(0,8)}...</h1>
        <p className="text-zinc-400 mb-12">Resume tracking your pipeline session.</p>

        {phase === 'loading' && (
           <div className="flex justify-center p-12">
             <div className="w-6 h-6 border-2 border-zinc-500 border-t-transparent rounded-full animate-spin" />
           </div>
        )}

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
