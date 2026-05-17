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
  useState,
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
  // Forces a re-render once Monaco has finished its async mount so
  // the readOnly-sync effect below can grab editorRef.current.
  // Without this, the editor would stay in whatever readOnly state it
  // was created with — the readOnly effect runs in render order and
  // would have already early-returned (editorRef.current=null) by the
  // time the async import resolves.
  const [editorEpoch, setEditorEpoch] = useState(0);
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
    // eslint-disable-next-line no-console
    console.log('[EditableMonacoPane] mounting Monaco', {
      filePath,
      status: file.status,
      canEdit: file.canEdit,
      initialReadOnly,
      contentLen: initialValue.length,
    });

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
          readOnly: initialReadOnly,
          contextmenu: true,
          quickSuggestions: false,
          parameterHints: { enabled: false },
          suggestOnTriggerCharacters: false,
          acceptSuggestionOnEnter: 'off',
          tabCompletion: 'off',
          wordBasedSuggestions: 'off',
        });
        // eslint-disable-next-line no-console
        console.log('[EditableMonacoPane] Monaco created', {
          filePath,
          readOnlyApplied: editor.getOption(monacoModule.editor.EditorOption.readOnly),
        });

        editorRef.current = editor;
        setEditorEpoch((n) => n + 1);

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
    // We deliberately depend only on filePath + language + contentReady:
    // switching files / language remounts Monaco; content arriving for
    // the first time triggers the initial mount. Subsequent content
    // updates (typing, reloadFromDisk) are pushed via setValue in the
    // next effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, language, statusSettled]);

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
    // eslint-disable-next-line no-console
    console.log('[EditableMonacoPane] updateOptions readOnly', {
      filePath,
      ro,
      status: file.status,
      canEdit: file.canEdit,
      propReadOnly: readOnly,
      editorEpoch,
    });
    editor.updateOptions({ readOnly: ro });
    if (!ro) {
      // If we just transitioned to editable, make sure focus is in
      // the editor so the user can start typing immediately.
      try {
        editor.focus();
      } catch {
        /* noop */
      }
    }
  }, [readOnly, file.status, file.canEdit, filePath, editorEpoch]);

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
