'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';

export function NavBar() {
  return (
    <motion.nav
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="fixed w-full z-50 top-0 border-b border-white/[0.06] bg-[#0a0a0f]/80 backdrop-blur-xl"
    >
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="w-7 h-7 bg-gradient-to-br from-indigo-500 to-indigo-600 rounded-lg flex items-center justify-center text-[11px] font-bold text-white shadow-[0_0_12px_rgba(99,102,241,0.4)] group-hover:shadow-[0_0_20px_rgba(99,102,241,0.6)] transition-shadow">
            A
          </div>
          <span className="text-white font-semibold text-lg tracking-tight">
            AutoEgoLab<span className="text-indigo-400 font-bold">v3</span>
          </span>
        </Link>

        <div className="flex items-center gap-1">
          <Link
            href="https://github.com/autoegolab"
            className="text-[#8b8b9a] hover:text-white px-4 py-2 text-sm font-medium transition-colors"
          >
            GitHub
          </Link>
          <Link
            href="/library"
            className="text-[#8b8b9a] hover:text-white px-4 py-2 text-sm font-medium transition-colors"
          >
            Library
          </Link>
          <Link
            href="/demo"
            className="ml-2 bg-white hover:bg-zinc-100 text-[#0a0a0f] px-5 py-2 rounded-full text-sm font-semibold transition-all hover:shadow-[0_0_20px_rgba(255,255,255,0.15)]"
          >
            Launch Demo →
          </Link>
        </div>
      </div>
    </motion.nav>
  );
}
