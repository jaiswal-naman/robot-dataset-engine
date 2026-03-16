import { useState, useEffect } from 'react';

export function useElapsedTimer(startTimeIso: string | null) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!startTimeIso) {
      setElapsed(0);
      return;
    }

    const start = new Date(startTimeIso).getTime();
    
    // Immediate calculation
    setElapsed(Math.max(0, Date.now() - start));

    const interval = setInterval(() => {
      setElapsed(Math.max(0, Date.now() - start));
    }, 1000);

    return () => clearInterval(interval);
  }, [startTimeIso]);

  return elapsed;
}

export function formatElapsed(ms: number) {
  if (!ms) return '00:00';
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}
