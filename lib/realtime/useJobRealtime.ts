'use client';

import { useEffect, useRef } from 'react';
import { createBrowserClient } from '@/lib/supabase/client';
import { useStore } from '@/lib/store';
import { useQuery } from '@tanstack/react-query';

export function useJobRealtime(jobId: string | null) {
  const { session, updateJobStatus } = useStore();
  const token = session.jobToken;
  // Use refs to avoid stale closure issues in the polling fallback
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { refetch } = useQuery({
    queryKey: ['job', jobId],
    queryFn: async () => {
      if (!jobId || !token) return null;
      const res = await fetch(`/api/job/${jobId}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) return null;
      const data = await res.json();
      updateJobStatus({
        status: data.status,
        progressPercent: data.progress_percent,
        currentAgent: data.current_agent,
      });
      return data;
    },
    enabled: false,
    refetchInterval: false,
  });

  useEffect(() => {
    if (!jobId) return;

    const supabase = createBrowserClient();

    const startPolling = () => {
      // Clear any existing interval first
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = setInterval(() => refetch(), 5000);
    };

    const stopPolling = () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };

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
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          // ← FIX: start polling via ref, not by returning from callback
          startPolling();
        }
        if (status === 'SUBSCRIBED') {
          // Realtime reconnected — stop polling
          stopPolling();
          // Also immediately poll once to catch missed events
          refetch();
        }
      });

    return () => {
      stopPolling();   // ← FIX: clean up interval on unmount
      supabase.removeChannel(channel);
    };
  }, [jobId, updateJobStatus, refetch]);
}
