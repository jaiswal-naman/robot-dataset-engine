'use client';

import { motion } from 'framer-motion';

const SAMPLE_ACTIONS = [
  { index: 0, label: 'pick up screwdriver from tray', verb: 'pick up', object: 'screwdriver', confidence: 0.94 },
  { index: 1, label: 'tighten bolt on left panel',    verb: 'tighten', object: 'bolt',        confidence: 0.91 },
  { index: 2, label: 'place screwdriver back on tray', verb: 'place',  object: 'screwdriver', confidence: 0.88 },
  { index: 3, label: 'pick up inspection gauge',       verb: 'pick up', object: 'gauge',       confidence: 0.92 },
  { index: 4, label: 'measure gap on right panel',     verb: 'measure', object: 'gap',         confidence: 0.87 },
];

const SAMPLE_GRAPH = {
  goal: 'Assemble panel joint',
  subtasks: ['Fasten bolts', 'Inspect gap clearance'],
};

export function SampleOutputSection() {
  return (
    <section className="py-28 relative">
      <div className="divider" />
      <div className="max-w-6xl mx-auto px-6 pt-28">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <span className="section-label">Output Preview</span>
          <h2 className="text-4xl md:text-5xl font-bold text-white mt-3">What You Get</h2>
          <p className="text-[#8b8b9a] mt-4 max-w-xl mx-auto text-lg">
            Structured action labels, task graphs, and downloadable datasets.
          </p>
        </motion.div>

        <div className="grid md:grid-cols-2 gap-5">
          {/* Action Labels Preview */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="glass rounded-2xl p-6"
          >
            {/* Terminal header bar */}
            <div className="flex items-center gap-3 mb-5 pb-4 border-b border-white/[0.06]">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-red-500/60" />
                <div className="w-3 h-3 rounded-full bg-yellow-500/60" />
                <div className="w-3 h-3 rounded-full bg-green-500/60" />
              </div>
              <span className="text-[#8b8b9a] text-xs font-mono">action_timeline.json</span>
            </div>

            <div className="space-y-2.5">
              {SAMPLE_ACTIONS.map((action) => (
                <div
                  key={action.index}
                  className="flex items-center justify-between bg-white/[0.02] rounded-lg px-4 py-3 border border-white/[0.04] hover:border-white/[0.08] transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-[#4a4a5a] text-xs font-mono shrink-0">#{action.index}</span>
                    <span className="text-[#e4e4ea] text-sm truncate">{action.label}</span>
                  </div>
                  <span className={`text-xs font-mono px-2 py-1 rounded-md shrink-0 ml-3 ${
                    action.confidence >= 0.9
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                  }`}>
                    {(action.confidence * 100).toFixed(0)}%
                  </span>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Task Graph Preview */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="glass rounded-2xl p-6"
          >
            {/* Terminal header bar */}
            <div className="flex items-center gap-3 mb-5 pb-4 border-b border-white/[0.06]">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-red-500/60" />
                <div className="w-3 h-3 rounded-full bg-yellow-500/60" />
                <div className="w-3 h-3 rounded-full bg-green-500/60" />
              </div>
              <span className="text-[#8b8b9a] text-xs font-mono">task_graph.json</span>
            </div>

            <div className="flex flex-col items-center gap-3 py-4">
              {/* Goal node */}
              <div className="bg-indigo-500/10 border border-indigo-500/25 rounded-xl px-8 py-4 text-center w-full max-w-xs">
                <span className="text-[10px] text-indigo-400 font-mono tracking-widest uppercase">GOAL</span>
                <p className="text-white font-semibold mt-1">{SAMPLE_GRAPH.goal}</p>
              </div>

              {/* Connector */}
              <div className="flex flex-col items-center">
                <div className="w-px h-6 bg-gradient-to-b from-indigo-500/40 to-cyan-500/40" />
                <div className="w-2 h-2 rounded-full bg-indigo-500/40" />
              </div>

              {/* Subtasks */}
              <div className="flex gap-3 flex-wrap justify-center w-full">
                {SAMPLE_GRAPH.subtasks.map((task, i) => (
                  <div key={i} className="bg-cyan-500/8 border border-cyan-500/20 rounded-xl px-6 py-3 flex-1 min-w-[160px] text-center">
                    <span className="text-[10px] text-cyan-400 font-mono tracking-widest uppercase">SUBTASK</span>
                    <p className="text-[#e4e4ea] text-sm mt-1">{task}</p>
                  </div>
                ))}
              </div>

              {/* Connector */}
              <div className="flex flex-col items-center">
                <div className="w-2 h-2 rounded-full bg-cyan-500/40" />
                <div className="w-px h-6 bg-gradient-to-b from-cyan-500/40 to-emerald-500/40" />
              </div>

              {/* Dataset output */}
              <div className="bg-emerald-500/8 border border-emerald-500/20 rounded-xl px-8 py-4 text-center w-full max-w-xs">
                <span className="text-[10px] text-emerald-400 font-mono tracking-widest uppercase">OUTPUT</span>
                <p className="text-[#e4e4ea] text-sm mt-1">VLA Dataset (JSON + RLDS)</p>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
