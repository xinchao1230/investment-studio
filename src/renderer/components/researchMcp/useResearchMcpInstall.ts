import { useState, useEffect, useCallback, useRef } from 'react';

export type InstallState = 'idle' | 'installing' | 'success' | 'error';

export interface InstallProgress {
  stage: string;
  percent: number;
  message?: string;
}

export function useResearchMcpInstall() {
  const [state, setState] = useState<InstallState>('idle');
  const [progress, setProgress] = useState<InstallProgress>({ stage: '', percent: 0 });
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      if (cleanupRef.current) cleanupRef.current();
    };
  }, []);

  const start = useCallback(async () => {
    setState('installing');
    setProgress({ stage: 'detect_uv', percent: 0 });
    setLogs([]);
    setError(null);

    const unsubProgress = window.electronAPI.researchMcp.onProgress((p) => {
      setProgress(p);
    });
    const unsubLog = window.electronAPI.researchMcp.onLog((line) => {
      setLogs((prev) => [...prev.slice(-50), line]);
    });

    cleanupRef.current = () => {
      unsubProgress();
      unsubLog();
    };

    try {
      const result = await window.electronAPI.researchMcp.install();
      unsubProgress();
      unsubLog();
      cleanupRef.current = null;

      if (result.ok) {
        setState('success');
      } else {
        setState('error');
        setError(result.error || 'Unknown error');
      }
    } catch (err: any) {
      unsubProgress();
      unsubLog();
      cleanupRef.current = null;
      setState('error');
      setError(err?.message ?? String(err));
    }
  }, []);

  const cancel = useCallback(async () => {
    await window.electronAPI.researchMcp.cancel();
  }, []);

  const reset = useCallback(() => {
    setState('idle');
    setProgress({ stage: '', percent: 0 });
    setLogs([]);
    setError(null);
  }, []);

  return { state, progress, logs, error, start, cancel, reset };
}
