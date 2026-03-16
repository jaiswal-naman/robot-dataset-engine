'use client';

import { useState } from 'react';
import { useStore } from '@/lib/store';
import { SearchInterface } from './SearchInterface';

export function LibraryClient() {
  const { session } = useStore();
  const [showSearch, setShowSearch] = useState(false);

  const hasSession = !!(session.jobId && session.jobToken);

  return (
    <div className="w-full">
      {/* Quick-access banner to jump to semantic search if a job exists */}
      {hasSession && (
        <div className="mb-6 flex items-center justify-between bg-[#8c25f4]/10 border border-[#8c25f4]/30 rounded-xl px-5 py-3">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-[#8c25f4]">manage_search</span>
            <div>
              <p className="text-sm font-bold text-slate-100">Active Session Detected</p>
              <p className="text-xs text-slate-400 font-mono">Job: {session.jobId?.slice(0, 12)}…</p>
            </div>
          </div>
          <button
            onClick={() => setShowSearch(!showSearch)}
            className="text-sm font-bold px-4 py-2 rounded-lg bg-[#8c25f4]/20 border border-[#8c25f4]/40 text-[#c084fc] hover:bg-[#8c25f4]/30 transition-all"
          >
            {showSearch ? 'Hide' : 'Open'} Semantic Search
          </button>
        </div>
      )}

      {/* Semantic Search Panel — pre-filled with session credentials */}
      {showSearch && hasSession && (
        <div className="mb-8">
          <LibrarySearchWithSession
            jobId={session.jobId!}
            token={session.jobToken!}
          />
        </div>
      )}
    </div>
  );
}

/** A thin wrapper that feeds the current session into SearchInterface */
function LibrarySearchWithSession({ jobId, token }: { jobId: string; token: string }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query) return;
    setIsLoading(true);
    setError(null);
    setResults([]);

    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ job_id: jobId, query, top_k: 6 }),
      });
      if (!res.ok) throw new Error(await res.text() || 'Search failed');
      const data = await res.json();
      setResults(data.results || []);
    } catch (err: any) {
      setError(err.message || 'Search error');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="glass-effect border border-[#8c25f4]/20 rounded-2xl p-6 space-y-5">
      <h2 className="text-sm font-bold text-slate-300 uppercase tracking-widest">
        Semantic Search — Current Job
      </h2>
      <form onSubmit={handleSearch} className="flex gap-3">
        <div className="relative flex-1">
          <div className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none">
            <span className="material-symbols-outlined text-[#8c25f4]">psychology</span>
          </div>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-[#0a060e]/50 border border-[#8c25f4]/30 rounded-xl py-3 pl-12 pr-4 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#8c25f4]/50 text-sm"
            placeholder='e.g. "pick up screwdriver from tray"'
          />
        </div>
        <button
          type="submit"
          disabled={isLoading || !query}
          className="px-5 py-3 rounded-xl bg-[#8c25f4] text-white text-sm font-bold hover:bg-[#8c25f4]/80 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
        >
          {isLoading ? 'Searching…' : 'Search'}
        </button>
      </form>

      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-sm">{error}</div>
      )}

      {results.length > 0 && (
        <div>
          <p className="text-xs text-slate-500 mb-3">{results.length} results</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {results.map((r, i) => (
              <div key={i} className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-xs font-mono px-2 py-1 rounded-md ${
                    r.similarity >= 0.9 ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                  }`}>{(r.similarity * 100).toFixed(1)}%</span>
                </div>
                <p className="text-white text-sm line-clamp-2 mb-2">&ldquo;{r.text}&rdquo;</p>
                {r.action_label && (
                  <span className="text-[10px] px-2 py-0.5 bg-[#8c25f4]/20 text-[#c084fc] rounded border border-[#8c25f4]/20">{r.action_label}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
