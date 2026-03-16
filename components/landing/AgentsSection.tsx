'use client';

import { motion } from 'framer-motion';

const AGENTS = [
  { name: 'Video Agent',        model: 'DINOv2-base',          icon: '🎬', color: 'border-violet-500/20 hover:border-violet-500/40', bg: 'from-violet-500/5 to-violet-500/10' },
  { name: 'Quality Agent',      model: 'OpenCV Pipeline',      icon: '✨', color: 'border-indigo-500/20 hover:border-indigo-500/40', bg: 'from-indigo-500/5 to-indigo-500/10' },
  { name: 'Perception Agent',   model: 'YOLOE + SAM2 + HaWoR', icon: '👁️', color: 'border-blue-500/20 hover:border-blue-500/40',   bg: 'from-blue-500/5 to-blue-500/10' },
  { name: 'Segmentation Agent', model: 'Signal Processing',    icon: '✂️', color: 'border-cyan-500/20 hover:border-cyan-500/40',   bg: 'from-cyan-500/5 to-cyan-500/10' },
  { name: 'Action Agent',       model: 'EgoVLM-3B',            icon: '🏷️', color: 'border-teal-500/20 hover:border-teal-500/40',   bg: 'from-teal-500/5 to-teal-500/10' },
  { name: 'Task Graph Agent',   model: 'Gemini 2.5 Pro',       icon: '🌐', color: 'border-emerald-500/20 hover:border-emerald-500/40', bg: 'from-emerald-500/5 to-emerald-500/10' },
  { name: 'Dataset Builder',    model: 'Pydantic v2',          icon: '📦', color: 'border-lime-500/20 hover:border-lime-500/40',    bg: 'from-lime-500/5 to-lime-500/10' },
];

export function AgentsSection() {
  return (
    <section id="architecture" className="py-28 relative">
      <div className="divider" />
      <div className="max-w-6xl mx-auto px-6 pt-28">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <span className="section-label">Multi-Agent System</span>
          <h2 className="text-4xl md:text-5xl font-bold text-white mt-3">
            The 7-Agent Architecture
          </h2>
        </motion.div>

        {/* Bento grid - asymmetric layout */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {AGENTS.map((agent, i) => {
            // Make some cards span 2 columns for bento feel
            const isWide = i === 2 || i === 5;
            return (
              <motion.div
                key={agent.name}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.06 }}
                className={`
                  relative overflow-hidden rounded-2xl border ${agent.color}
                  bg-gradient-to-br ${agent.bg} backdrop-blur-sm
                  p-6 flex flex-col justify-between min-h-[140px]
                  transition-all duration-300 cursor-default group
                  hover:bg-white/[0.03] hover:-translate-y-0.5
                  ${isWide ? 'md:col-span-2' : ''}
                `}
              >
                <div className="flex items-start justify-between mb-4">
                  <span className="text-3xl group-hover:scale-110 transition-transform">{agent.icon}</span>
                  <span className="text-[10px] font-mono text-[#4a4a5a] tracking-wider uppercase">Agent {String(i + 1).padStart(2, '0')}</span>
                </div>
                <div>
                  <h3 className="text-white font-semibold text-[15px] mb-1">{agent.name}</h3>
                  <p className="text-[#8b8b9a] text-xs font-mono">{agent.model}</p>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
