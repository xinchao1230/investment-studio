/**
 * useEditableTextFile
 * -------------------
 * State machine for "load a local text file, let the user edit it,
 * save it back safely". Extracted from OverlayFileViewer so the same
 * data-safety guarantees (atomic write, mtime conflict detection,
 * BOM/EOL round-trip, watcher echo suppression) can be reused by the
 * in-page ContentTabs editor and any future inline editor.
 *
 * Lifecycle:
 *   1. Caller passes `{filePath, enabled}`. When `filePath` changes
 *      (or `enabled` flips true), we read via `fs:readTextFileSafe`.
 *   2. Successful read → `status='ready'`, content/metadata captured,
 *      caller can mutate via `setContent`.
 *   3. Each `setContent` that diverges from baseline flips `isDirty`
 *      true and registers the file in the global DirtyEditorsContext.
 *   4. `save()` calls `fs:writeTextFileSafe` with the captured
 *      `{expectedMtimeMs, bom, eol}`. On conflict → `conflictDetected`
 *      true; on success → baseline + mtimeMs updated, `isDirty` false.
 *   5. `reloadFromDisk()` discards in-flight edits and re-reads.
 *
 * Failure modes (never throw, surface via status / error fields):
 *   - File too large (>MAX_EDIT_SIZE_BYTES) → `status='too-large'`,
 *     content still loaded for read-only preview, save() refused.
 *   - UTF-16 / unsupported encoding → `status='unsupported'`,
 *     falls back to raw `fs:readFile` so the user at least sees the
 *     file, save() refused.
 *   - Safe IPC throws or rejects → falls back to raw `fs:readFile`;
 *     `status='ready'` but `fileMeta` null so save() uses atomic-only
 *     mode without conflict detection (still safer than legacy).
 *   - Total load failure → `status='load-error'`, message in
 *     `loadErrorMessage`.
 *
 * Anti-regression: every safe-path failure has a legacy fallback so
 * adopting this hook never makes a file harder to view than it was
 * pre-Phase-5.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { MAX_EDIT_SIZE_BYTES } from '../../constants/editor';
import { useDirtyEditors } from '../../contexts/DirtyEditorsContext';

export type EditableFileStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'too-large'
  | 'unsupported'
  | 'load-error';

export interface SaveResult {
  ok: boolean;
  conflict?: boolean;
  error?: string;
}

export interface UseEditableTextFileOptions {
  filePath: string | null;
  enabled?: boolean;
}

export interface UseEditableTextFileResult {
  status: EditableFileStatus;
  /** Current buffer content (may be edited). null while loading. */
  content: string | null;
  /** Buffer diverges from last saved baseline. */
  isDirty: boolean;
  /** A `save()` is currently in flight. */
  isSaving: boolean;
  /** Last error returned by `save()` (cleared on next save attempt). */
  saveError: string | null;
  /** True if last `save()` was rejected because the file changed on disk. */
  conflictDetected: boolean;
  /** Human-readable explanation when `status` is too-large/unsupported/load-error. */
  loadErrorMessage: string | null;
  /** Detected EOL from on-disk file (preserved on save). */
  eol: 'lf' | 'crlf' | 'mixed' | null;
  /** True if save() should be allowed (status='ready' + isDirty). */
  canSave: boolean;
  /** True if the editor surface should accept input. */
  canEdit: boolean;
  /** Update the in-memory buffer; marks dirty if it diverges from baseline. */
  setContent(next: string): void;
  /** Persist to disk via `fs:writeTextFileSafe`. */
  save(): Promise<SaveResult>;
  /** Discard in-flight edits and re-read from disk. */
  reloadFromDisk(): Promise<void>;
  /** Reset dirty state without touching content (used after parent-driven save). */
  resetDirty(): void;
}

interface FileMeta {
  mtimeMs: number;
  bom: boolean;
  eol: 'lf' | 'crlf' | 'mixed';
  size: number;
}

