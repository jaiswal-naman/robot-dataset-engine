'use client';
import { useStore } from '@/lib/store';

export function ErrorBanner() {
  const { job } = useStore();
  return (
    <div className="mt-6 p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-200">
      <h3 className="font-semibold text-red-400 flex items-center gap-2">
        <span>⚠️</span> Pipeline Failed
      </h3>
      <p className="mt-1 text-sm">{job.failureCode || 'An unknown error occurred during processing.'}</p>
    </div>
  );
}
