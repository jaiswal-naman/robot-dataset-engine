import Link from 'next/link';
import Image from 'next/image';

export default function Home() {
  return (
    <div className="bg-[#f5f6f8] dark:bg-black font-display text-slate-900 dark:text-slate-100 selection:bg-[#1f44f9]/30 min-h-screen">
      <div className="relative min-h-screen flex flex-col overflow-x-hidden">
        {/* Background Decorations */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[800px] hero-glow pointer-events-none"></div>
        <div className="absolute top-[-10%] right-[-10%] w-[500px] h-[500px] bg-[#1f44f9]/10 blur-[120px] rounded-full"></div>
        <div className="absolute bottom-[-10%] left-[-10%] w-[500px] h-[500px] bg-[#8b5cf6]/5 blur-[120px] rounded-full"></div>

        {/* Navigation */}
        <header className="sticky top-0 z-50 w-full border-b border-white/5 bg-black/50 backdrop-blur-md">
          <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3">
              <div className="size-8 bg-[#1f44f9] rounded flex items-center justify-center">
                <span className="material-symbols-outlined text-white text-xl">deployed_code</span>
              </div>
              <span className="text-xl font-bold tracking-tight text-white">AutoEgoLab <span className="text-[#1f44f9]">v3.0</span></span>
            </Link>
            <nav className="hidden md:flex items-center gap-10">
              <Link href="#" className="text-sm font-medium text-slate-400 hover:text-white transition-colors">Product</Link>
              <Link href="#" className="text-sm font-medium text-slate-400 hover:text-white transition-colors">Solutions</Link>
              <Link href="#" className="text-sm font-medium text-slate-400 hover:text-white transition-colors">Docs</Link>
            </nav>
            <div className="flex items-center gap-6">
              <button className="hidden sm:block text-sm font-medium text-slate-400 hover:text-white transition-colors">Sign In</button>
              <Link href="/demo" className="bg-[#1f44f9] hover:bg-[#1f44f9]/90 text-white px-5 py-2.5 rounded-lg text-sm font-bold transition-all shadow-[0_0_20px_rgba(31,68,249,0.3)]">
                Get Started
              </Link>
            </div>
          </div>
        </header>

        <main className="flex-grow">
          {/* Hero Section */}
          <section className="relative pt-20 pb-32 px-6">
            <div className="max-w-5xl mx-auto text-center">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#1f44f9]/10 border border-[#1f44f9]/20 text-[#1f44f9] text-xs font-bold mb-8 uppercase tracking-widest">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#1f44f9] opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-[#1f44f9]"></span>
                </span>
                New: VLA Dataset Engine
              </div>
              <h1 className="text-5xl md:text-7xl font-bold mb-8 tracking-tight leading-[1.1] text-gradient">
                From Video to Robot <br /> Actions in Minutes
              </h1>
              <p className="text-lg md:text-xl text-slate-400 max-w-2xl mx-auto mb-12 leading-relaxed">
                AutoEgoLab v3.0 converts raw factory footage into production-ready VLA datasets with zero manual annotation.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-20">
                <Link href="/demo" className="w-full sm:w-auto px-8 py-4 bg-[#1f44f9] text-white font-bold rounded-lg shadow-[0_0_30px_rgba(31,68,249,0.4)] hover:scale-[1.02] transition-transform">
                  Try Live Demo
                </Link>
                <Link href="/library" className="w-full sm:w-auto px-8 py-4 bg-white/5 border border-white/10 text-white font-bold rounded-lg hover:bg-white/10 transition-all text-center">
                  View Library
                </Link>
              </div>

              {/* Visualization Frame */}
              <div className="relative group">
                <div className="absolute -inset-1 bg-gradient-to-r from-[#1f44f9] to-[#8b5cf6] rounded-xl blur opacity-20 group-hover:opacity-30 transition duration-1000"></div>
                <div className="relative glass-card rounded-xl overflow-hidden aspect-video shadow-2xl">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="https://lh3.googleusercontent.com/aida-public/AB6AXuBZ1HdtW4wfEAPdKaHdSf1Cgzw_OKV9xK2j2-t7ZDrooM0EsKnSMLY9MoufkizNj3skwP80jg74oX-AaYMZwKT3ur1-TH4gn6ZtF4OZl8QZ5WS0RY9MwTGRyjKF8uPVyeqJQ29dicMHJeswfE83cY9fSg9Wgm1iSkPezfWlHAJIArvkmvwYZn9dqFpC0hPiilW0MI_Y3zYdYTEaBJl_Yg7miOwcalnM83a5D12stmuKxeCaOup5F1CWlmjub22cCzK3LoLhje5ySQo" alt="Background" className="absolute inset-0 w-full h-full object-cover mix-blend-overlay opacity-40 rounded-xl pointer-events-none" />
                  
                  {/* AI Overlay Elements */}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-full h-full p-8 flex flex-col justify-between">
                      <div className="flex justify-between items-start">
                        <div className="glass-card px-4 py-2 rounded-lg border-white/20 text-xs font-mono text-[#1f44f9] flex items-center gap-2">
                          <span className="material-symbols-outlined text-sm">detection_and_zone</span> OBJECT_PERSISTENCE: 99.8%
                        </div>
                        <div className="flex gap-2">
                          <div className="size-2 rounded-full bg-red-500 animate-pulse mt-1"></div>
                          <div className="text-[10px] font-mono text-white/50 uppercase tracking-tighter">Live Inference Stream</div>
                        </div>
                      </div>

                      <div className="relative h-64 w-full">
                        {/* Mock Bounding Boxes */}
                        <div className="absolute top-1/4 left-1/3 w-32 h-32 border-2 border-[#1f44f9] rounded animate-pulse">
                          <div className="absolute -top-6 left-0 bg-[#1f44f9] text-[10px] px-2 py-0.5 text-white font-bold">GRIPPER_01</div>
                        </div>
                        <div className="absolute bottom-1/4 right-1/4 w-40 h-24 border-2 border-[#8b5cf6] rounded">
                          <div className="absolute -top-6 left-0 bg-[#8b5cf6] text-[10px] px-2 py-0.5 text-white font-bold">ASSEMBLY_PART_A</div>
                        </div>
                      </div>

                      <div className="flex justify-center">
                        <div className="glass-card px-6 py-3 rounded-full flex gap-8 items-center border-white/10">
                          <div className="flex flex-col items-center">
                            <span className="text-[10px] text-white/40 uppercase">Frames</span>
                            <span className="text-sm font-bold text-white">4,209</span>
                          </div>
                          <div className="w-px h-6 bg-white/10"></div>
                          <div className="flex flex-col items-center">
                            <span className="text-[10px] text-white/40 uppercase">Keypoints</span>
                            <span className="text-sm font-bold text-white">128</span>
                          </div>
                          <div className="w-px h-6 bg-white/10"></div>
                          <div className="flex flex-col items-center">
                            <span className="text-[10px] text-white/40 uppercase">Action Labels</span>
                            <span className="text-sm font-bold text-white">Auto-Gen</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Features Grid */}
          <section className="py-24 px-6 bg-white/[0.02] border-y border-white/5">
            <div className="max-w-7xl mx-auto">
              <div className="text-center mb-16">
                <h2 className="text-3xl md:text-4xl font-bold mb-4 text-white">Enterprise-Grade Capabilities</h2>
                <p className="text-slate-400">Powering the next generation of robotic foundation models.</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Card 1 */}
                <div className="glass-card p-8 rounded-xl border-white/10 hover:border-[#1f44f9]/50 transition-all group">
                  <div className="size-12 rounded-lg bg-[#1f44f9]/10 flex items-center justify-center mb-6 group-hover:bg-[#1f44f9] transition-colors">
                    <span className="material-symbols-outlined text-[#1f44f9] group-hover:text-white">neurology</span>
                  </div>
                  <h3 className="text-xl font-bold text-white mb-3">Zero-shot VLM</h3>
                  <p className="text-slate-400 text-sm leading-relaxed">
                    Leverage our state-of-the-art vision-language model architecture to understand scene context and intent without any task-specific training.
                  </p>
                </div>
                {/* Card 2 */}
                <div className="glass-card p-8 rounded-xl border-white/10 hover:border-[#1f44f9]/50 transition-all group">
                  <div className="size-12 rounded-lg bg-[#1f44f9]/10 flex items-center justify-center mb-6 group-hover:bg-[#1f44f9] transition-colors">
                    <span className="material-symbols-outlined text-[#1f44f9] group-hover:text-white">track_changes</span>
                  </div>
                  <h3 className="text-xl font-bold text-white mb-3">DINOv2 + SAM Tracking</h3>
                  <p className="text-slate-400 text-sm leading-relaxed">
                    Achieve pixel-perfect object persistence across complex occlusions using fused transformer embeddings and Segment Anything Model.
                  </p>
                </div>
                {/* Card 3 */}
                <div className="glass-card p-8 rounded-xl border-white/10 hover:border-[#1f44f9]/50 transition-all group">
                  <div className="size-12 rounded-lg bg-[#1f44f9]/10 flex items-center justify-center mb-6 group-hover:bg-[#1f44f9] transition-colors">
                    <span className="material-symbols-outlined text-[#1f44f9] group-hover:text-white">cloud_done</span>
                  </div>
                  <h3 className="text-xl font-bold text-white mb-3">Real-time Orchestration</h3>
                  <p className="text-slate-400 text-sm leading-relaxed">
                    Scalable cloud infrastructure designed for massive dataset generation, handling petabytes of factory video data with ultra-low latency.
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* How it Works */}
          <section className="py-32 px-6">
            <div className="max-w-7xl mx-auto">
              <div className="text-center mb-20">
                <h2 className="text-3xl md:text-4xl font-bold mb-4 text-white">How it Works</h2>
                <p className="text-slate-400">Our automated pipeline from raw pixels to structured actions.</p>
              </div>
              <div className="relative">
                {/* Connecting Line (Desktop) */}
                <div className="hidden md:block absolute top-1/2 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-y-1/2"></div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-12 relative">
                  {/* Step 1 */}
                  <div className="flex flex-col items-center text-center group">
                    <div className="size-20 rounded-full glass-card border-white/20 flex items-center justify-center mb-8 relative z-10 group-hover:scale-110 transition-transform bg-black">
                      <span className="material-symbols-outlined text-3xl text-[#1f44f9] z-20">cloud_upload</span>
                      <div className="absolute -top-2 -right-2 size-6 rounded-full bg-[#1f44f9] text-white text-[10px] font-bold flex items-center justify-center z-30">1</div>
                    </div>
                    <h4 className="text-lg font-bold text-white mb-2">Upload Video</h4>
                    <p className="text-slate-400 text-sm max-w-[240px]">
                      Securely ingest raw multi-view factory footage directly to our processing core.
                    </p>
                  </div>
                  {/* Step 2 */}
                  <div className="flex flex-col items-center text-center group">
                    <div className="size-20 rounded-full glass-card border-white/20 flex items-center justify-center mb-8 relative z-10 group-hover:scale-110 transition-transform bg-black">
                      <span className="material-symbols-outlined text-3xl text-[#1f44f9] z-20">hub</span>
                      <div className="absolute -top-2 -right-2 size-6 rounded-full bg-[#1f44f9] text-white text-[10px] font-bold flex items-center justify-center z-30">2</div>
                    </div>
                    <h4 className="text-lg font-bold text-white mb-2">AI Agents Extract Skills</h4>
                    <p className="text-slate-400 text-sm max-w-[240px]">
                      Proprietary agents decompose long-horizon videos into atomic robotic skills and keyframes.
                    </p>
                  </div>
                  {/* Step 3 */}
                  <div className="flex flex-col items-center text-center group">
                    <div className="size-20 rounded-full glass-card border-white/20 flex items-center justify-center mb-8 relative z-10 group-hover:scale-110 transition-transform bg-black">
                      <span className="material-symbols-outlined text-3xl text-[#1f44f9] z-20">account_tree</span>
                      <div className="absolute -top-2 -right-2 size-6 rounded-full bg-[#1f44f9] text-white text-[10px] font-bold flex items-center justify-center z-30">3</div>
                    </div>
                    <h4 className="text-lg font-bold text-white mb-2">Output RLDS Graphs</h4>
                    <p className="text-slate-400 text-sm max-w-[240px]">
                      Export structured RLDS-compliant datasets ready for immediate model training.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* CTA Section */}
          <section className="py-24 px-6">
            <div className="max-w-4xl mx-auto glass-card p-12 rounded-2xl text-center border-[#1f44f9]/20 relative overflow-hidden bg-black/40">
              <div className="absolute top-0 right-0 w-64 h-64 bg-[#1f44f9]/20 blur-[100px] -translate-y-1/2 translate-x-1/2"></div>
              <h2 className="text-3xl md:text-4xl font-bold text-white mb-6 relative z-10">Ready to automate your robot training?</h2>
              <p className="text-slate-400 mb-10 max-w-xl mx-auto relative z-10">Join the leading manufacturers using AutoEgoLab to scale their robotic foundation models 100x faster.</p>
              <div className="flex flex-wrap justify-center gap-4 relative z-10">
                <Link href="/demo" className="px-8 py-3 bg-[#1f44f9] text-white font-bold rounded-lg shadow-lg hover:shadow-[#1f44f9]/40 transition-all">
                  Get Enterprise Access
                </Link>
                <Link href="/demo" className="px-8 py-3 bg-white/5 border border-white/10 text-white font-bold rounded-lg hover:bg-white/10 transition-all">
                  Talk to Sales
                </Link>
              </div>
            </div>
          </section>
        </main>

        {/* Footer */}
        <footer className="border-t border-white/5 py-12 px-6 bg-black z-10">
          <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-8">
            <div className="flex items-center gap-3">
              <div className="size-6 bg-[#1f44f9] rounded flex items-center justify-center">
                <span className="material-symbols-outlined text-white text-xs">deployed_code</span>
              </div>
              <span className="font-bold text-white">AutoEgoLab</span>
            </div>
            <div className="flex gap-8 text-sm text-slate-500">
              <Link className="hover:text-white transition-colors" href="#">Privacy Policy</Link>
              <Link className="hover:text-white transition-colors" href="#">Terms of Service</Link>
              <Link className="hover:text-white transition-colors" href="#">Twitter</Link>
              <Link className="hover:text-white transition-colors" href="#">GitHub</Link>
            </div>
            <div className="text-xs text-slate-600">
              © 2024 AutoEgoLab Inc. All rights reserved.
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
