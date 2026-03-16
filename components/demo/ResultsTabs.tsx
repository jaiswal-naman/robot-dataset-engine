'use client';

import { useState } from 'react';
import { useStore } from '@/lib/store';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';

// ── Sub-tab components ─────────────────────────────────────────────────────────

function TaskGraphView() {
  const { session } = useStore();
  const { data, isLoading, error } = useQuery({
    queryKey: ['task-graph', session.jobId],
    queryFn: async () => {
      if (!session.jobId || !session.jobToken) return null;
      const res = await fetch(`/api/job/${session.jobId}/task-graph`, {
        headers: { Authorization: `Bearer ${session.jobToken}` },
      });
      if (!res.ok) throw new Error('Failed to load task graph');
      return res.json();
    },
    enabled: !!session.jobId,
  });

  if (isLoading) return <LoadingPanel label="Loading task graph..." />;
  if (error || !data?.graph) return <EmptyPanel label="Task graph not available" />;

  const { goal, nodes, edges } = data.graph;
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
      <div className="mb-4">
        <span className="text-indigo-400 text-xs font-mono uppercase tracking-widest">Goal</span>
        <h3 className="text-white text-lg font-semibold mt-1">{goal}</h3>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {(nodes || []).filter((n: any) => n.type !== 'goal').map((node: any, i: number) => (
          <motion.div
            key={node.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
            className="bg-zinc-800 border border-zinc-700 rounded-lg p-4"
          >
            <div className="flex items-center gap-2 mb-1">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                node.type === 'action' ? 'bg-indigo-400' : 'bg-emerald-400'
              }`} />
              <span className="text-white text-sm font-medium">{node.label}</span>
            </div>
            {node.description && (
              <p className="text-zinc-500 text-xs mt-1">{node.description}</p>
            )}
          </motion.div>
        ))}
      </div>
      <p className="text-zinc-600 text-xs mt-4">{(nodes || []).length} nodes · {(edges || []).length} edges</p>
    </div>
  );
}

function SkillSegmentsTable() {
  const { session } = useStore();
  const { data, isLoading } = useQuery({
    queryKey: ['segments', session.jobId],
    queryFn: async () => {
      if (!session.jobId || !session.jobToken) return null;
      const res = await fetch(`/api/job/${session.jobId}/segments`, {
        headers: { Authorization: `Bearer ${session.jobToken}` },
      });
      if (!res.ok) throw new Error('Failed to load segments');
      return res.json();
    },
    enabled: !!session.jobId,
  });

  if (isLoading) return <LoadingPanel label="Loading segments..." />;
  if (!data?.segments?.length) return <EmptyPanel label="No skill segments found" />;

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800">
      <table className="w-full text-sm">
        <thead className="bg-zinc-900 border-b border-zinc-800">
          <tr>
            <th className="text-left text-zinc-500 font-medium px-4 py-3">#</th>
            <th className="text-left text-zinc-500 font-medium px-4 py-3">Timestamp</th>
            <th className="text-left text-zinc-500 font-medium px-4 py-3">Object</th>
            <th className="text-left text-zinc-500 font-medium px-4 py-3">Trigger</th>
            <th className="text-left text-zinc-500 font-medium px-4 py-3">Confidence</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/50 bg-zinc-950">
          {data.segments.map((seg: any, i: number) => (
            <motion.tr
              key={seg.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: i * 0.03 }}
            >
              <td className="px-4 py-3 text-zinc-500 font-mono">{seg.segment_index + 1}</td>
              <td className="px-4 py-3 text-zinc-300 font-mono text-xs">
                {msToTimestamp(seg.start_ts_ms)} – {msToTimestamp(seg.end_ts_ms)}
              </td>
              <td className="px-4 py-3 text-white">{seg.primary_object || '—'}</td>
              <td className="px-4 py-3">
                <span className="text-xs px-2 py-0.5 bg-zinc-800 rounded text-zinc-400">{seg.trigger_type}</span>
              </td>
              <td className="px-4 py-3 text-zinc-300">{(seg.confidence * 100).toFixed(0)}%</td>
            </motion.tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ActionTimeline() {
  const { session } = useStore();
  const { data, isLoading } = useQuery({
    queryKey: ['actions', session.jobId],
    queryFn: async () => {
      if (!session.jobId || !session.jobToken) return null;
      const res = await fetch(`/api/job/${session.jobId}/actions`, {
        headers: { Authorization: `Bearer ${session.jobToken}` },
      });
      if (!res.ok) throw new Error('Failed to load actions');
      return res.json();
    },
    enabled: !!session.jobId,
  });

  if (isLoading) return <LoadingPanel label="Loading action records..." />;
  if (!data?.actions?.length) return <EmptyPanel label="No action records found" />;

  return (
    <div className="space-y-3">
      {data.actions.map((action: any, i: number) => (
        <motion.div
          key={action.id}
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.04 }}
          className="flex gap-4 bg-zinc-900 border border-zinc-800 rounded-xl p-4"
        >
          <div className="flex-shrink-0 w-8 h-8 rounded-full bg-indigo-900/50 border border-indigo-700 flex items-center justify-center text-indigo-300 text-xs font-mono">
            {action.action_index + 1}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-medium">{action.action_label}</p>
            <div className="flex flex-wrap gap-2 mt-1.5">
              {action.verb && <Tag label={`${action.verb}`} color="indigo" />}
              {action.object && <Tag label={action.object} color="zinc" />}
              {action.tool && <Tag label={`with ${action.tool}`} color="zinc" />}
            </div>
          </div>
          <div className="text-right flex-shrink-0">
            <div className={`text-xs font-medium ${
              action.confidence > 0.8 ? 'text-emerald-400' :
              action.confidence > 0.5 ? 'text-yellow-400' : 'text-red-400'
            }`}>
              {(action.confidence * 100).toFixed(0)}%
            </div>
            <div className="text-zinc-600 text-xs mt-0.5">{action.model_used}</div>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

function DownloadPanel() {
  const { session } = useStore();
  const { data, isLoading } = useQuery({
    queryKey: ['dataset', session.jobId],
    queryFn: async () => {
      if (!session.jobId || !session.jobToken) return null;
      const res = await fetch(`/api/job/${session.jobId}/dataset`, {
        headers: { Authorization: `Bearer ${session.jobToken}` },
      });
      if (!res.ok) throw new Error('Failed to load dataset');
      return res.json();
    },
    enabled: !!session.jobId,
  });

  if (isLoading) return <LoadingPanel label="Generating download links..." />;

  const DOWNLOAD_META: Record<string, { label: string; description: string; format: string }> = {
    DATASET_JSON: { label: 'VLA Dataset (JSON)', description: 'Structured action-image dataset', format: 'JSON' },
    DATASET_RLDS: { label: 'VLA Dataset (RLDS)', description: 'TFRecord format for RT-2 / OpenVLA', format: 'TFRecord' },
  };

  return (
    <div className="space-y-4">
      {data?.manifest && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-5 mb-4">
          <h4 className="text-sm text-zinc-500 font-mono uppercase tracking-wider mb-3">Manifest</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div><span className="text-zinc-500">Records</span><p className="text-white font-medium">{data.manifest.record_count ?? '—'}</p></div>
            <div><span className="text-zinc-500">Segments</span><p className="text-white font-medium">{data.manifest.segment_count ?? '—'}</p></div>
            <div><span className="text-zinc-500">Actions</span><p className="text-white font-medium">{data.manifest.action_count ?? '—'}</p></div>
            <div><span className="text-zinc-500">Graph Nodes</span><p className="text-white font-medium">{data.manifest.task_graph_nodes ?? '—'}</p></div>
          </div>
        </div>
      )}
      {data?.downloads?.map((dl: any, i: number) => {
        const meta = DOWNLOAD_META[dl.type] ?? { label: dl.filename, description: '', format: dl.type };
        return (
          <div key={i} className="flex items-center justify-between bg-zinc-900 border border-zinc-800 rounded-xl p-5">
            <div>
              <div className="text-white font-medium">{meta.label}</div>
              <div className="text-zinc-500 text-sm mt-0.5">{meta.description}</div>
            </div>
            <a
              href={dl.signed_url}
              download={dl.filename}
              className="flex-shrink-0 ml-6 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors"
            >
              Download {meta.format}
            </a>
          </div>
        );
      })}
      {(!data?.downloads?.length) && (
        <EmptyPanel label="No downloads available yet" />
      )}
    </div>
  );
}

// ── Utility components ─────────────────────────────────────────────────────────

function LoadingPanel({ label }: { label: string }) {
  return (
    <div className="p-12 text-center bg-zinc-900/50 rounded-xl border border-zinc-800">
      <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
      <p className="text-zinc-500 text-sm">{label}</p>
    </div>
  );
}

function EmptyPanel({ label }: { label: string }) {
  return (
    <div className="p-12 text-center bg-zinc-900/50 rounded-xl border border-zinc-800">
      <p className="text-zinc-500">{label}</p>
    </div>
  );
}

function Tag({ label, color }: { label: string; color: 'indigo' | 'zinc' }) {
  const cls = color === 'indigo'
    ? 'bg-indigo-900/40 text-indigo-300 border-indigo-800/50'
    : 'bg-zinc-800 text-zinc-400 border-zinc-700/50';
  return (
    <span className={`text-xs px-2 py-0.5 rounded border ${cls}`}>{label}</span>
  );
}

function msToTimestamp(ms: number) {
  if (!ms) return '0:00';
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ── Main ResultsTabs ──────────────────────────────────────────────────────────

const TABS = [
  { id: 'graph',    label: '🗺️ Task Graph' },
  { id: 'segments', label: '✂️ Skill Segments' },
  { id: 'actions',  label: '🏷️ Action Records' },
  { id: 'download', label: '📦 Download' },
] as const;

export function ResultsTabs() {
  const [activeTab, setActiveTab] = useState<typeof TABS[number]['id']>('graph');

  return (
    <div className="mt-8 animate-in fade-in duration-500 slide-in-from-bottom-4">
      <div className="flex bg-zinc-900 rounded-xl p-1 mb-6 gap-1">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`
              flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-all
              ${activeTab === tab.id
                ? 'bg-indigo-600 text-white shadow-lg'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/5'
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
