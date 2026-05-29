/**
 * useEditableTextFile — React hook that manages loading, editing, and saving
 * a single text file via Electron IPC (workspace:readFile / workspace:writeFile).
 */

import { useState, useEffect, useCallback, useRef } from 'react';

export interface SaveResult {
  ok: boolean;
  error?: string;
}

type FileStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'load-error'
  | 'too-large'
  | 'unsupported';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'webp',
  'mp3', 'mp4', 'wav', 'ogg', 'flac',
  'zip', 'tar', 'gz', 'rar', '7z',
  'exe', 'dll', 'so', 'dylib',
  'pdf', 'doc', 'docx', 'xls', 'xlsx',
]);

function getExtension(filePath: string): string {
  const dot = filePath.lastIndexOf('.');
  return dot >= 0 ? filePath.slice(dot + 1).toLowerCase() : '';
}

export interface EditableTextFileState {
  status: FileStatus;
  content: string | null;
  isDirty: boolean;
  isSaving: boolean;
  canEdit: boolean;
  loadErrorMessage: string | null;
  saveError: string | null;
  conflictDetected: boolean;
  canSave: boolean;
  save(): Promise<SaveResult>;
  reloadFromDisk(): Promise<void>;
  setContent(value: string): void;
}

export function useEditableTextFile(opts: {
  filePath: string | null;
  /** When provided, skip the initial disk read and use this value as
   *  both the editor content and the dirty-detection baseline. This
   *  avoids a race where a previous unmount save hasn't flushed to
   *  disk yet. */
  initialContent?: string;
}): EditableTextFileState {
  const { filePath, initialContent } = opts;

  const [status, setStatus] = useState<FileStatus>('idle');
  const [content, setContent] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [loadErrorMessage, setLoadErrorMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflictDetected, setConflictDetected] = useState(false);

  // Track the "on-disk" content to detect conflicts
  const diskContentRef = useRef<string | null>(null);
  const currentPathRef = useRef<string | null>(filePath);

  const loadFile = useCallback(async (fp: string) => {
    setStatus('loading');
    setLoadErrorMessage(null);
    setSaveError(null);
    setConflictDetected(false);
    setIsDirty(false);

    const ext = getExtension(fp);
    if (BINARY_EXTENSIONS.has(ext)) {
      setStatus('unsupported');
      setLoadErrorMessage('Binary files cannot be edited as text.');
      setContent(null);
      return;
    }

    try {
      const result = await window.electronAPI?.fs?.readFile?.(fp, 'utf-8');
      if (!result || !result.success || result.content === undefined) {
        setStatus('load-error');
        setLoadErrorMessage(result?.error ?? 'Failed to read file');
        setContent(null);
        return;
      }
      const text = result.content ?? '';
      if (text.length > MAX_FILE_SIZE) {
        setStatus('too-large');
        setLoadErrorMessage(`File is too large to edit (>${Math.round(MAX_FILE_SIZE / 1024 / 1024)} MB).`);
        setContent(text); // still provide content for read-only display
        return;
      }
      diskContentRef.current = text;
      setContent(text);
      setStatus('ready');
    } catch (err: any) {
      setStatus('load-error');
      setLoadErrorMessage(err?.message ?? 'Unknown error loading file');
      setContent(null);
    }
  }, []);

  // Track whether we used initialContent so we only apply it once per
  // filePath. Without this guard, a re-render with the same
  // initialContent would reset edits in progress.
  const usedInitialRef = useRef(false);

  useEffect(() => {
    currentPathRef.current = filePath;
    usedInitialRef.current = false;
    if (!filePath) {
      setStatus('idle');
      setContent(null);
      setIsDirty(false);
      setLoadErrorMessage(null);
      setSaveError(null);
      return;
    }
    if (initialContent !== undefined) {
      // Use the caller-supplied content as the baseline, skipping
      // the async disk read that may return stale data.
      diskContentRef.current = initialContent;
      setContent(initialContent);
      setStatus('ready');
      setIsDirty(false);
      setLoadErrorMessage(null);
      setSaveError(null);
      usedInitialRef.current = true;
    } else {
      void loadFile(filePath);
    }
  }, [filePath, loadFile]); // initialContent intentionally omitted — only consumed on mount

  const reloadFromDisk = useCallback(async () => {
    const fp = currentPathRef.current;
    if (!fp) return;
    await loadFile(fp);
  }, [loadFile]);

  const handleSetContent = useCallback((value: string) => {
    setContent(value);
    setIsDirty(true);
    setSaveError(null);
    setConflictDetected(false);
  }, []);

  const save = useCallback(async (): Promise<SaveResult> => {
    const fp = currentPathRef.current;
    if (!fp || content === null) {
      return { ok: false, error: 'No file to save' };
    }
    setIsSaving(true);
    setSaveError(null);
    try {
      const result = await window.electronAPI?.fs?.writeFile?.(fp, content, 'utf-8', { conflictResolution: 'replace' });
      if (result && !result.success) {
        const msg = result.error ?? 'Write failed';
        setSaveError(msg);
        return { ok: false, error: msg };
      }
      diskContentRef.current = content;
      setIsDirty(false);
      return { ok: true };
    } catch (err: any) {
      const msg = err?.message ?? 'Unknown error saving file';
      setSaveError(msg);
      return { ok: false, error: msg };
    } finally {
      setIsSaving(false);
    }
  }, [content]);

  const canEdit = status === 'ready';
  const canSave = canEdit && isDirty && !isSaving;

  return {
    status,
    content,
    isDirty,
    isSaving,
    canEdit,
    canSave,
    loadErrorMessage,
    saveError,
    conflictDetected,
    save,
    reloadFromDisk,
    setContent: handleSetContent,
  };
}
