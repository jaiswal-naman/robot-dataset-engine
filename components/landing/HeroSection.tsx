'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';

export function HeroSection() {
  return (
    <section className="relative flex flex-col items-center justify-center min-h-[92vh] overflow-hidden">
      {/* Dot grid background */}
      <div className="absolute inset-0 dot-grid opacity-40" />

      {/* Radial gradient glow */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(99,102,241,0.15)_0%,transparent_70%)]" />

      {/* Floating orbs */}
      <div className="absolute top-1/4 left-1/3 w-[400px] h-[400px] bg-indigo-600/10 rounded-full blur-[120px] float" />
      <div className="absolute bottom-1/4 right-1/3 w-[300px] h-[300px] bg-violet-600/8 rounded-full blur-[100px] float" style={{ animationDelay: '3s' }} />

      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
        className="z-10 text-center max-w-4xl px-6"
      >
        {/* Label badge */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.5 }}
          className="mb-6"
        >
          <span className="badge badge-indigo">
            <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full" />
            AUTONOMOUS ROBOTICS DATA PIPELINE
          </span>
        </motion.div>

        {/* Main heading */}
        <h1 className="text-5xl md:text-7xl lg:text-[5.5rem] font-extrabold text-white leading-[1.05] mb-6 tracking-tight">
          From Video to<br />
          <span className="gradient-text">Robot Actions</span>
          <br />
          <span className="text-[#8b8b9a] text-4xl md:text-5xl font-semibold">in Minutes</span>
        </h1>

        {/* Subheading */}
        <p className="text-[#8b8b9a] text-lg md:text-xl mb-10 max-w-2xl mx-auto leading-relaxed">
          AutoEgoLab v3.0 converts raw factory footage into production-ready
          VLA datasets with zero manual annotation.
        </p>

        {/* CTAs */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.5 }}
          className="flex flex-wrap items-center justify-center gap-4 mb-14"
        >
          <Link href="/demo" className="btn-primary text-base px-8 py-3.5">
            Try Live Demo →
          </Link>
          <Link href="#architecture" className="btn-ghost text-base px-8 py-3.5">
            View Architecture
          </Link>
        </motion.div>

        {/* Stats row */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6, duration: 0.6 }}
          className="flex flex-wrap items-center justify-center gap-6"
        >
          {[
            { value: '7', label: 'AI Agents' },
            { value: '<5min', label: 'Processing' },
            { value: '0', label: 'Manual Annotations' },
          ].map((stat) => (
            <div key={stat.label} className="flex items-center gap-2">
              <span className="text-white font-mono font-bold text-lg">{stat.value}</span>
              <span className="text-[#4a4a5a] text-sm font-medium">{stat.label}</span>
            </div>
          ))}
        </motion.div>
      </motion.div>

      {/* Bottom fade */}
      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-[#0a0a0f] to-transparent" />
    </section>
  );
}
