import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFsChanged } from '../../hooks/useFsChanged';
import type { Target } from './TargetListSidebar';
import type { TargetFile } from './usePortfolio';

/**
 * Owns the `filesByCode` cache and forces a re-fetch for any target whose
 * directory is touched by a `kosmos:fs-changed` mutation. Previously, only
 * the targets list was refreshed on fs-changed; the per-target file list
 * was only loaded once on expand. This hook closes that gap so that LLM
 * tool calls (or future move/rename ops) that write into a target dir
 * immediately reflect in the sidebar.
 */
export function useTargetFilesByCode(
  targets: Target[],
  workspaceDir: string,
  getTargetFiles: (code: string) => Promise<TargetFile[]>,
) {
  const [filesByCode, setFilesByCode] = useState<Record<string, TargetFile[]>>({});
  const filesByCodeRef = useRef(filesByCode);
  filesByCodeRef.current = filesByCode;

  // Map of lower-cased absolute target directory → stock_code, used for
  // reverse-lookup from mutation paths. Note the dir name equals
  // `target.name` (see PortfolioTools.executeInitTarget).
  const targetsByDir = useMemo(() => {
    const m = new Map<string, string>();
    if (!workspaceDir) return m;
    for (const t of targets) {
      const a = `${workspaceDir}\\${t.name}`.toLowerCase();
      const b = `${workspaceDir}/${t.name}`.toLowerCase();
      m.set(a, t.stock_code);
      m.set(b, t.stock_code);
    }
    return m;
  }, [targets, workspaceDir]);

  const loadFiles = useCallback(
    async (code: string, opts?: { force?: boolean }) => {
      if (!opts?.force && filesByCodeRef.current[code]) return;
      const files = await getTargetFiles(code);
      setFilesByCode((prev) => ({ ...prev, [code]: files }));
    },
    [getTargetFiles],
  );

  // Drop cache entries for targets that no longer exist (post-delete).
  useEffect(() => {
    setFilesByCode((prev) => {
      const known = new Set(targets.map((t) => t.stock_code));
      let changed = false;
      const next: Record<string, TargetFile[]> = {};
      for (const k of Object.keys(prev)) {
        if (known.has(k)) next[k] = prev[k];
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [targets]);

  useFsChanged(
    (m) => !!workspaceDir && m.path.toLowerCase().startsWith(workspaceDir.toLowerCase()),
    (matched) => {
      if (targetsByDir.size === 0) return;
      const affected = new Set<string>();
      for (const m of matched) {
        const lower = m.path.toLowerCase();
        for (const [dir, code] of targetsByDir) {
          if (lower === dir || lower.startsWith(dir + '\\') || lower.startsWith(dir + '/')) {
            affected.add(code);
            break;
          }
        }
      }
      // Only refresh codes we've already loaded at least once.
      for (const code of affected) {
        if (filesByCodeRef.current[code]) {
          void loadFiles(code, { force: true });
        }
      }
    },
    [workspaceDir, targetsByDir, loadFiles],
  );

  return { filesByCode, loadFiles };
}
