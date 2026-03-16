'use client';
import { useStore } from '@/lib/store';
import { motion } from 'framer-motion';

export function UploadProgressBar() {
  const { session } = useStore();
  const progress = session.uploadProgress;

  return (
    <div className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center animate-pulse">
      <div className="text-3xl mb-4">☁️</div>
      <h3 className="text-xl font-medium text-white mb-2">Uploading Video...</h3>
      <p className="text-zinc-400 text-sm mb-6">{progress}% complete</p>
      
      <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
        <motion.div 
          className="h-full bg-indigo-500"
          initial={{ width: '0%' }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.2 }}
        />
      </div>
    </div>
  );
}
