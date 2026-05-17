import { useState, useEffect, useCallback } from 'react';
import { Target } from './TargetListSidebar';
import { useFsChanged, pathStartsWith } from '../../hooks/useFsChanged';
import { researchChatIpc } from './researchChatIpc';

export interface TargetFile {
  relPath: string;
  absPath: string;
  mtime: number;
}

export type MoveResult =
  | { success: true; finalDestPath: string; renamed: boolean; noop?: boolean }
  | { success: false; code?: string; error: string; existingPath?: string };

interface PortfolioHook {
  targets: Target[];
  loading: boolean;
  workspaceDir: string;
  refresh: () => Promise<void>;
  initTarget: (code: string, name: string) => Promise<{ success: boolean; error?: string }>;
  deleteTarget: (code: string) => Promise<{ success: boolean; error?: string }>;
  getTargetFiles: (code: string) => Promise<TargetFile[]>;
  moveFile: (sourceAbs: string, destDirAbs: string, onConflict?: 'fail' | 'rename' | 'overwrite') => Promise<MoveResult>;
  renameFile: (sourceAbs: string, newName: string) => Promise<MoveResult>;
  trashFile: (sourceAbs: string) => Promise<{ success: boolean; error?: string }>;
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
  // Portfolio workspace absolute path; used as a path prefix to scope
  // `kosmos:fs-changed` subscriptions to mutations inside this folder.
  // Empty string while loading — `pathStartsWith('')` short-circuits to
  // false so we don't refresh on unrelated mutations.
  const [workspaceDir, setWorkspaceDir] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await (window as any).electronAPI?.portfolio?.getWorkspaceDir?.();
        if (cancelled) return;
        if (r?.success && typeof r.data === 'string') {
          setWorkspaceDir(r.data);
        }
      } catch (err) {
        console.warn('[usePortfolio] getWorkspaceDir failed:', err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

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
        // Release any chat sessions bound to this target before trashing it,
        // so the chats survive the deletion as ordinary "Ask Stella" history
        // instead of becoming orphaned rows pointing at a target directory
        // that no longer exists. Best-effort: a failure here is logged but
        // doesn't block the actual delete (which is what the user asked for).
        try {
          await researchChatIpc.unbindTarget(code);
        } catch (unbindErr) {
          console.warn('[usePortfolio] unbindTarget failed (proceeding with delete):', unbindErr);
        }

        const result = await window.electronAPI.builtinTools.execute('portfolio_delete_target', {
          stock_code: code,
        });
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

  // Any mutation inside the portfolio workspace (including LLM-initiated
  // portfolio_init_target / portfolio_delete_target, or generic writeFile /
  // moveFile / downloadAndSaveAs into the workspace) triggers a fresh
  // listing. 80ms debounce in the shared hook coalesces bursts.
  useFsChanged(
    pathStartsWith(workspaceDir),
    () => { void refresh(); },
    [workspaceDir, refresh],
  );

  const moveFile = useCallback(
    async (
      sourceAbs: string,
      destDirAbs: string,
      onConflict: 'fail' | 'rename' | 'overwrite' = 'fail',
    ): Promise<MoveResult> => {
      try {
        const raw = await window.electronAPI.builtinTools.execute('portfolio_move_file', {
          source_abs_path: sourceAbs,
          dest_dir_abs_path: destDirAbs,
          on_conflict: onConflict,
        });
        if (raw && raw.success) {
          const payload = unwrapToolResult(raw) || {};
          return {
            success: true,
            finalDestPath: payload.finalDestPath,
            renamed: !!payload.renamed,
            noop: !!payload.noop,
          };
        }
        let code: string | undefined;
        let existingPath: string | undefined;
        if (raw && typeof raw.data === 'string') {
          try {
            const p = JSON.parse(raw.data);
            code = p.code;
            existingPath = p.existingPath;
          } catch { /* ignore */ }
        }
        return { success: false, code, existingPath, error: raw?.error || 'Move failed' };
      } catch (err: any) {
        return { success: false, error: err?.message || String(err) };
      }
    },
    [],
  );

  const renameFile = useCallback(
    async (sourceAbs: string, newName: string): Promise<MoveResult> => {
      try {
        const raw = await window.electronAPI.builtinTools.execute('portfolio_rename_file', {
          source_abs_path: sourceAbs,
          new_name: newName,
        });
        if (raw && raw.success) {
          const payload = unwrapToolResult(raw) || {};
          return {
            success: true,
            finalDestPath: payload.finalDestPath,
            renamed: false,
            noop: !!payload.noop,
          };
        }
        let code: string | undefined;
        let existingPath: string | undefined;
        if (raw && typeof raw.data === 'string') {
          try {
            const p = JSON.parse(raw.data);
            code = p.code;
            existingPath = p.existingPath;
          } catch { /* ignore */ }
        }
        return { success: false, code, existingPath, error: raw?.error || 'Rename failed' };
      } catch (err: any) {
        return { success: false, error: err?.message || String(err) };
      }
    },
    [],
  );

  const trashFile = useCallback(
    async (sourceAbs: string): Promise<{ success: boolean; error?: string }> => {
      try {
        const r = await (window as any).electronAPI?.portfolio?.trashFile?.(sourceAbs);
        if (!r || typeof r !== 'object') return { success: false, error: 'IPC unavailable' };
        return r;
      } catch (err: any) {
        return { success: false, error: err?.message || String(err) };
      }
    },
    [],
  );

  return { targets, loading, workspaceDir, refresh, initTarget, deleteTarget, getTargetFiles, moveFile, renameFile, trashFile };
}
