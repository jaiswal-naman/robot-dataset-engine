'use client';

import { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { useStore } from '@/lib/store';
import { uploadVideoXHR, computeFileSha256 } from '@/lib/api/upload';

export function UploadZone() {
  const { setJobId, setJobToken, setIsUploading, setUploadProgress } = useStore();

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;
    
    if (file.size > 300 * 1024 * 1024) {
      alert('File too large. Maximum 300MB.');
      return;
    }
    
    setIsUploading(true);
    
    try {
      const sha256 = await computeFileSha256(file);
      const initResponse = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_name: file.name,
          file_size_bytes: file.size,
          mime_type: file.type,
          sha256,
        }),
      });
      
      const { job_id, job_access_token, upload } = await initResponse.json();
      
      localStorage.setItem(`ael_token_${job_id}`, job_access_token);
      setJobId(job_id);
      setJobToken(job_access_token);
      
      await uploadVideoXHR(upload.signed_url, file, (pct) => setUploadProgress(pct));
      
      await fetch('/api/process', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${job_access_token}`,
        },
        body: JSON.stringify({ job_id }),
      });
      
      setIsUploading(false);
    } catch (err) {
      setIsUploading(false);
      console.error('Upload failed:', err);
      alert('Upload failed. Check console for details.');
    }
  }, [setJobId, setJobToken, setIsUploading, setUploadProgress]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'video/mp4': ['.mp4'] },
    maxFiles: 1,
    multiple: false,
  });

  return (
    <div
      {...getRootProps()}
      className={`
        relative overflow-hidden
        border-2 border-dashed rounded-2xl p-16 text-center cursor-pointer
        transition-all duration-300
        ${isDragActive
          ? 'border-indigo-400 bg-indigo-500/10 shadow-[0_0_40px_rgba(99,102,241,0.15)]'
          : 'border-white/[0.1] hover:border-white/[0.2] hover:bg-white/[0.02]'
        }
      `}
    >
      <input {...getInputProps()} />

      {/* Glow orb when dragging */}
      {isDragActive && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-48 h-48 bg-indigo-500/20 rounded-full blur-[80px]" />
        </div>
      )}

      <div className="relative z-10">
        <div className="text-5xl mb-5">🎬</div>
        <p className="text-lg font-semibold text-white mb-2">
          {isDragActive ? 'Drop your video here' : 'Upload Factory Footage'}
        </p>
        <p className="text-[#8b8b9a] text-sm mb-6">
          Drag & drop or click to browse
        </p>
        <div className="flex items-center justify-center gap-4 text-xs text-[#4a4a5a] font-mono">
          <span>MP4, MOV</span>
          <span className="w-1 h-1 bg-[#4a4a5a] rounded-full" />
          <span>Up to 5 min</span>
          <span className="w-1 h-1 bg-[#4a4a5a] rounded-full" />
          <span>Max 300MB</span>
        </div>
      </div>
    </div>
  );
}
