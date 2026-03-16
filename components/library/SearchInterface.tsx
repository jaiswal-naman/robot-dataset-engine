'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';

export function SearchInterface() {
  const [query, setQuery] = useState('');
  const [jobId, setJobId] = useState('');
  const [token, setToken] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query || !jobId || !token) {
      setError("Job ID, Token, and Query are strictly required to search a private index.");
      return;
    }
    
    setIsLoading(true);
    setError(null);
    setResults([]);

    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ job_id: jobId, query, top_k: 6 }),
      });

      if (!res.ok) throw new Error(await res.text() || 'Search failed');
      const data = await res.json();
      setResults(data.results || []);
    } catch (err: any) {
      setError(err.message || 'An error occurred while searching');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Search Controls */}
      <form onSubmit={handleSearch} className="glass rounded-2xl p-6">
        <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
          <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full" />
          Query Parameters
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
          <div>
            <label className="block text-xs text-[#8b8b9a] mb-1.5 font-medium">Job ID</label>
            <input 
              type="text" 
              value={jobId}
              onChange={(e) => setJobId(e.target.value)}
              className="w-full bg-white/[0.03] border border-white/[0.08] rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20 font-mono text-sm placeholder-[#4a4a5a] transition-colors"
              placeholder="550e8400-e29b-41d4-a716-446655440000"
            />
          </div>
          <div>
            <label className="block text-xs text-[#8b8b9a] mb-1.5 font-medium">Access Token</label>
            <input 
              type="password" 
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="w-full bg-white/[0.03] border border-white/[0.08] rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20 font-mono text-sm placeholder-[#4a4a5a] transition-colors"
              placeholder="Session token"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs text-[#8b8b9a] mb-1.5 font-medium">Semantic Query</label>
          <div className="relative">
            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-[#4a4a5a]">🔍</div>
            <input 
              type="text" 
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl pl-10 pr-36 py-4 text-white placeholder-[#4a4a5a] focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20 text-base transition-colors"
              placeholder="e.g. pick up screwdriver from tray"
            />
            <div className="absolute right-2 top-2 bottom-2 flex items-center gap-2">
              <kbd className="hidden md:flex items-center gap-1 px-2 py-1 text-[10px] font-mono text-[#4a4a5a] bg-white/[0.04] border border-white/[0.06] rounded-md">⌘K</kbd>
              <button
                type="submit"
                disabled={isLoading}
                className="btn-primary py-2 px-5 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? 'Searching…' : 'Search'}
              </button>
            </div>
          </div>
        </div>
        
        {error && (
          <div className="mt-4 p-3 bg-red-500/[0.06] border border-red-500/20 text-red-400 rounded-lg text-sm">
            {error}
          </div>
        )}
      </form>

      {/* Results Grid */}
      {results.length > 0 && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-white">Top Retrievals</h3>
            <span className="badge badge-zinc">{results.length} results</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {results.map((r, i) => (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                key={i} 
                className="glass glass-hover rounded-xl overflow-hidden"
              >
                {/* Thumbnail placeholder */}
                <div className="aspect-video bg-white/[0.02] flex items-center justify-center text-3xl border-b border-white/[0.06]">
                  🎬
                </div>
                <div className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-xs font-mono px-2 py-1 rounded-md ${
                      r.similarity >= 0.9
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                    }`}>
                      {(r.similarity * 100).toFixed(1)}%
                    </span>
                    <span className="text-[#4a4a5a] font-mono text-[10px]">
                      {r.start_ts_ms}ms – {r.end_ts_ms}ms
                    </span>
                  </div>
                  <p className="text-white text-sm mb-3 line-clamp-2 font-medium">&quot;{r.text}&quot;</p>
                  
                  {(r.action_label || r.primary_object) && (
                    <div className="flex flex-wrap gap-1.5">
                      {r.action_label && (
                        <span className="badge badge-indigo text-[10px]">{r.action_label}</span>
                      )}
                      {r.primary_object && (
                        <span className="badge badge-zinc text-[10px]">{r.primary_object}</span>
                      )}
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
