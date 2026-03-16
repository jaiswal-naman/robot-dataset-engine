import Link from 'next/link';

export function FooterSection() {
  return (
    <footer className="py-12 relative">
      <div className="divider" />
      <div className="max-w-6xl mx-auto px-6 pt-12">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2.5">
            <div className="w-5 h-5 bg-gradient-to-br from-indigo-500 to-indigo-600 rounded-md flex items-center justify-center text-[9px] text-white font-bold">A</div>
            <span className="text-[#8b8b9a] text-sm font-medium">
              AutoEgoLab<span className="text-indigo-400">v3</span>
            </span>
          </div>
          <div className="flex gap-8 text-sm text-[#4a4a5a]">
            <Link href="/demo" className="hover:text-white transition-colors">Demo</Link>
            <Link href="/library" className="hover:text-white transition-colors">Library</Link>
            <Link href="https://github.com/autoegolab" className="hover:text-white transition-colors">GitHub</Link>
          </div>
          <p className="text-[#4a4a5a] text-xs">
            © {new Date().getFullYear()} AutoEgoLab. Open source under MIT.
          </p>
        </div>
      </div>
    </footer>
  );
}
