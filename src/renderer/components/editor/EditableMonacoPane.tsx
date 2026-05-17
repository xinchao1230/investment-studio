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
}

export interface EditableMonacoPaneProps {
  /** Absolute file path. null/undefined → renders empty state. */
  filePath: string | null;
  /** Monaco language id (e.g. 'markdown', 'csv', 'plaintext'). Defaults to 'plaintext'. */
  language?: string;
  /** Called every time isDirty changes — parent uses this to drive a Save button. */
  onDirtyChange?(dirty: boolean): void;
  /** Force read-only regardless of file status. */
  readOnly?: boolean;
  className?: string;
}

const EditableMonacoPane = forwardRef<
  EditableMonacoPaneHandle,
  EditableMonacoPaneProps
>(function EditableMonacoPane(
  { filePath, language = 'plaintext', onDirtyChange, readOnly = false, className },
  ref,
) {
  const file = useEditableTextFile({ filePath });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const changeDisposableRef = useRef<{ dispose(): void } | null>(null);
  // We update `editor.setValue` reactively from `file.content`. To
  // avoid re-firing the change listener (and incorrectly marking the
  // buffer dirty against itself), gate the listener with this flag.
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
      save: () => fileApiRef.current.save(),
      isDirty: () => fileApiRef.current.isDirty,
      getContent: () => fileApiRef.current.content ?? '',
      reloadFromDisk: () => fileApiRef.current.reloadFromDisk(),
    }),
    [],
  );

  // -----------------------------------------------------------------
  // Propagate dirty state up.
  // -----------------------------------------------------------------
  useEffect(() => {
    onDirtyChange?.(file.isDirty);
  }, [file.isDirty, onDirtyChange]);

  // -----------------------------------------------------------------
  // Mount Monaco when we have content and a container. Re-mount when
  // filePath changes (so undo history doesn't carry across files).
  // -----------------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current) return;
    if (file.content === null) return;
    if (file.status === 'loading' || file.status === 'idle') return;

    const container = containerRef.current;
    let disposed = false;
    const initialValue = file.content;

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
          wordWrap: 'off',
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
          // readOnly is computed from the latest hook status — read it
          // off the ref so we don't re-mount Monaco when it changes.
          readOnly:
            readOnly ||
            fileApiRef.current.status !== 'ready' ||
            !fileApiRef.current.canEdit,
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
        });

        if (fileApiRef.current.canEdit) {
          editor.focus();
        }
      },
    );

    return () => {
      disposed = true;
      changeDisposableRef.current?.dispose();
      changeDisposableRef.current = null;
      editorRef.current?.dispose();
      editorRef.current = null;
    };
    // We deliberately depend only on filePath + language: switching
    // files / language remounts Monaco. Content updates from
    // reloadFromDisk are pushed via setValue in the next effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, language]);

  // -----------------------------------------------------------------
  // Apply external content updates (e.g. reloadFromDisk) to the live
  // editor without re-creating it. Only fires when the buffer
  // diverges from what Monaco currently shows.
  // -----------------------------------------------------------------
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (file.content === null) return;
    if (editor.getValue() === file.content) return;
    suppressNextChangeRef.current = true;
    editor.setValue(file.content);
  }, [file.content]);

  // -----------------------------------------------------------------
  // Read-only / unsupported mode → flip Monaco readOnly without
  // re-mounting. Cheap and reactive.
  // -----------------------------------------------------------------
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const ro = readOnly || file.status !== 'ready' || !file.canEdit;
    editor.updateOptions({ readOnly: ro });
  }, [readOnly, file.status, file.canEdit]);

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
      void fileApiRef.current.save();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

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
        <span>{file.loadErrorMessage ?? '加载失败'}</span>
        <button
          type="button"
          className="editable-pane-retry"
          onClick={() => void file.reloadFromDisk()}
        >
          <RotateCw size={14} /> 重试
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
