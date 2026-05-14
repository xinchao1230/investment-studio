import { useState, useEffect, useCallback } from 'react';
import { Target } from './TargetListSidebar';

export interface TargetFile {
  relPath: string;
  absPath: string;
  mtime: number;
}

interface PortfolioHook {
  targets: Target[];
  loading: boolean;
  refresh: () => Promise<void>;
  initTarget: (code: string, name: string) => Promise<void>;
  getTargetFiles: (code: string) => Promise<TargetFile[]>;
}

export function usePortfolio(): PortfolioHook {
  const [targets, setTargets] = useState<Target[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const result = await window.electronAPI.builtinTools.execute(
        'portfolio_list_targets',
        {},
      );
      if (result && result.success && result.data) {
        const parsed = typeof result.data === 'string' ? JSON.parse(result.data) : result.data;
        if (Array.isArray(parsed)) {
          setTargets(parsed);
        }
      }
    } catch (err) {
      console.error('[usePortfolio] Failed to list targets:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const initTarget = useCallback(
    async (code: string, name: string) => {
      try {
        await window.electronAPI.builtinTools.execute('portfolio_init_target', {
          stock_code: code,
          name,
        });
        await refresh();
      } catch (err) {
        console.error('[usePortfolio] Failed to init target:', err);
      }
    },
    [refresh],
  );

  const getTargetFiles = useCallback(async (code: string): Promise<TargetFile[]> => {
    try {
      const result = await window.electronAPI.builtinTools.execute(
        'portfolio_get_target_files',
        { stock_code: code },
      );
      if (result && result.success && result.data) {
        const parsed = typeof result.data === 'string' ? JSON.parse(result.data) : result.data;
        if (!Array.isArray(parsed)) return [];
        const files: TargetFile[] = [];
        for (const item of parsed) {
          if (typeof item === 'string') {
            files.push({ relPath: item.split(/[\\/]/).pop() || item, absPath: item, mtime: 0 });
          } else if (item && typeof item === 'object' && (item.absPath || item.path)) {
            const abs = item.absPath ?? item.path;
            files.push({
              relPath: item.relPath ?? item.relativePath ?? (abs.split(/[\\/]/).pop() || abs),
              absPath: abs,
              mtime: typeof item.mtime === 'number' ? item.mtime : 0,
            });
          }
        }
        return files;
      }
      return [];
    } catch (err) {
      console.error('[usePortfolio] Failed to get target files:', err);
      return [];
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { targets, loading, refresh, initTarget, getTargetFiles };
}
