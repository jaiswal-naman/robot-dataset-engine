'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';

export function CTASection() {
  return (
    <section className="py-28 relative">
      <div className="divider" />
      <div className="max-w-4xl mx-auto px-6 pt-28 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          <h2 className="text-3xl md:text-5xl font-bold text-white mb-4">
            Ready to automate your<br />
            <span className="gradient-text">robot training?</span>
          </h2>
          <p className="text-[#8b8b9a] text-lg max-w-xl mx-auto mb-10">
            Join the leading manufacturers using AutoEgoLab to scale their
            robotic foundation models 100x faster.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <Link href="/demo" className="btn-primary text-base px-10 py-4">
              Start Free Demo →
            </Link>
            <Link href="https://github.com/autoegolab" className="btn-ghost text-base px-8 py-4">
              View on GitHub
            </Link>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