export function useEditableTextFile(
  options: UseEditableTextFileOptions,
): UseEditableTextFileResult {
  const { filePath, enabled = true } = options;
  const { markDirty, markClean } = useDirtyEditors();

  const [status, setStatus] = useState<EditableFileStatus>('idle');
  const [content, setContentState] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflictDetected, setConflictDetected] = useState(false);
  const [loadErrorMessage, setLoadErrorMessage] = useState<string | null>(null);

  // Mirror of the on-disk content at last read or last successful save.
  // Compared on every setContent to compute `isDirty`.
  const savedContentRef = useRef<string>('');
  // Captured on load, replayed on save. null when the safe reader
  // wasn't available (legacy fallback path) — in that case save()
  // still works but skips the mtime conflict check.
  const fileMetaRef = useRef<FileMeta | null>(null);
  // Track which key we registered in the dirty context so unmount can
  // unregister even if filePath has since changed.
  const registeredKeyRef = useRef<string | null>(null);
  // Cancellation token for the active load — set to true when filePath
  // changes mid-flight so we drop the stale result.
  const loadCancelRef = useRef<{ cancelled: boolean } | null>(null);

  // -----------------------------------------------------------------
  // Dirty registration: any time `isDirty` flips for the current path,
  // mirror it into the global DirtyEditorsContext so app-level guards
  // (beforeunload, route switch, ContentTabs tab close) can see it.
  // -----------------------------------------------------------------
  useEffect(() => {
    if (!filePath) return;
    if (isDirty) {
      registeredKeyRef.current = filePath;
      markDirty(filePath);
    } else if (registeredKeyRef.current === filePath) {
      markClean(filePath);
    }
  }, [filePath, isDirty, markDirty, markClean]);

  // Unmount cleanup: release any lingering dirty registration so a
  // tab close doesn't keep blocking app-quit forever.
  useEffect(() => {
    return () => {
      const key = registeredKeyRef.current;
      if (key) markClean(key);
    };
  }, [markClean]);

  // -----------------------------------------------------------------
  // Load
  // -----------------------------------------------------------------
  const load = useCallback(async () => {
    if (!filePath || !enabled) {
      setStatus('idle');
      setContentState(null);
      setIsDirty(false);
      setSaveError(null);
      setConflictDetected(false);
      setLoadErrorMessage(null);
      fileMetaRef.current = null;
      savedContentRef.current = '';
      return;
    }

    // Cancel any in-flight load.
    if (loadCancelRef.current) loadCancelRef.current.cancelled = true;
    const token = { cancelled: false };
    loadCancelRef.current = token;

    setStatus('loading');
    setContentState(null);
    setIsDirty(false);
    setSaveError(null);
    setConflictDetected(false);
    setLoadErrorMessage(null);
    fileMetaRef.current = null;
    savedContentRef.current = '';

    const api: any = (window as any).electronAPI?.fs;
    const readSafe: ((p: string) => Promise<any>) | undefined = api?.readTextFileSafe;

    // Legacy fallback — used when readTextFileSafe isn't available,
    // throws, or returns success:false. Preserves view access for files
    // that can't be safely round-tripped (e.g. UTF-16).
    const loadViaLegacy = async (statusHint: EditableFileStatus, message: string | null) => {
      try {
        const result: any = await api?.readFile(filePath, 'utf-8');
        if (token.cancelled) return;
        if (result?.success && result.content !== undefined) {
          savedContentRef.current = result.content;
          setContentState(result.content);
          setStatus(statusHint);
          setLoadErrorMessage(message);
        } else {
          setStatus('load-error');
          setLoadErrorMessage(result?.error || message || 'Failed to load file');
        }
      } catch (err) {
        if (token.cancelled) return;
        console.error('[useEditableTextFile] legacy readFile failed:', err);
        setStatus('load-error');
        setLoadErrorMessage(message || 'Failed to load file');
      }
    };

    if (!readSafe) {
      // No safe reader available — fall straight back to legacy.
      await loadViaLegacy('ready', null);
      return;
    }

    try {
      const safe: any = await readSafe(filePath);
      if (token.cancelled) return;

      if (safe?.success) {
        // Size guard. Still surface the content so the user gets a
        // read-only preview, but refuse edits.
        if (typeof safe.size === 'number' && safe.size > MAX_EDIT_SIZE_BYTES) {
          savedContentRef.current = safe.content as string;
          setContentState(safe.content as string);
          fileMetaRef.current = {
            mtimeMs: safe.mtimeMs as number,
            bom: !!safe.bom,
            eol: (safe.eol as 'lf' | 'crlf' | 'mixed') || 'lf',
            size: safe.size as number,
          };
          setStatus('too-large');
          setLoadErrorMessage(
            `文件大小 ${(safe.size / 1024 / 1024).toFixed(1)} MB 超过 ${
              MAX_EDIT_SIZE_BYTES / 1024 / 1024
            } MB 编辑上限，已进入只读预览模式`,
          );
          return;
        }

        savedContentRef.current = safe.content as string;
        setContentState(safe.content as string);
        fileMetaRef.current = {
          mtimeMs: safe.mtimeMs as number,
          bom: !!safe.bom,
          eol: (safe.eol as 'lf' | 'crlf' | 'mixed') || 'lf',
          size: (safe.size as number) ?? 0,
        };
        setStatus('ready');
        return;
      }

      // safe.success === false: known refusal (e.g. UTF-16). Fall back
      // to legacy read so the user can at least view the content; mark
      // unsupported so the UI disables save.
      const message = safe?.error
        ? safe.error.includes('UTF-16')
          ? 'UTF-16 编码文件暂不支持编辑，已进入只读预览模式'
          : `当前文件不支持编辑：${safe.error}`
        : '当前文件不支持编辑，已进入只读预览模式';
      await loadViaLegacy('unsupported', message);
    } catch (err) {
      if (token.cancelled) return;
      console.warn(
        '[useEditableTextFile] readTextFileSafe threw, falling back to legacy:',
        err,
      );
      // IPC threw — fall through rather than surfacing as a hard error,
      // so we never regress vs. pre-Phase-5 behavior.
      await loadViaLegacy('ready', null);
    }
  }, [filePath, enabled]);

  // Trigger load when filePath / enabled changes.
  useEffect(() => {
    void load();
    return () => {
      if (loadCancelRef.current) loadCancelRef.current.cancelled = true;
    };
  }, [load]);

  // -----------------------------------------------------------------
  // Mutate buffer
  // -----------------------------------------------------------------
  const setContent = useCallback((next: string) => {
    setContentState(next);
    setIsDirty(next !== savedContentRef.current);
  }, []);

  const resetDirty = useCallback(() => {
    if (content !== null) savedContentRef.current = content;
    setIsDirty(false);
  }, [content]);

  // -----------------------------------------------------------------
  // Save
  // -----------------------------------------------------------------
  const save = useCallback(async (): Promise<SaveResult> => {
    if (!filePath) return { ok: false, error: 'No file' };
    if (status !== 'ready') {
      return { ok: false, error: '当前状态不允许保存' };
    }
    if (content === null) return { ok: false, error: 'No content' };

    setIsSaving(true);
    setSaveError(null);
    setConflictDetected(false);

    try {
      const api: any = (window as any).electronAPI?.fs;
      const meta = fileMetaRef.current;

      let result: any;
      if (api?.writeTextFileSafe && meta) {
        result = await api.writeTextFileSafe(filePath, content, {
          expectedMtimeMs: meta.mtimeMs,
          bom: meta.bom,
          eol: meta.eol,
        });
      } else if (api?.writeTextFileSafe) {
        // No baseline metadata (legacy load path) — write atomically but
        // skip mtime conflict check.
        result = await api.writeTextFileSafe(filePath, content, {});
      } else {
        // Absolute legacy fallback — preserved so the hook keeps working
        // on older preloads.
        result = await api?.writeFile(filePath, content, 'utf-8');
      }

      if (result?.success) {
        savedContentRef.current = content;
        setIsDirty(false);
        if (result.mtimeMs !== undefined && meta) {
          fileMetaRef.current = { ...meta, mtimeMs: result.mtimeMs };
        }
        return { ok: true };
      }
      if (result?.conflict) {
        setConflictDetected(true);
        const msg = '文件已被其他进程修改。点击 "Reload" 加载最新版本（你的改动会丢失），或保留改动并复制到其他位置。';
        setSaveError(msg);
        return { ok: false, conflict: true, error: msg };
      }
      const msg = result?.error || '保存失败';
      setSaveError(msg);
      return { ok: false, error: msg };
    } catch (err) {
      console.error('[useEditableTextFile] save failed:', err);
      const msg = err instanceof Error ? err.message : '保存失败';
      setSaveError(msg);
      return { ok: false, error: msg };
    } finally {
      setIsSaving(false);
    }
  }, [filePath, status, content]);

  // -----------------------------------------------------------------
  // Reload from disk (discards in-flight edits)
  // -----------------------------------------------------------------
  const reloadFromDisk = useCallback(async () => {
    await load();
  }, [load]);

  const canEdit = status === 'ready';
  const canSave = status === 'ready' && isDirty && !isSaving;

  return {
    status,
    content,
    isDirty,
    isSaving,
    saveError,
    conflictDetected,
    loadErrorMessage,
    eol: fileMetaRef.current?.eol ?? null,
    canSave,
    canEdit,
    setContent,
    save,
    reloadFromDisk,
    resetDirty,
  };
}
