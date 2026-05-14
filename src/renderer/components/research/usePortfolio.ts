import { useState, useEffect, useCallback } from 'react';
import { Target } from './TargetListSidebar';

interface PortfolioHook {
  targets: Target[];
  loading: boolean;
  refresh: () => Promise<void>;
  initTarget: (code: string, name: string) => Promise<void>;
  getTargetFiles: (code: string) => Promise<string[]>;
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
      if (result && Array.isArray(result.targets)) {
        setTargets(result.targets);
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

  const getTargetFiles = useCallback(async (code: string): Promise<string[]> => {
    try {
      const result = await window.electronAPI.builtinTools.execute(
        'portfolio_get_target_files',
        { stock_code: code },
      );
      return result?.files ?? [];
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
