import Link from 'next/link';
import { LibraryClient } from '@/components/library/LibraryClient';

export default function LibraryPage() {
  return (
    <div className="bg-[#f7f5f8] dark:bg-[#0a060e] font-display text-slate-900 dark:text-slate-100 min-h-screen">
      <div className="relative flex flex-col min-h-screen w-full overflow-x-hidden">
        <header className="sticky top-0 z-50 w-full glass-effect border-b border-[#8c25f4]/20 px-6 lg:px-10 py-4">
          <div className="max-w-[1440px] mx-auto flex items-center justify-between gap-8">
            <Link href="/" className="flex items-center gap-3 shrink-0">
              <div className="size-10 bg-[#8c25f4] rounded-lg flex items-center justify-center neon-glow-purple">
                <span className="material-symbols-outlined text-white text-2xl">memory</span>
              </div>
              <div className="flex flex-col">
                <h1 className="text-xl font-bold tracking-tight text-slate-100">AutoEgoLab <span className="text-[#8c25f4] text-xs align-top ml-1">v3.0</span></h1>
                <span className="text-[10px] uppercase tracking-widest text-[#8c25f4] font-bold">Dataset Library</span>
              </div>
            </Link>
            
            <div className="flex-1 max-w-2xl">
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <span className="material-symbols-outlined text-[#8c25f4] group-focus-within:text-[#00f2ff]">psychology</span>
                </div>
                <input 
                  className="w-full bg-[#0a060e]/50 border border-[#8c25f4]/30 rounded-xl py-3 pl-12 pr-4 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#8c25f4]/50 focus:border-[#8c25f4] transition-all glass-effect" 
                  placeholder='Search for standard robotic primitives, e.g., "Grasp red screwdriver"' 
                  type="text"
                />
                <div className="absolute inset-y-0 right-3 flex items-center">
                  <kbd className="hidden sm:inline-block px-2 py-1 text-xs font-semibold text-slate-500 bg-[#0a060e] rounded border border-[#8c25f4]/20">⌘ K</kbd>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-6 shrink-0">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#00ff9d]/10 border border-[#00ff9d]/20">
                <div className="size-2 rounded-full bg-[#00ff9d] animate-pulse"></div>
                <span className="text-xs font-bold text-[#00ff9d] uppercase tracking-wider">System Healthy</span>
              </div>
              
              <div className="flex items-center gap-3 border-l border-[#8c25f4]/20 pl-6">
                <button className="relative p-2 text-slate-400 hover:text-[#8c25f4] transition-colors">
                  <span className="material-symbols-outlined">notifications</span>
                  <span className="absolute top-2 right-2 size-2 bg-[#8c25f4] rounded-full"></span>
                </button>
                <div className="size-10 rounded-full border-2 border-[#8c25f4]/50 overflow-hidden cursor-pointer hover:border-[#8c25f4] transition-all">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="w-full h-full object-cover" alt="User profile avatar" src="https://lh3.googleusercontent.com/aida-public/AB6AXuAh7BMRRllVB8y9xXBMifD1THgPxE4vENsPT-6N1SfKa27rlrMxjxn_JioR33HwwhboOwfOwZ29bEX1qPlhs1kdD4R9XciC5qI0KhUHaLuiqA1vJGr_R7hvAhecRbhNa2QeKgijIVxjhwFJNqcVMgizX376raoT0-pfAAHVZHyJ_sV2jVNsijBFU4_cPvZkhhDm1VB_OzWctOiHop27vP916FJPtekeV0lTW-2UDbMTE9PpOheKntP_5skN9EWOl7n-tSeM5LrZK68"/>
                </div>
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 max-w-[1440px] mx-auto w-full p-6 lg:p-10">
          <div className="flex flex-wrap gap-3 mb-10 items-center">
            <span className="text-sm font-medium text-slate-400 mr-2">Quick Filters:</span>
            <button className="px-4 py-2 rounded-lg bg-[#8c25f4] text-white text-sm font-bold neon-glow-purple">All Skills</button>
            <button className="px-4 py-2 rounded-lg bg-[#191022] border border-[#8c25f4]/20 text-slate-300 text-sm font-medium hover:border-[#8c25f4]/50 transition-colors">Manipulation</button>
            <button className="px-4 py-2 rounded-lg bg-[#191022] border border-[#8c25f4]/20 text-slate-300 text-sm font-medium hover:border-[#8c25f4]/50 transition-colors">Navigation</button>
            <button className="px-4 py-2 rounded-lg bg-[#191022] border border-[#8c25f4]/20 text-slate-300 text-sm font-medium hover:border-[#8c25f4]/50 transition-colors">Assembly</button>
            <button className="px-4 py-2 rounded-lg bg-[#191022] border border-[#8c25f4]/20 text-slate-300 text-sm font-medium hover:border-[#8c25f4]/50 transition-colors flex items-center gap-2">
              <span className="material-symbols-outlined text-sm text-[#00f2ff]">verified</span> High Confidence
            </button>
          </div>

          {/* Live session semantic search — appears when a job is active */}
          <LibraryClient />

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {/* Card 1 */}
            <div className="group flex flex-col bg-[#191022] rounded-xl overflow-hidden border border-[#8c25f4]/10 hover:border-[#8c25f4]/40 transition-all duration-300 hover:shadow-2xl hover:shadow-[#8c25f4]/10">
              <div className="relative aspect-video w-full bg-slate-800 overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" alt="Robotic arm performing precision task" src="https://lh3.googleusercontent.com/aida-public/AB6AXuCWF0-FekpQNJaIRyVFhQIinGM9Qj7TTsYb_Mqh5FG4jB7nOtlNRAtohAiZKrKBtYsS16ojWCAlZJOIPkG7zVID_pBQD08uEsqalj7U-v4u9WDaUOo7V8GsdgYtWcmt8KC6UVqvaT9QFrYoGGIZ_FFPBEx5VE2pfd9gehWSkFy3cpVd1FJd4KwNXlKYlKV23XMCA2Z_f3elReIU5VBaCpb9s_Ex1JQUbZuB73SIhk6wvSpM4pQMYL1URECyFFgXsIAX-KH02KztjFE"/>
                <div className="absolute inset-0 bg-gradient-to-t from-[#0a060e]/80 to-transparent"></div>
                <div className="absolute top-3 right-3 px-2 py-1 bg-[#00f2ff]/20 backdrop-blur-md border border-[#00f2ff]/40 rounded-md flex items-center gap-1.5 neon-glow-blue">
                  <span className="size-1.5 rounded-full bg-[#00f2ff]"></span>
                  <span className="text-[10px] font-bold text-[#00f2ff] uppercase tracking-tighter">98% Confidence</span>
                </div>
              </div>
              <div className="p-6 flex flex-col gap-4">
                <div>
                  <h3 className="text-xl font-bold text-slate-100 mb-2">Task: Pick &amp; Place</h3>
                  <div className="flex flex-wrap gap-2">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold border border-[#8c25f4]/30 text-[#8c25f4] uppercase">Gemini Pro Vision</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold border border-[#8c25f4]/30 text-[#8c25f4] uppercase">SAM 2.0</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold border border-[#8c25f4]/30 text-[#8c25f4] uppercase">DINOv2</span>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 py-3 border-y border-[#8c25f4]/10">
                  <div className="flex flex-col">
                    <span className="text-[10px] uppercase text-slate-500 font-bold">Frames</span>
                    <span className="text-sm font-medium text-slate-200">420</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] uppercase text-slate-500 font-bold">Actions</span>
                    <span className="text-sm font-medium text-slate-200">12</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] uppercase text-slate-500 font-bold">Success</span>
                    <span className="text-sm font-bold text-[#00ff9d]">High</span>
                  </div>
                </div>
                <div className="flex gap-3 pt-2">
                  <button className="flex-1 bg-[#8c25f4] hover:bg-[#8c25f4]/80 text-white text-xs font-bold py-2.5 rounded-lg transition-all border border-[#8c25f4]/50 shadow-lg shadow-[#8c25f4]/20">
                    Export to ALOHA
                  </button>
                  <button className="flex-1 bg-[#0a060e]/40 hover:bg-[#0a060e] border border-[#8c25f4]/20 text-slate-300 text-xs font-bold py-2.5 rounded-lg transition-all">
                    View Task Graph
                  </button>
                </div>
              </div>
            </div>

            {/* Card 2 */}
            <div className="group flex flex-col bg-[#191022] rounded-xl overflow-hidden border border-[#8c25f4]/10 hover:border-[#8c25f4]/40 transition-all duration-300 hover:shadow-2xl hover:shadow-[#8c25f4]/10">
              <div className="relative aspect-video w-full bg-slate-800 overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" alt="Robotic sensor data visualization" src="https://lh3.googleusercontent.com/aida-public/AB6AXuBVfqxUs1qNOF7BT77yeldS6a09ytnu64oPyFK6GsxPtiCZHYwWuAWiwe-Ni3ghcJvZ0v__OIr08xQs4aWZYXP9lUT5ENpQPIara9J4Iaae-UR9WySx-9_YuYNsTqIKV_iYvqMd7v4Uec9bl8mbvVW-LdB4JmrREahiyZ5at8MKsyxnsQ4-d1i7a5ruHa3ujJ5HZEp8EUvRi_3WTyCWDxmCrvgkmyZa3iDbNOoMX5zoS51tY6wUESNnbwfkhW063IzFGRYD_N_LgB8"/>
                <div className="absolute inset-0 bg-gradient-to-t from-[#0a060e]/80 to-transparent"></div>
                <div className="absolute top-3 right-3 px-2 py-1 bg-[#00f2ff]/20 backdrop-blur-md border border-[#00f2ff]/40 rounded-md flex items-center gap-1.5 neon-glow-blue">
                  <span className="size-1.5 rounded-full bg-[#00f2ff]"></span>
                  <span className="text-[10px] font-bold text-[#00f2ff] uppercase tracking-tighter">95% Confidence</span>
                </div>
              </div>
              <div className="p-6 flex flex-col gap-4">
                <div>
                  <h3 className="text-xl font-bold text-slate-100 mb-2">Task: Grasp Screwdriver</h3>
                  <div className="flex flex-wrap gap-2">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold border border-[#8c25f4]/30 text-[#8c25f4] uppercase">SAM 2.0</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold border border-[#8c25f4]/30 text-[#8c25f4] uppercase">DINOv2</span>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 py-3 border-y border-[#8c25f4]/10">
                  <div className="flex flex-col">
                    <span className="text-[10px] uppercase text-slate-500 font-bold">Frames</span>
                    <span className="text-sm font-medium text-slate-200">310</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] uppercase text-slate-500 font-bold">Actions</span>
                    <span className="text-sm font-medium text-slate-200">8</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] uppercase text-slate-500 font-bold">Success</span>
                    <span className="text-sm font-bold text-[#00ff9d]">High</span>
                  </div>
                </div>
                <div className="flex gap-3 pt-2">
                  <button className="flex-1 bg-[#8c25f4] hover:bg-[#8c25f4]/80 text-white text-xs font-bold py-2.5 rounded-lg transition-all border border-[#8c25f4]/50 shadow-lg shadow-[#8c25f4]/20">
                    Export to ALOHA
                  </button>
                  <button className="flex-1 bg-[#0a060e]/40 hover:bg-[#0a060e] border border-[#8c25f4]/20 text-slate-300 text-xs font-bold py-2.5 rounded-lg transition-all">
                    View Task Graph
                  </button>
                </div>
              </div>
            </div>

            {/* Card 3 */}
            <div className="group flex flex-col bg-[#191022] rounded-xl overflow-hidden border border-[#8c25f4]/10 hover:border-[#8c25f4]/40 transition-all duration-300 hover:shadow-2xl hover:shadow-[#8c25f4]/10">
              <div className="relative aspect-video w-full bg-slate-800 overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" alt="AI-controlled factory floor view" src="https://lh3.googleusercontent.com/aida-public/AB6AXuA0Q49zfDms0caUDHK_IdKTkLb1oG3PxzMiV74sJtgk3mlA9dI6Rf1_gi-J3uvnmRsMWLtEhM9hlIbqDNOrDDuDA33EjV97WFQHJbhDaxy9K-n_g8Z3Ky8qifhj-1rDseGxRRSdONXK3SKxatL7TM6MkJgrDNq2RBuBweFXHsfz9rsogKOGEHs8v_VWxy4OV9S7Gvgjy3BGBGC-q58FIXvdATsUF9JUClbCqCrfcCp7MXfCVkD5LTSf_BI6YHTEHFGANq9dQbB3pkY"/>
                <div className="absolute inset-0 bg-gradient-to-t from-[#0a060e]/80 to-transparent"></div>
                <div className="absolute top-3 right-3 px-2 py-1 bg-[#00f2ff]/20 backdrop-blur-md border border-[#00f2ff]/40 rounded-md flex items-center gap-1.5 neon-glow-blue">
                  <span className="size-1.5 rounded-full bg-[#00f2ff]"></span>
                  <span className="text-[10px] font-bold text-[#00f2ff] uppercase tracking-tighter">82% Confidence</span>
                </div>
              </div>
              <div className="p-6 flex flex-col gap-4">
                <div>
                  <h3 className="text-xl font-bold text-slate-100 mb-2">Task: Circuit Assembly</h3>
                  <div className="flex flex-wrap gap-2">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold border border-[#8c25f4]/30 text-[#8c25f4] uppercase">DINOv2</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold border border-[#8c25f4]/30 text-[#8c25f4] uppercase">SAM 2.0</span>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 py-3 border-y border-[#8c25f4]/10">
                  <div className="flex flex-col">
                    <span className="text-[10px] uppercase text-slate-500 font-bold">Frames</span>
                    <span className="text-sm font-medium text-slate-200">560</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] uppercase text-slate-500 font-bold">Actions</span>
                    <span className="text-sm font-medium text-slate-200">22</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] uppercase text-slate-500 font-bold">Success</span>
                    <span className="text-sm font-bold text-yellow-400">Med</span>
                  </div>
                </div>
                <div className="flex gap-3 pt-2">
                  <button className="flex-1 bg-[#8c25f4] hover:bg-[#8c25f4]/80 text-white text-xs font-bold py-2.5 rounded-lg transition-all border border-[#8c25f4]/50 shadow-lg shadow-[#8c25f4]/20">
                    Export to ALOHA
                  </button>
                  <button className="flex-1 bg-[#0a060e]/40 hover:bg-[#0a060e] border border-[#8c25f4]/20 text-slate-300 text-xs font-bold py-2.5 rounded-lg transition-all">
                    View Task Graph
                  </button>
                </div>
              </div>
            </div>

            {/* Card 4 */}
            <div className="group flex flex-col bg-[#191022] rounded-xl overflow-hidden border border-[#8c25f4]/10 hover:border-[#8c25f4]/40 transition-all duration-300 hover:shadow-2xl hover:shadow-[#8c25f4]/10">
              <div className="relative aspect-video w-full bg-slate-800 overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" alt="Close up of robotic gripper" src="https://lh3.googleusercontent.com/aida-public/AB6AXuD2TV6GMTUsneg9tm8SYAEpKv3tvV3JKwRXTyv_i3B0k6ecqTgC97FXehq1V0EH1uyI5NOtFdBoVuVHYJ9RdLVrTLjbgweqmz3i9_dPGkfM6n2Ceikbalb_utEeCD1PbE_ZhWxeqzYYjeVn6zBhrtOlOMm1YXACmuxIP9mSa3FmGtvJAY6OXDBCrQtGRnCPGKTit4umaRd1oboMIwiAC6uWPJa2dUxGh6MvlohFSkJQwkIuyGE-27XawrUF-HjVpBuDPAsIzSikAGQ"/>
                <div className="absolute inset-0 bg-gradient-to-t from-[#0a060e]/80 to-transparent"></div>
                <div className="absolute top-3 right-3 px-2 py-1 bg-[#00f2ff]/20 backdrop-blur-md border border-[#00f2ff]/40 rounded-md flex items-center gap-1.5 neon-glow-blue">
                  <span className="size-1.5 rounded-full bg-[#00f2ff]"></span>
                  <span className="text-[10px] font-bold text-[#00f2ff] uppercase tracking-tighter">91% Confidence</span>
                </div>
              </div>
              <div className="p-6 flex flex-col gap-4">
                <div>
                  <h3 className="text-xl font-bold text-slate-100 mb-2">Task: Pour Liquid</h3>
                  <div className="flex flex-wrap gap-2">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold border border-[#8c25f4]/30 text-[#8c25f4] uppercase">RT-X</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold border border-[#8c25f4]/30 text-[#8c25f4] uppercase">SAM 2.0</span>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 py-3 border-y border-[#8c25f4]/10">
                  <div className="flex flex-col">
                    <span className="text-[10px] uppercase text-slate-500 font-bold">Frames</span>
                    <span className="text-sm font-medium text-slate-200">400</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] uppercase text-slate-500 font-bold">Actions</span>
                    <span className="text-sm font-medium text-slate-200">15</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] uppercase text-slate-500 font-bold">Success</span>
                    <span className="text-sm font-bold text-[#00ff9d]">High</span>
                  </div>
                </div>
                <div className="flex gap-3 pt-2">
                  <button className="flex-1 bg-[#8c25f4] hover:bg-[#8c25f4]/80 text-white text-xs font-bold py-2.5 rounded-lg transition-all border border-[#8c25f4]/50 shadow-lg shadow-[#8c25f4]/20">
                    Export to ALOHA
                  </button>
                  <button className="flex-1 bg-[#0a060e]/40 hover:bg-[#0a060e] border border-[#8c25f4]/20 text-slate-300 text-xs font-bold py-2.5 rounded-lg transition-all">
                    View Task Graph
                  </button>
                </div>
              </div>
            </div>

            {/* Card 5 */}
            <div className="group flex flex-col bg-[#191022] rounded-xl overflow-hidden border border-[#8c25f4]/10 hover:border-[#8c25f4]/40 transition-all duration-300 hover:shadow-2xl hover:shadow-[#8c25f4]/10">
              <div className="relative aspect-video w-full bg-slate-800 overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" alt="Microchip and circuitry view" src="https://lh3.googleusercontent.com/aida-public/AB6AXuD0mBssVHNMDqUh7hoje_DDKRNYWP8wZGjhFkcB3GiwsuFh1NYRmE1f10yDI4yd6QbdDi-fGOPdezo3R_35E00XhkhygcPOS5F_SZZQfJCAb9_QVS9i8sVoY4ci3xYBmojqlvLI3myhU2zP_9DidB5EAfncB9ZMlyP0KHyNbSADhaqwDa39uoaaih9MFk5OsQIee4uYP6jaOWUdv0txnedRpNDXSNAwiyZcCp03SyX1Kjn3HXzphvnfVzYGXBmP3Sbyv7qnxKz8T5c"/>
                <div className="absolute inset-0 bg-gradient-to-t from-[#0a060e]/80 to-transparent"></div>
                <div className="absolute top-3 right-3 px-2 py-1 bg-[#00f2ff]/20 backdrop-blur-md border border-[#00f2ff]/40 rounded-md flex items-center gap-1.5 neon-glow-blue">
                  <span className="size-1.5 rounded-full bg-[#00f2ff]"></span>
                  <span className="text-[10px] font-bold text-[#00f2ff] uppercase tracking-tighter">74% Confidence</span>
                </div>
              </div>
              <div className="p-6 flex flex-col gap-4">
                <div>
                  <h3 className="text-xl font-bold text-slate-100 mb-2">Task: Fold Cloth</h3>
                  <div className="flex flex-wrap gap-2">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold border border-[#8c25f4]/30 text-[#8c25f4] uppercase">Gemini Pro Vision</span>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 py-3 border-y border-[#8c25f4]/10">
                  <div className="flex flex-col">
                    <span className="text-[10px] uppercase text-slate-500 font-bold">Frames</span>
                    <span className="text-sm font-medium text-slate-200">890</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] uppercase text-slate-500 font-bold">Actions</span>
                    <span className="text-sm font-medium text-slate-200">30</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] uppercase text-slate-500 font-bold">Success</span>
                    <span className="text-sm font-bold text-yellow-400">Med</span>
                  </div>
                </div>
                <div className="flex gap-3 pt-2">
                  <button className="flex-1 bg-[#8c25f4] hover:bg-[#8c25f4]/80 text-white text-xs font-bold py-2.5 rounded-lg transition-all border border-[#8c25f4]/50 shadow-lg shadow-[#8c25f4]/20">
                    Export to ALOHA
                  </button>
                  <button className="flex-1 bg-[#0a060e]/40 hover:bg-[#0a060e] border border-[#8c25f4]/20 text-slate-300 text-xs font-bold py-2.5 rounded-lg transition-all">
                    View Task Graph
                  </button>
                </div>
              </div>
            </div>

            {/* Card 6 */}
            <div className="group flex flex-col bg-[#191022] rounded-xl overflow-hidden border border-[#8c25f4]/10 hover:border-[#8c25f4]/40 transition-all duration-300 hover:shadow-2xl hover:shadow-[#8c25f4]/10">
              <div className="relative aspect-video w-full bg-slate-800 overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" alt="Abstract digital grid technology" src="https://lh3.googleusercontent.com/aida-public/AB6AXuD7TeQmt9TXPVBEAX8h7nS9EXqIbV8nXHpXgrqLbFqYtSZQDStqSL0H6B-edD75BOWIjVQzvJXQGqesV0f4cEmc3ubr8ZX6ZAiHzCeRLMDMwXICnPjIFuZolo0pgFMkxach-qRN4Vb8V_JB_M6rHMum9m5fOuHqIpR1Dgq7_YD8HwaKe-jEOXRC2fEQlR8VcBkzGsXybw7fgWcY8kGnTb2mCT4XFZJecjve8KQsb5C8x4V2-4eRer3ZacxiEbfaEP1xmEcMUpAD1VI"/>
                <div className="absolute inset-0 bg-gradient-to-t from-[#0a060e]/80 to-transparent"></div>
                <div className="absolute top-3 right-3 px-2 py-1 bg-[#00f2ff]/20 backdrop-blur-md border border-[#00f2ff]/40 rounded-md flex items-center gap-1.5 neon-glow-blue">
                  <span className="size-1.5 rounded-full bg-[#00f2ff]"></span>
                  <span className="text-[10px] font-bold text-[#00f2ff] uppercase tracking-tighter">99% Confidence</span>
                </div>
              </div>
              <div className="p-6 flex flex-col gap-4">
                <div>
                  <h3 className="text-xl font-bold text-slate-100 mb-2">Task: Nav Mesh Generation</h3>
                  <div className="flex flex-wrap gap-2">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold border border-[#8c25f4]/30 text-[#8c25f4] uppercase">RT-2</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold border border-[#8c25f4]/30 text-[#8c25f4] uppercase">CLIP</span>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 py-3 border-y border-[#8c25f4]/10">
                  <div className="flex flex-col">
                    <span className="text-[10px] uppercase text-slate-500 font-bold">Frames</span>
                    <span className="text-sm font-medium text-slate-200">1200</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] uppercase text-slate-500 font-bold">Actions</span>
                    <span className="text-sm font-medium text-slate-200">45</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] uppercase text-slate-500 font-bold">Success</span>
                    <span className="text-sm font-bold text-[#00ff9d]">High</span>
                  </div>
                </div>
                <div className="flex gap-3 pt-2">
                  <button className="flex-1 bg-[#8c25f4] hover:bg-[#8c25f4]/80 text-white text-xs font-bold py-2.5 rounded-lg transition-all border border-[#8c25f4]/50 shadow-lg shadow-[#8c25f4]/20">
                    Export to ALOHA
                  </button>
                  <button className="flex-1 bg-[#0a060e]/40 hover:bg-[#0a060e] border border-[#8c25f4]/20 text-slate-300 text-xs font-bold py-2.5 rounded-lg transition-all">
                    View Task Graph
                  </button>
                </div>
              </div>
            </div>
          </div>
        </main>

        <footer className="mt-auto py-8 border-t border-[#8c25f4]/10 glass-effect">
          <div className="max-w-[1440px] mx-auto px-6 lg:px-10 flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-6">
              <p className="text-xs text-slate-500 font-medium tracking-wide">© 2024 AUTOEGOLAB CORE SYSTEMS</p>
              <div className="flex items-center gap-4 text-xs font-bold text-[#8c25f4] tracking-widest uppercase">
                <Link className="hover:text-[#00f2ff] transition-colors" href="#">Documentation</Link>
                <Link className="hover:text-[#00f2ff] transition-colors" href="#">API Access</Link>
              </div>
            </div>
            <div className="flex items-center gap-6 text-slate-400">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-sm">cloud_done</span>
                <span className="text-xs uppercase font-bold tracking-tighter">Cloud Sync Active</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-sm">database</span>
                <span className="text-xs uppercase font-bold tracking-tighter">14.2TB Library</span>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
