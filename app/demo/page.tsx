import Link from 'next/link';
import { DemoClient } from '@/components/demo/DemoClient';

export const metadata = { title: 'AutoEgoLab v3 — Live Demo' };

export default function DemoPage() {
  return (
    <div className="bg-[#060812] font-display text-slate-100 min-h-screen">
      <div className="relative flex min-h-screen flex-col overflow-x-hidden">

        {/* ── Header ──────────────────────────────────────────────────── */}
        <header className="flex items-center justify-between border-b border-white/10 bg-[#060812]/50 px-8 py-4 backdrop-blur-md sticky top-0 z-50">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-[#1f44f9]">
              <span className="material-symbols-outlined text-3xl">deployed_code</span>
            </Link>
            <div className="flex flex-col">
              <h2 className="text-lg font-bold leading-none tracking-tight">
                AutoEgoLab <span className="text-[#1f44f9]">v3.0</span>
              </h2>
              <span className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">
                Autonomous Robotics Engine
              </span>
            </div>
          </div>
          <div className="flex flex-1 justify-end gap-6 items-center">
            <nav className="hidden md:flex items-center gap-8 mr-8">
              <Link className="text-sm font-medium hover:text-[#1f44f9] transition-colors" href="/demo">
                Dashboard
              </Link>
              <Link className="text-sm font-medium text-slate-400 hover:text-white transition-colors" href="/library">
                Training Sets
              </Link>
              <Link className="text-sm font-medium text-slate-400 hover:text-white transition-colors" href="#">
                Inference
              </Link>
              <Link className="text-sm font-medium text-slate-400 hover:text-white transition-colors" href="#">
                Settings
              </Link>
            </nav>
            <div className="flex items-center gap-4">
              <button className="flex items-center gap-2 rounded-lg h-10 px-4 bg-[#1f44f9] text-white text-sm font-bold glow-blue hover:bg-[#1f44f9]/90 transition-all">
                <span className="material-symbols-outlined text-sm">precision_manufacturing</span>
                <span>Connect Robot</span>
              </button>
              <div className="h-10 w-10 rounded-full border border-white/20 bg-slate-800 flex items-center justify-center overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className="w-full h-full object-cover"
                  alt="User profile avatar portrait"
                  src="https://lh3.googleusercontent.com/aida-public/AB6AXuAQnjTy_VjhzaJ0vm6y0Z1IUbu6ipO9rlkOo36z0Wj8Y4rvGdgN3mqdfr16akNPc66Bw93LsWye2q-_ionYx2Rdy1exx1wXGBwnT8CAgWuyOKMmAzPy7A8yp8uoD55aalqzhLzQTN94SqCVC2sY1iooyI2eA_MTWwXqP4LBsNPTVPyMJWdcfgyYoiGFoAk9r981NnNHaCcYHEMHtWHeTowCKeuUsAge05Q8lVRPY21L-n1BfRE1o3oJm27F75Sh-s-uKz6KUZFP9Oc"
                />
              </div>
            </div>
          </div>
        </header>

        {/* ── Main — DemoClient handles all interactive state ──────── */}
        <main className="flex flex-1 p-6 gap-6 h-[calc(100vh-73px)] overflow-hidden">
          <DemoClient />
        </main>

      </div>
    </div>
  );
}
