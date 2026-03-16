'use client';

import { motion } from 'framer-motion';

const CATEGORIES = [
  {
    label: 'Frontend',
    items: [
      { name: 'Next.js 15', desc: 'App Router + RSC' },
      { name: 'React 19', desc: 'Server Components' },
      { name: 'Zustand', desc: 'State Management' },
      { name: 'Framer Motion', desc: 'Animations' },
    ],
  },
  {
    label: 'Backend',
    items: [
      { name: 'Modal', desc: 'Serverless GPU' },
      { name: 'LangGraph', desc: 'Agent Orchestration' },
      { name: 'FastAPI', desc: 'Webhook Endpoints' },
      { name: 'Supabase', desc: 'Postgres + Storage' },
    ],
  },
  {
    label: 'AI / ML',
    items: [
      { name: 'DINOv2', desc: 'Visual Embeddings' },
      { name: 'YOLOE', desc: 'Object Detection' },
      { name: 'SAM2', desc: 'Video Segmentation' },
      { name: 'Gemini', desc: 'Task Graph Gen' },
    ],
  },
];

export function TechStackSection() {
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
          <span className="section-label">Built With</span>
          <h2 className="text-4xl md:text-5xl font-bold text-white mt-3">Tech Stack</h2>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-8">
          {CATEGORIES.map((cat, ci) => (
            <motion.div
              key={cat.label}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: ci * 0.1 }}
            >
              <h3 className="section-label mb-4">{cat.label}</h3>
              <div className="space-y-2.5">
                {cat.items.map((item) => (
                  <div
                    key={item.name}
                    className="glass glass-hover rounded-xl px-5 py-4 flex items-center justify-between"
                  >
                    <span className="text-white font-medium text-sm">{item.name}</span>
                    <span className="text-[#4a4a5a] text-xs font-mono">{item.desc}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
