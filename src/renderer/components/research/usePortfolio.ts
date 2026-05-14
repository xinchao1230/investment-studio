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
  initTarget: (code: string, name: string) => Promise<{ success: boolean; error?: string }>;
  deleteTarget: (code: string) => Promise<{ success: boolean; error?: string }>;
  getTargetFiles: (code: string) => Promise<TargetFile[]>;
}

// Recursively unwrap { success, data } envelopes that may have been JSON-stringified
// multiple times by the builtin-tools IPC layer.
function unwrapToolResult(result: any): any {
  let cur: any = result;
  for (let i = 0; i < 5; i++) {
    if (cur == null) return cur;
    if (typeof cur === 'string') {
      try {
        cur = JSON.parse(cur);
        continue;
      } catch {
        return cur;
      }
    }
    if (typeof cur === 'object' && 'success' in cur && 'data' in cur) {
      if (!cur.success) return null;
      cur = cur.data;
      continue;
    }
    return cur;
  }
  return cur;
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
      console.log('[usePortfolio] portfolio_list_targets result:', result);
      const parsed = unwrapToolResult(result);
      if (Array.isArray(parsed)) {
        setTargets(parsed);
      } else {
        console.warn('[usePortfolio] list_targets unwrap not array:', parsed);
      }
    } catch (err) {
      console.error('[usePortfolio] Failed to list targets:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const initTarget = useCallback(
    async (code: string, name: string): Promise<{ success: boolean; error?: string }> => {
      try {
        const result = await window.electronAPI.builtinTools.execute('portfolio_init_target', {
          stock_code: code,
          name,
        });
        console.log('[usePortfolio] portfolio_init_target result:', result);
        if (!result || !result.success) {
          const error = (result && result.error) || 'Unknown error';
          console.error('[usePortfolio] init_target failed:', error);
          await refresh();
          return { success: false, error };
        }
        await refresh();
        return { success: true };
      } catch (err: any) {
        const msg = err?.message ?? String(err);
        console.error('[usePortfolio] Failed to init target:', err);
        return { success: false, error: msg };
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
        const parsed = unwrapToolResult(result);
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

  const deleteTarget = useCallback(
    async (code: string): Promise<{ success: boolean; error?: string }> => {
      try {
        const result = await window.electronAPI.builtinTools.execute('portfolio_delete_target', {
          stock_code: code,
        });
        console.log('[usePortfolio] portfolio_delete_target result:', result);
        if (!result || !result.success) {
          const error = (result && result.error) || 'Unknown error';
          console.error('[usePortfolio] delete_target failed:', error);
          await refresh();
          return { success: false, error };
        }
        await refresh();
        return { success: true };
      } catch (err: any) {
        const msg = err?.message ?? String(err);
        console.error('[usePortfolio] Failed to delete target:', err);
        return { success: false, error: msg };
      }
    },
    [refresh],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { targets, loading, refresh, initTarget, deleteTarget, getTargetFiles };
}
