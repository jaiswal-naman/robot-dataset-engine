'use client';

import { motion } from 'framer-motion';

const STEPS = [
  {
    number: '01',
    title: 'Upload Video',
    description: 'Securely ingest raw multi-view factory footage directly to our processing core.',
    icon: '📹',
  },
  {
    number: '02',
    title: 'AI Agents Extract Skills',
    description: 'Proprietary agents decompose long-horizon videos into atomic robotic skills and keyframes.',
    icon: '🧠',
  },
  {
    number: '03',
    title: 'Output RLDS Graphs',
    description: 'Export structured RLDS-compliant datasets ready for immediate model training.',
    icon: '📦',
  },
];

export function HowItWorksSection() {
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
          <span className="section-label">Pipeline Flow</span>
          <h2 className="text-4xl md:text-5xl font-bold text-white mt-3">How it Works</h2>
          <p className="text-[#8b8b9a] mt-4 max-w-xl mx-auto text-lg">
            Our automated pipeline from raw pixels to structured actions.
          </p>
        </motion.div>

        <div className="relative">
          {/* Horizontal connecting line (desktop) */}
          <div className="hidden md:block absolute top-16 left-[16%] right-[16%] h-px bg-gradient-to-r from-transparent via-indigo-500/30 to-transparent" />

          <div className="grid md:grid-cols-3 gap-8">
            {STEPS.map((step, i) => (
              <motion.div
                key={step.number}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.15 }}
                className="relative text-center"
              >
                {/* Step number circle */}
                <div className="relative inline-flex items-center justify-center w-14 h-14 rounded-full border border-indigo-500/30 bg-indigo-500/10 mb-6 mx-auto">
                  <span className="text-indigo-400 font-mono font-bold text-sm">{step.number}</span>
                  <div className="absolute inset-0 rounded-full bg-indigo-500/5 pulse-glow" />
                </div>

                <div className="glass rounded-2xl p-6 hover:bg-white/[0.03] transition-colors">
                  <span className="text-2xl mb-3 block">{step.icon}</span>
                  <h3 className="text-white font-semibold text-lg mb-2">{step.title}</h3>
                  <p className="text-[#8b8b9a] text-sm leading-relaxed">{step.description}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
