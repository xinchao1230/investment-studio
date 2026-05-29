/**
 * EditableMonacoPane
 * ------------------
 * Self-contained editor surface that:
 *   - Loads the file via `useEditableTextFile` (which handles size /
 *     encoding / conflict / atomic write under the hood),
 *   - Renders a Monaco instance bound to the buffer,
 *   - Surfaces a save-error / conflict banner with a "Reload from
 *     disk" affordance,
 *   - Wires Ctrl+S / Cmd+S to `save()`,
 *   - Exposes an imperative handle so a parent toolbar (e.g.
 *     ContentTabs' Save button) can drive save/dirty state without
 *     prop drilling state through the tab tree.
 *
 * Read-only modes:
 *   - `status='too-large'` → 5 MB+ files render in a read-only Monaco
 *     with a warning banner.
 *   - `status='unsupported'` → UTF-16 etc. render in read-only with
 *     a different banner.
 *
 * Lifecycle: Monaco is created once per `filePath` and disposed on
 * unmount or path change. Content updates after the first mount are
 * applied via `editor.setValue(...)` to preserve undo history within
 * a session and avoid the flash of a fresh editor instance.
 *
 * No regression with OverlayFileViewer: this pane is a NEW component;
 * OverlayFileViewer keeps its inlined Monaco. Phase 6 may consolidate.
 */

import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import type * as monaco from 'monaco-editor';
import { AlertTriangle, RotateCw } from 'lucide-react';

import {
  useEditableTextFile,
  type SaveResult,
} from './useEditableTextFile';
import './EditableMonacoPane.css';

export interface EditableMonacoPaneHandle {
  save(): Promise<SaveResult>;
  isDirty(): boolean;
  getContent(): string;
  reloadFromDisk(): Promise<void>;
  /** Focus the underlying Monaco editor (its hidden textarea). Safe
   *  to call even before the async mount completes — it's a no-op
   *  until the editor exists. */
  focus(): void;
  /** Open Monaco's built-in find widget. No-op if the editor hasn't
   *  finished mounting yet. */
  triggerFind(): void;
}

export interface EditableMonacoPaneProps {
  /** Absolute file path. null/undefined → renders empty state. */
  filePath: string | null;
  /** Monaco language id (e.g. 'markdown', 'csv', 'plaintext'). Defaults to 'plaintext'. */
  language?: string;
  /** Optional cached content. When provided, the editor initializes
   *  from this value instead of reading from disk, avoiding a race
   *  when a previous unmount save hasn't flushed yet. The hook still
   *  treats this as the baseline for dirty detection. */
  initialContent?: string;
  /** Called every time isDirty changes — parent uses this to drive a Save button. */
  onDirtyChange?(dirty: boolean): void;
  /** Called after a successful save with the just-written content so
   *  upstream caches (e.g. ResearchPage's fileContentCacheRef) can
   *  refresh without waiting for a watcher echo (which is suppressed
   *  for our own writes). */
  onSaved?(filePath: string, content: string): void;
  /** Called whenever a save() goes in-flight / finishes. Useful for a
   *  saving status indicator next to the toolbar. */
  onSavingChange?(saving: boolean): void;
  /** When true, schedules a debounced save on every buffer change.
   *  Ctrl+S still works to force an immediate save. Defaults to false. */
  autoSave?: boolean;
  /** Debounce window for auto-save, in ms. Defaults to 500. */
  autoSaveDelay?: number;
  /** Force read-only regardless of file status. */
  readOnly?: boolean;
  className?: string;
}

const EditableMonacoPane = forwardRef<
  EditableMonacoPaneHandle,
  EditableMonacoPaneProps
