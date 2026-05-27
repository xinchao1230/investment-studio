import { useCallback, useEffect, useState } from 'react';

export interface TreeClipboard {
  kind: 'cut';
  absPath: string;
}

/**
 * Local (non-persisted, non-cross-window) clipboard for cut/paste of target
 * tree files. Esc clears the clipboard so the user has a quick escape hatch.
 */
export function useTargetTreeClipboard() {
  const [clipboard, setClipboard] = useState<TreeClipboard | null>(null);

  const setCut = useCallback((absPath: string) => {
    setClipboard({ kind: 'cut', absPath });
  }, []);

  const clear = useCallback(() => setClipboard(null), []);

  useEffect(() => {
    if (!clipboard) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setClipboard(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clipboard]);

  return { clipboard, setCut, clear };
}
