'use client';

import { motion } from 'framer-motion';

const CAPABILITIES = [
  {
    icon: '🧠',
    title: 'Zero-shot VLM',
    description: 'State-of-the-art vision-language model architecture understands scene context and intent without any task-specific training.',
    gradient: 'from-violet-500/10 to-indigo-500/10',
    border: 'hover:border-violet-500/30',
  },
  {
    icon: '🔬',
    title: 'DINOv2 + SAM2 Tracking',
    description: 'Pixel-perfect object persistence across complex occlusions using fused transformer embeddings and Segment Anything Model.',
    gradient: 'from-indigo-500/10 to-blue-500/10',
    border: 'hover:border-indigo-500/30',
  },
  {
    icon: '⚡',
    title: 'Real-time Orchestration',
    description: 'Scalable cloud infrastructure on Modal.com handles massive dataset generation with GPU auto-scaling and ultra-low latency.',
    gradient: 'from-blue-500/10 to-cyan-500/10',
    border: 'hover:border-blue-500/30',
  },
];

export function CapabilitiesSection() {
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
          <span className="section-label">Core Technology</span>
          <h2 className="text-4xl md:text-5xl font-bold text-white mt-3">
            Enterprise-Grade Capabilities
          </h2>
          <p className="text-[#8b8b9a] mt-4 max-w-xl mx-auto text-lg">
            Powering the next generation of robotic foundation models.
          </p>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-5">
          {CAPABILITIES.map((cap, i) => (
            <motion.div
              key={cap.title}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              className={`glass glass-hover ${cap.border} rounded-2xl p-8 group cursor-default`}
            >
              <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${cap.gradient} flex items-center justify-center text-2xl mb-5 group-hover:scale-105 transition-transform`}>
                {cap.icon}
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">{cap.title}</h3>
              <p className="text-[#8b8b9a] text-sm leading-relaxed">{cap.description}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