>(function EditableMonacoPane(
  { filePath, language = 'plaintext', initialContent, onDirtyChange, onSaved, onSavingChange, autoSave = false, autoSaveDelay = 500, readOnly = false, className },
  ref,
) {
  const file = useEditableTextFile({ filePath, initialContent });
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const onSavingChangeRef = useRef(onSavingChange);
  onSavingChangeRef.current = onSavingChange;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const changeDisposableRef = useRef<{ dispose(): void } | null>(null);
  // Debounce timer for autoSave. Cleared on every keystroke; flushed
  // on Ctrl+S, blur, and unmount so we never lose a pending edit.
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Captured props mirrored into refs so closures don't depend on them.
  const autoSaveRef = useRef(autoSave);
  autoSaveRef.current = autoSave;
  const autoSaveDelayRef = useRef(autoSaveDelay);
  autoSaveDelayRef.current = autoSaveDelay;
  // Set true around programmatic editor.setValue() (e.g. reloadFromDisk)
  // so the onDidChangeModelContent listener doesn't re-flag the buffer
  // as dirty against itself.
  const suppressNextChangeRef = useRef(false);
  // `file.save` / etc. change identity on every render; mirror in a
  // ref so the keydown listener captures the latest without
  // re-registering on each keystroke.
  const fileApiRef = useRef(file);
  fileApiRef.current = file;

  // -----------------------------------------------------------------
  // Imperative handle for parent toolbars.
  // -----------------------------------------------------------------
  useImperativeHandle(
    ref,
    () => ({
      save: async () => {
        const result = await fileApiRef.current.save();
        if (result.ok && filePath && onSavedRef.current) {
          try {
            onSavedRef.current(filePath, fileApiRef.current.content ?? '');
          } catch (e) {
            // eslint-disable-next-line no-console
            console.warn('[EditableMonacoPane] onSaved callback threw', e);
          }
        }
        return result;
      },
      isDirty: () => fileApiRef.current.isDirty,
      getContent: () => fileApiRef.current.content ?? '',
      reloadFromDisk: async () => {
        await fileApiRef.current.reloadFromDisk();
        // After reload, the hook's content has updated. Push it into
        // the live editor so the user sees the on-disk version.
        const editor = editorRef.current;
        const next = fileApiRef.current.content;
        if (editor && next !== null && editor.getValue() !== next) {
          suppressNextChangeRef.current = true;
          editor.setValue(next);
        }
      },
      focus: () => {
        editorRef.current?.focus();
      },
      triggerFind: () => {
        const editor = editorRef.current;
        if (!editor) return;
        editor.focus();
        // 'actions.find' is Monaco's standard find action id. Wrapped
        // in try/catch in case a future Monaco version renames it.
        try {
          editor.getAction('actions.find')?.run();
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn('[EditableMonacoPane] triggerFind failed', e);
        }
      },
    }),
    [filePath],
  );

  // -----------------------------------------------------------------
  // Propagate dirty state up.
  // -----------------------------------------------------------------
  useEffect(() => {
    onDirtyChange?.(file.isDirty);
  }, [file.isDirty, onDirtyChange]);

  // -----------------------------------------------------------------
  // Propagate saving state up.
  // -----------------------------------------------------------------
  useEffect(() => {
    onSavingChangeRef.current?.(file.isSaving);
  }, [file.isSaving]);

  // -----------------------------------------------------------------
  // Internal save helper used by both Ctrl+S and the autoSave timer.
  // Mirrors what the imperative `save()` does so onSaved fires
  // identically regardless of trigger.
  // -----------------------------------------------------------------
  const performSaveRef = useRef<() => Promise<void>>(async () => undefined);
  performSaveRef.current = async () => {
    if (!fileApiRef.current.canSave) return;
    const path = filePath;
    const result = await fileApiRef.current.save();
    if (result.ok && path && onSavedRef.current) {
      try {
        onSavedRef.current(path, fileApiRef.current.content ?? '');
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[EditableMonacoPane] onSaved callback threw', e);
      }
    }
  };

  // -----------------------------------------------------------------
  // Mount Monaco when we have content and a container. Re-mount when
  // filePath changes (so undo history doesn't carry across files).
  //
  // We deliberately depend on `contentReady` (not file.content) so
  // we mount exactly once per file load — typing into the buffer
  // mutates file.content but must NOT re-mount Monaco.
  // -----------------------------------------------------------------
  // Mount only after the hook has settled into a state where it
  // knows the file contents AND knows whether editing is allowed.
  // Mounting earlier (e.g. when content arrives but status is still
  // transitioning) leaves a race where Monaco initializes with
  // readOnly=true and the subsequent updateOptions effect never
  // re-fires because editorRef.current was set asynchronously
  // without triggering a React re-render.
  const statusSettled =
    file.status === 'ready' ||
    file.status === 'too-large' ||
    file.status === 'unsupported';
  // Capture readOnly at mount-time from current render state (not via
  // ref) so the closure has consistent values.
  const initialReadOnlyAtMount =
    readOnly || file.status !== 'ready' || !file.canEdit;
  useEffect(() => {
    if (!containerRef.current) return;
    if (!statusSettled) return;

    const container = containerRef.current;
    let disposed = false;
    const initialValue = file.content ?? '';
    const initialReadOnly = initialReadOnlyAtMount;

    import(/* webpackChunkName: "monaco-editor" */ 'monaco-editor').then(
      (monacoModule) => {
        if (disposed || !container) return;

        const editor = monacoModule.editor.create(container, {
          value: initialValue,
          language,
          theme: 'vs-dark',
          automaticLayout: true,
          minimap: { enabled: false },
          fontSize: 13,
          fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
          lineHeight: 21,
          padding: { top: 12, bottom: 12 },
          scrollBeyondLastLine: false,
          // CSV needs strict column alignment; everything else (markdown,
          // plaintext, …) is more comfortable to edit with soft-wrap so
          // long lines don't force a horizontal scrollbar.
          wordWrap: language === 'csv' ? 'off' : 'on',
          wrappingIndent: 'same',
          tabSize: 2,
          insertSpaces: true,
          renderWhitespace: 'none',
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
          overviewRulerBorder: false,
          scrollbar: {
            verticalScrollbarSize: 10,
            horizontalScrollbarSize: 10,
          },
          readOnly: initialReadOnly,
          contextmenu: true,
          quickSuggestions: false,
          parameterHints: { enabled: false },
          suggestOnTriggerCharacters: false,
          acceptSuggestionOnEnter: 'off',
          tabCompletion: 'off',
          wordBasedSuggestions: 'off',
        });

        editorRef.current = editor;

        changeDisposableRef.current = editor.onDidChangeModelContent(() => {
          if (suppressNextChangeRef.current) {
            suppressNextChangeRef.current = false;
            return;
          }
          // Push the buffer back into the hook so isDirty / canSave
          // stay in sync. The hook compares against its own baseline
          // (savedContentRef) so this is cheap.
          fileApiRef.current.setContent(editor.getValue());

          // Debounced auto-save.
          if (autoSaveRef.current) {
            if (autoSaveTimerRef.current) {
              clearTimeout(autoSaveTimerRef.current);
            }
            autoSaveTimerRef.current = setTimeout(() => {
              autoSaveTimerRef.current = null;
              void performSaveRef.current();
            }, autoSaveDelayRef.current);
          }
        });

        if (fileApiRef.current.canEdit) {
          editor.focus();
        }
      },
    );

    return () => {
      disposed = true;
      const editor = editorRef.current;
      // Flush any pending auto-save so we don't lose the last
      // keystroke when the editor unmounts (tab switch, file change,
      // window close).
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
      // Synchronously capture the editor content before disposal.
      // The async save() depends on React state which may already be
      // stale after unmount, so we grab the value from the live
      // Monaco model and write it directly. This also pushes the
      // content into the parent's cache via onSaved so the view-mode
      // tab shows up-to-date text without waiting for the write to
      // hit disk.
      if (editor && filePath) {
        const latestContent = editor.getValue();
        const baseline = fileApiRef.current.content;
        const dirty = latestContent !== (baseline ?? '');
        if (dirty) {
          // Fire the write and notify the parent cache synchronously
          // (the callback itself is sync; only the IPC is async).
          window.electronAPI?.fs?.writeFile?.(filePath, latestContent, 'utf-8', { conflictResolution: 'replace' })
            ?.catch?.((err: unknown) => {
              console.warn('[EditableMonacoPane] unmount save failed', err);
            });
          if (onSavedRef.current) {
            try { onSavedRef.current(filePath, latestContent); } catch { /* */ }
          }
        }
      }
      changeDisposableRef.current?.dispose();
      changeDisposableRef.current = null;
      editorRef.current?.dispose();
      editorRef.current = null;
    };
    // We deliberately depend only on filePath + language + statusSettled:
    // switching files / language remounts Monaco; content arriving for
    // the first time triggers the initial mount. We do NOT depend on
    // file.content (typing must NOT remount) or on canEdit/status
    // (those are captured at create-time; transitions only happen
    // pre-mount in normal flow).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, language, statusSettled]);

  // -----------------------------------------------------------------
  // Ctrl+S / Cmd+S to save. Listener is window-level but only fires
  // when the editor is focused, so it never hijacks the rest of the
  // app.
  // -----------------------------------------------------------------
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== 's') return;
      const editor = editorRef.current;
      if (!editor || !editor.hasTextFocus()) return;
      if (!fileApiRef.current.canSave) return;
      e.preventDefault();
      // Cancel any pending debounced save and fire immediately.
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
      void performSaveRef.current();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [filePath]);

  // -----------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------
  if (!filePath) {
    return (
      <div className={`editable-pane editable-pane-empty ${className ?? ''}`}>
        <span className="editable-pane-empty-text">No file selected</span>
      </div>
    );
  }

  if (file.status === 'loading' || file.status === 'idle') {
    return (
      <div className={`editable-pane editable-pane-loading ${className ?? ''}`}>
        <span className="editable-pane-loading-text">Loading…</span>
      </div>
    );
  }

  if (file.status === 'load-error') {
    return (
      <div className={`editable-pane editable-pane-error ${className ?? ''}`}>
        <AlertTriangle size={20} />
        <span>{file.loadErrorMessage ?? 'Failed to load'}</span>
        <button
          type="button"
          className="editable-pane-retry"
          onClick={() => void file.reloadFromDisk()}
        >
          <RotateCw size={14} /> Retry
        </button>
      </div>
    );
  }

  const showStatusBanner =
    file.status === 'too-large' || file.status === 'unsupported';

  return (
    <div className={`editable-pane ${className ?? ''}`}>
      {showStatusBanner && (
        <div className="editable-pane-status-banner">
          <AlertTriangle size={14} />
          <span>{file.loadErrorMessage}</span>
        </div>
      )}
      {file.saveError && (
        <div className="editable-pane-save-error">
          <AlertTriangle size={14} />
          <span>{file.saveError}</span>
          {file.conflictDetected && (
            <button
              type="button"
              className="editable-pane-save-error-action"
              onClick={() => void file.reloadFromDisk()}
              title="Discard your edits and load the latest version from disk"
            >
              Reload from disk
            </button>
          )}
        </div>
      )}
      <div
        ref={containerRef}
        className="editable-pane-monaco-container"
      />
    </div>
  );
});

export default EditableMonacoPane;
