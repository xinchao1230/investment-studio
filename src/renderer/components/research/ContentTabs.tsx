import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  X,
  Search,
  Download,
  Edit3,
  Eye,
  Monitor,
  Minimize,
  ExternalLink,
  LogOut,
  Code as CodeIcon,
  File as FileIcon,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import type * as monaco from 'monaco-editor';
import { UniverSheet } from './UniverSheet';
import EditableMonacoPane, {
  type EditableMonacoPaneHandle,
} from '../editor/EditableMonacoPane';
import { useDirtyEditors } from '../../contexts/DirtyEditorsContext';
import { useToast } from '../ui/ToastProvider';
import { MarkdownFindBar } from './MarkdownFindBar';
import { parseFrontMatter, type FrontMatter } from '../../lib/utils/yamlFrontMatter';

/** Simple CSV table renderer for the research workspace view mode. */
const CSVTable: React.FC<{ content: string; delimiter?: string }> = ({
  content,
  delimiter = ',',
}) => {
  const rows = useMemo(() => {
    if (!content) return [];
    return content
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => line.split(delimiter));
  }, [content, delimiter]);

  if (rows.length === 0) return <div className="p-4 text-sm text-gray-400">Empty</div>;

  const header = rows[0];
  const body = rows.slice(1);

  return (
    <div className="overflow-auto max-h-full">
      <table className="rw-csv-table w-full text-xs border-collapse">
        <thead>
          <tr>
            {header.map((cell, i) => (
              <th
                key={i}
                className="px-2 py-1 text-left font-medium border-b border-[var(--rw-border)] bg-[var(--rw-bg-soft)] whitespace-nowrap"
              >
                {cell.trim()}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, ri) => (
            <tr key={ri} className="hover:bg-black/[0.02]">
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  className="px-2 py-1 border-b border-[var(--rw-border)] whitespace-nowrap"
                >
                  {cell.trim()}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export interface Tab {
  id: string;
  label: string;
  filePath: string;
  content: string;
  /**
   * Editable categories: markdown, csv
   * Read-only categories: spreadsheet (xlsx via UniverSheet), pdf, html,
   *   json, code, text — these route through native viewers / Monaco.
   * Binary category: xlsx / docx / pptx / archives etc. — surfaced as a
   *   tab but renders an "Open with Default App" placeholder. Never has
   *   `content` loaded (the producer must skip the utf-8 read).
   */
  type:
    | 'markdown'
    | 'spreadsheet'
    | 'csv'
    | 'pdf'
    | 'html'
    | 'json'
    | 'code'
    | 'text'
    | 'binary';
  sheetData?: any;
  mtime?: number;
  /** Optional breadcrumb prefix shown before the filename (e.g. "携程集团.HK"). */
  pathPrefix?: string;
  /** Monaco language id for `code` / `text` / `json` / `html` source views. */
  language?: string;
}

// ============================================================
// Read-only viewers (imported file types)
// ============================================================

/** Inline read-only Monaco viewer for code/text/json/html-source tabs. */
const ReadonlyMonacoViewer: React.FC<{ content: string; language: string }> = ({
  content,
  language,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    let destroyed = false;
    import(/* webpackChunkName: "monaco-editor" */ 'monaco-editor').then((mod) => {
      if (destroyed || !containerRef.current) return;
      const editor = mod.editor.create(containerRef.current, {
        value: content,
        language,
        theme: 'vs-dark',
        automaticLayout: true,
        readOnly: true,
        domReadOnly: true,
        minimap: { enabled: false },
        fontSize: 15,
        fontFamily: "'Menlo','Monaco','Courier New',monospace",
        lineHeight: 23,
        padding: { top: 12, bottom: 12 },
        scrollBeyondLastLine: false,
        wordWrap: 'off',
        tabSize: 2,
        renderWhitespace: 'none',
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
        overviewRulerBorder: false,
        scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
        folding: true,
        lineNumbers: 'on',
        contextmenu: false,
      });
      editorRef.current = editor;
      setIsReady(true);
    });
    return () => {
      destroyed = true;
      editorRef.current?.dispose();
      editorRef.current = null;
    };
  }, [content, language]);

  return (
    <div className="rw-monaco-wrapper" style={{ width: '100%', height: '100%', position: 'relative' }}>
      {!isReady && (
        <div className="absolute inset-0 flex items-center justify-center text-[var(--rw-text-3)] text-sm">
          Loading…
        </div>
      )}
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
};

/** Open-externally placeholder for tab types we can't render inline
 *  (xlsx, docx, archives, etc.). Surfaces the file as a tab in the
 *  middle pane while pointing the user at their default OS app. */
const BinaryFallback: React.FC<{
  filePath: string;
  onOpenExternal: () => void;
  onShowInFolder: () => void;
}> = ({ filePath, onOpenExternal, onShowInFolder }) => {
  const name = filePath.split(/[\\/]/).pop() ?? filePath;
  const ext = (filePath.split('.').pop() ?? '').toUpperCase();
  return (
    <div className="h-full w-full flex flex-col items-center justify-center gap-4 px-6 text-center text-[var(--rw-text-2)]">
      <FileIcon size={56} className="text-[var(--rw-text-3)]" />
      <div>
        <div className="text-sm font-medium text-[var(--rw-text)]">{name}</div>
        <div className="mt-1 text-xs text-[var(--rw-text-3)]">{ext || 'FILE'}</div>
      </div>
      <div className="text-sm max-w-md">
        This file type cannot be previewed inline. Open it with your default
        application to view the contents.
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onOpenExternal}
          className="px-3 py-1.5 text-xs rounded border border-[var(--rw-border)] bg-[var(--rw-bg-soft)] hover:bg-black/5 text-[var(--rw-text)]"
        >
          Open with Default App
        </button>
        <button
          type="button"
          onClick={onShowInFolder}
          className="px-3 py-1.5 text-xs rounded border border-[var(--rw-border)] hover:bg-black/5 text-[var(--rw-text-2)]"
        >
          Show in Folder
        </button>
      </div>
    </div>
  );
};

/** Front-matter YAML metadata table shown above markdown content. */
const FrontMatterTable: React.FC<{ frontMatter: FrontMatter }> = ({ frontMatter }) => {
  const entries = Object.entries(frontMatter);
  if (entries.length === 0) return null;
  return (
    <table className="rw-frontmatter-table mb-4 text-[12px] border-collapse">
      <tbody>
        {entries.map(([k, v]) => (
          <tr key={k}>
            <td className="px-2 py-1 font-medium text-[var(--rw-text-2)] bg-[var(--rw-bg-soft)] border border-[var(--rw-border)] whitespace-nowrap align-top">
              {k}
            </td>
            <td className="px-2 py-1 text-[var(--rw-text)] border border-[var(--rw-border)]">
              {String(v)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

interface ContentTabsProps {
  tabs: Tab[];
  activeTabId: string;
  onTabSelect: (id: string) => void;
  onTabClose: (id: string) => void;
  /** Notified after a successful in-editor save so the parent can
   *  refresh its file-content cache (the fs watcher echo is suppressed
   *  for our own writes). */
  onTabSaved?: (tabId: string, filePath: string, content: string) => void;
}

const STATUS_MAP: Record<string, string> = {
  '边际改善': 'rw-status-pill rw-status-good',
  '边际承压': 'rw-status-pill rw-status-warn',
  '边际恶化': 'rw-status-pill rw-status-bad',
};

const StatusCell: React.FC<any> = ({ children, ...rest }) => {
  const text = React.Children.toArray(children)
    .map((c) => (typeof c === 'string' ? c : ''))
    .join('')
    .trim();
  const cls = STATUS_MAP[text];
  if (cls)
    return (
      <td {...rest}>
        <span className={cls}>{text}</span>
      </td>
    );
  return <td {...rest}>{children}</td>;
};

function formatTime(mtime?: number): string {
  if (!mtime) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(mtime));
}

/** HH:MM:SS for the “已保存 12:04:52” toolbar indicator. */
function formatSavedAt(ts: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(ts));
}

/** Small autosave status badge shown in place of the old “保存” button.
 *  Three states:
 *    - saving:   “保存中…” (in-flight write)
 *    - dirty:    “未保存” (debounce window between keystroke and save)
 *    - savedAt: “已保存 HH:MM:SS”
 */
const SaveStatusIndicator: React.FC<{
  saving: boolean;
  dirty: boolean;
  savedAt?: number;
}> = ({ saving, dirty, savedAt }) => {
  let label: string;
  let cls: string;
  if (saving) {
    label = '保存中…';
    cls = 'text-[var(--rw-text-2)]';
  } else if (dirty) {
    label = '未保存';
    cls = 'text-[var(--rw-text-2)]';
  } else if (savedAt) {
    label = `已保存 ${formatSavedAt(savedAt)}`;
    cls = 'text-[var(--rw-text-3)]';
  } else {
    return null;
  }
  return (
    <span
      className={`ml-1.5 text-[11px] ${cls}`}
      title="Autosave enabled (Ctrl+S to save now)"
    >
      {label}
    </span>
  );
};

/** Pick a Monaco language id from a tab. */
function languageForTab(tab: Tab): string {
  if (tab.type === 'markdown') return 'markdown';
  if (tab.type === 'json') return 'json';
  if (tab.type === 'html') return 'html';
  if (tab.language) return tab.language;
  // CSV / text / fallback → plaintext; Monaco's csv mode is minimal and
  // tokenization noise hurts the edit experience more than it helps.
  return 'plaintext';
}

function isLocalFileUrl(url: string): boolean {
  if (!url) return false;
  if (url.startsWith('file://')) return true;
  if (url.startsWith('/')) return true;
  if (/^[a-zA-Z]:[/\\]/.test(url)) return true;
  return false;
}

function toFileUrl(absPath: string): string {
  if (absPath.startsWith('file://')) return absPath;
  // Windows abs path "C:\foo" → file:///C:/foo
  if (/^[a-zA-Z]:[/\\]/.test(absPath)) {
    return 'file:///' + absPath.replace(/\\/g, '/');
  }
  return 'file://' + absPath;
}

export const ContentTabs: React.FC<ContentTabsProps> = ({
  tabs,
  activeTabId,
  onTabSelect,
  onTabClose,
  onTabSaved,
}) => {
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const { isDirty } = useDirtyEditors();
  const { showError, showSuccess, showInfo } = useToast();

  // Edit-mode opt-in per tab. View mode (default) keeps the existing
  // markdown / CSV renderers; Edit mode swaps in the Monaco pane.
  // Spreadsheet tabs never enter edit mode.
  const [editingTabs, setEditingTabs] = useState<Set<string>>(() => new Set());

  // One imperative handle per tab so the toolbar Save button + the
  // close-tab guard can drive the pane without re-rendering it.
  const paneRefs = useRef<Map<string, EditableMonacoPaneHandle | null>>(
    new Map(),
  );
  const setPaneRef = useCallback(
    (tabId: string) => (handle: EditableMonacoPaneHandle | null) => {
      if (handle === null) paneRefs.current.delete(tabId);
      else paneRefs.current.set(tabId, handle);
    },
    [],
  );

  // Per-tab dirty mirror — sourced from EditableMonacoPane's
  // onDirtyChange so the toolbar Save button re-renders reactively.
  // We can't read this off the DirtyEditorsContext alone because that
  // is keyed by absPath and tabs can share paths.
  const [dirtyTabs, setDirtyTabs] = useState<Record<string, boolean>>({});

  // Per-tab autosave bookkeeping driven by EditableMonacoPane's
  // onSavingChange + onSaved. Used to render the “保存中… / 已保存 HH:MM:SS”
  // toolbar indicator that replaces the explicit Save button.
  const [savingTabs, setSavingTabs] = useState<Record<string, boolean>>({});
  const [savedAtTabs, setSavedAtTabs] = useState<Record<string, number>>({});

  // Markdown preview find-bar visibility. One bar per ContentTabs
  // instance (only the active tab's preview is on screen so we never
  // need parallel bars). Closes automatically when the active tab
  // changes or the user enters edit mode for it.
  const [findBarOpen, setFindBarOpen] = useState(false);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const handleDirtyChange = useCallback(
    (tabId: string) => (dirty: boolean) => {
      setDirtyTabs((prev) => {
        if (Boolean(prev[tabId]) === dirty) return prev;
        return { ...prev, [tabId]: dirty };
      });
    },
    [],
  );

  const handleSavingChange = useCallback(
    (tabId: string) => (saving: boolean) => {
      setSavingTabs((prev) => {
        if (Boolean(prev[tabId]) === saving) return prev;
        return { ...prev, [tabId]: saving };
      });
    },
    [],
  );

  // Drop bookkeeping for tabs that no longer exist (closed externally).
  useEffect(() => {
    const ids = new Set(tabs.map((t) => t.id));
    setEditingTabs((prev) => {
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => {
        if (ids.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : prev;
    });
    setDirtyTabs((prev) => {
      const next: Record<string, boolean> = {};
      let changed = false;
      for (const [id, v] of Object.entries(prev)) {
        if (ids.has(id)) next[id] = v;
        else changed = true;
      }
      return changed ? next : prev;
    });
    setSavingTabs((prev) => {
      const next: Record<string, boolean> = {};
      let changed = false;
      for (const [id, v] of Object.entries(prev)) {
        if (ids.has(id)) next[id] = v;
        else changed = true;
      }
      return changed ? next : prev;
    });
    setSavedAtTabs((prev) => {
      const next: Record<string, number> = {};
      let changed = false;
      for (const [id, v] of Object.entries(prev)) {
        if (ids.has(id)) next[id] = v;
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [tabs]);

  const activeIsEditing = activeTab ? editingTabs.has(activeTab.id) : false;
  const activeIsEditable =
    !!activeTab && (activeTab.type === 'markdown' || activeTab.type === 'csv');
  const activeIsDirty = activeTab ? Boolean(dirtyTabs[activeTab.id]) : false;

  // Per-tab HTML render-vs-source toggle. Default is rendered preview.
  const [htmlSourceTabs, setHtmlSourceTabs] = useState<Set<string>>(
    () => new Set(),
  );
  const toggleHtmlSource = useCallback((tabId: string) => {
    setHtmlSourceTabs((prev) => {
      const next = new Set(prev);
      if (next.has(tabId)) next.delete(tabId);
      else next.add(tabId);
      return next;
    });
  }, []);
  // Drop bookkeeping when tabs close.
  useEffect(() => {
    const ids = new Set(tabs.map((t) => t.id));
    setHtmlSourceTabs((prev) => {
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => {
        if (ids.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : prev;
    });
  }, [tabs]);

  // Fullscreen toggle for the whole content panel (header + body), so the
  // user can still see the tab/toolbar in fullscreen and the panel keeps its
  // theme colors (matches upstream InlineFilePreviewPanel behavior).
  const rootRef = useRef<HTMLDivElement>(null);
  const bodyContainerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement === rootRef.current) {
        await document.exitFullscreen();
      } else if (rootRef.current?.requestFullscreen) {
        await rootRef.current.requestFullscreen();
      }
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    const handler = () =>
      setIsFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const handleOpenExternal = useCallback(() => {
    if (!activeTab) return;
    const api = window.electronAPI as any;
    try {
      api?.workspace?.openPath?.(activeTab.filePath);
    } catch {
      /* ignore */
    }
  }, [activeTab]);

  // Auto-close the markdown find bar when the underlying preview goes
  // away (tab switch, switch into edit mode, or active tab no longer
  // markdown). The bar's cleanup effect unwraps its <mark> nodes from
  // whatever container it last knew about.
  useEffect(() => {
    if (!findBarOpen) return;
    if (
      !activeTab ||
      activeTab.type !== 'markdown' ||
      activeIsEditing
    ) {
      setFindBarOpen(false);
    }
  }, [findBarOpen, activeTab, activeIsEditing]);

  // Ctrl/Cmd+F shortcut. Only handles the markdown-preview case here
  // — when Monaco has focus it intercepts the key itself before this
  // window-level listener runs. Other tab types (xlsx, csv view) are
  // intentionally not bound.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'f') return;
      if (!activeTab || activeTab.type !== 'markdown' || activeIsEditing) return;
      e.preventDefault();
      setFindBarOpen(true);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeTab, activeIsEditing]);

  // Ctrl/Cmd+E shortcut — toggles between preview and edit for the
  // active markdown/csv tab. We skip the shortcut when Monaco has
  // text focus so it doesn't fight common in-editor bindings.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'e') return;
      if (!activeTab || !activeIsEditable) return;
      e.preventDefault();
      setEditingTabs((prev) => {
        const next = new Set(prev);
        if (next.has(activeTab.id)) next.delete(activeTab.id);
        else next.add(activeTab.id);
        return next;
      });
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeTab, activeIsEditable]);

  // Ctrl/Cmd+Shift+F — fullscreen toggle for the active document body.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey) return;
      if (e.key.toLowerCase() !== 'f') return;
      if (!activeTab) return;
      e.preventDefault();
      void toggleFullscreen();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeTab, toggleFullscreen]);

  // Esc shortcut — VS Code-style two-step exit:
  //   1) If focus is inside Monaco, blur it so Monaco's own Esc
  //      handling (find widget, suggest popup, etc.) gets a chance
  //      first and the user can see they've “stepped out” of the
  //      editor.
  //   2) Otherwise (focus already outside the editor), exit edit
  //      mode entirely.
  // We avoid Esc-in-input/textarea elsewhere on the page to not
  // hijack form behavior.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (!activeTab || !activeIsEditing) return;
      const ae = document.activeElement as HTMLElement | null;
      const insideMonaco = !!ae?.closest('.monaco-editor');
      if (insideMonaco) {
        // Step 1: just blur the editor textarea.
        e.preventDefault();
        ae?.blur();
        return;
      }
      // Step 2: leave edit mode.
      const tag = ae?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || ae?.isContentEditable) {
        // Don't steal Esc from other inputs on the page (e.g. find bar).
        return;
      }
      e.preventDefault();
      setEditingTabs((prev) => {
        const next = new Set(prev);
        next.delete(activeTab.id);
        return next;
      });
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeTab, activeIsEditing]);

  const toggleEdit = useCallback(() => {
    if (!activeTab || !activeIsEditable) return;
    const tabId = activeTab.id;
    setEditingTabs((prev) => {
      const next = new Set(prev);
      if (next.has(tabId)) {
        // Switching edit → view. With autosave the buffer is already
        // flushed (or about to be flushed by the pane unmount); no
        // discard prompt needed.
        next.delete(tabId);
      } else {
        next.add(tabId);
      }
      return next;
    });
  }, [activeTab, activeIsEditable]);

  // Search: dispatches to the appropriate mechanism for the active
  // tab. For markdown preview we open a DOM-based find bar (matches
  // are rendered as <mark> wrappers inside previewRef). For Monaco-
  // backed views (markdown/csv in edit mode, or csv view forced into
  // edit mode) we use Monaco's built-in find widget. xlsx (Univer)
  // has no integration today; surface a toast.
  const handleSearchClick = useCallback(() => {
    if (!activeTab) return;
    if (activeTab.type === 'spreadsheet') {
      showInfo('电子表格暂不支持页内搜索');
      return;
    }
    // Markdown in preview mode → DOM find bar.
    if (activeTab.type === 'markdown' && !editingTabs.has(activeTab.id)) {
      setFindBarOpen((v) => !v);
      return;
    }
    // Otherwise route through Monaco (csv, or markdown in edit mode).
    const tabId = activeTab.id;
    const runFind = () => {
      requestAnimationFrame(() => {
        const handle = paneRefs.current.get(tabId);
        if (!handle) {
          window.setTimeout(() => {
            paneRefs.current.get(tabId)?.triggerFind();
          }, 120);
          return;
        }
        handle.triggerFind();
      });
    };
    if (!editingTabs.has(tabId)) {
      setEditingTabs((prev) => {
        const next = new Set(prev);
        next.add(tabId);
        return next;
      });
      runFind();
    } else {
      runFind();
    }
  }, [activeTab, editingTabs, showInfo]);

  // "Show in folder" — reveal the current file in the OS file manager.
  // Matches upstream InlineFilePreviewPanel's Download/folder button.
  // If there's an unsaved buffer we flush it first so the revealed
  // on-disk file is current.
  const handleDownloadClick = useCallback(async () => {
    if (!activeTab) return;
    if (dirtyTabs[activeTab.id]) {
      const handle = paneRefs.current.get(activeTab.id);
      if (handle) {
        const result = await handle.save();
        if (!result.ok) {
          showError('Save failed, cannot reveal');
          return;
        }
      }
    }
    try {
      const api = window.electronAPI as any;
      const showInFolder = api?.workspace?.showInFolder;
      if (!showInFolder) {
        showError('Show in folder is not supported in this environment');
        return;
      }
      await showInFolder(activeTab.filePath);
    } catch (e) {
      showError(
        `Failed to reveal: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }, [activeTab, dirtyTabs, showError]);

  // Guard tab close on unsaved changes. With autosave + pane-unmount
  // flush, the on-disk file is up to date by the time the user sees
  // the close animation finish; we don't prompt anymore.
  const handleTabCloseGuarded = useCallback(
    (tabId: string) => {
      onTabClose(tabId);
    },
    [onTabClose],
  );

  const basename = activeTab
    ? activeTab.filePath.split(/[\\/]/).pop() ?? activeTab.label
    : '';

  // Render edit panes for ALL currently-editing tabs (not just the
  // active one) so switching tabs doesn't drop unsaved buffers.
  // Inactive panes are hidden via `display:none` rather than
  // unmounted.
  const editingTabList = useMemo(
    () => tabs.filter((t) => editingTabs.has(t.id)),
    [tabs, editingTabs],
  );

  // Restore focus to the active edit pane after tab switches AND after
  // entering edit mode. When the active tab's container goes from
  // display:none → display:block, the browser silently drops focus
  // from any element inside it (the textarea Monaco uses internally).
  // Subsequent mouse clicks DO try to re-focus, but in our renderer
  // something in the tree wins the focus race intermittently, so the
  // editor visually shows a cursor without actually receiving keys.
  // The user can "fix" it by alt-tabbing out and back — that's the
  // browser's focus-recovery on window activation. Doing the focus
  // ourselves on tab change makes it reliable.
  //
  // We use a microtask + rAF so the layout flip from display:none →
  // display:block has happened before we focus.
  useEffect(() => {
    if (!activeTabId) return;
    if (!editingTabs.has(activeTabId)) return;
    let raf = 0;
    const t = window.setTimeout(() => {
      raf = requestAnimationFrame(() => {
        paneRefs.current.get(activeTabId)?.focus();
      });
    }, 0);
    return () => {
      window.clearTimeout(t);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [activeTabId, editingTabs]);

  if (tabs.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--rw-text-3)] text-sm">
        从左侧选择文件以打开
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className={`content-tabs-root flex-1 flex flex-col min-w-0${
        isFullscreen ? ' content-tabs-fullscreen' : ''
      }`}
      style={{ background: 'var(--rw-bg)' }}
    >
      {/* Tab strip */}
      <div className="flex h-7 rw-divider overflow-x-auto bg-[var(--rw-bg-soft)]">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const tabIsDirty =
            Boolean(dirtyTabs[tab.id]) || isDirty(tab.filePath);
          return (
            <div
              key={tab.id}
              className={`group flex items-center gap-2 px-3 text-[12.5px] cursor-pointer border-r border-[var(--rw-border)] shrink-0 h-full ${
                isActive
                  ? 'rw-tab-active-bar bg-white text-[var(--rw-text)]'
                  : 'bg-[var(--rw-bg-soft)] text-[var(--rw-text-2)] hover:bg-black/5'
              }`}
              onClick={() => onTabSelect(tab.id)}
            >
              <span className="truncate max-w-[120px]">{tab.label}</span>
              {tabIsDirty && (
                <span
                  className="w-1.5 h-1.5 rounded-full bg-[var(--rw-accent,#3b82f6)]"
                  title="Unsaved changes"
                />
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleTabCloseGuarded(tab.id);
                }}
                className={`p-0.5 rounded hover:bg-black/10 ${
                  isActive ? 'opacity-60' : 'opacity-0 group-hover:opacity-100'
                }`}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
        <button disabled className="px-2 text-[var(--rw-text-3)] cursor-not-allowed">
          +
        </button>
      </div>

      {/* Document header */}
      {activeTab && (
        <div className="flex items-center justify-between h-8 px-4 rw-divider text-[12.5px] text-[var(--rw-text-2)] bg-[var(--rw-bg)]">
          <span className="truncate">
            {activeTab.pathPrefix && (
              <>
                <span className="text-[var(--rw-text)] font-medium">{activeTab.pathPrefix}</span>
                <span className="mx-1.5 text-[var(--rw-text-3)]">›</span>
              </>
            )}
            <span className="text-[var(--rw-text)]">{basename}</span>
            <span className="mx-1.5 text-[var(--rw-text-3)]">·</span>
            最近更新 {formatTime(activeTab.mtime)}
          </span>
          <div className="flex items-center gap-0.5">
            <button
              className="p-1 rounded hover:bg-black/5 text-[var(--rw-text-2)]"
              onClick={handleSearchClick}
              title="Find in document (Ctrl+F)"
            >
              <Search size={14} />
            </button>
            {activeTab?.type === 'html' && !activeIsEditing && (
              <button
                onClick={() => toggleHtmlSource(activeTab.id)}
                title={
                  htmlSourceTabs.has(activeTab.id)
                    ? 'View rendered'
                    : 'View source'
                }
                className="p-1 rounded hover:bg-black/5 text-[var(--rw-text-2)]"
              >
                {htmlSourceTabs.has(activeTab.id) ? (
                  <Eye size={14} />
                ) : (
                  <CodeIcon size={14} />
                )}
              </button>
            )}
            {activeIsEditable && (
              <button
                onClick={toggleEdit}
                title={activeIsEditing ? 'Exit edit mode (Ctrl+E / Esc)' : 'Edit (Ctrl+E)'}
                className="p-1 rounded hover:bg-black/5 text-[var(--rw-text-2)]"
              >
                {activeIsEditing ? <LogOut size={14} /> : <Edit3 size={14} />}
              </button>
            )}
            <button
              onClick={handleOpenExternal}
              title="Open with default app"
              className="p-1 rounded hover:bg-black/5 text-[var(--rw-text-2)]"
            >
              <ExternalLink size={14} />
            </button>
            <button
              className="p-1 rounded hover:bg-black/5 text-[var(--rw-text-2)]"
              onClick={handleDownloadClick}
              title="Show in folder"
            >
              <Download size={14} />
            </button>
            <button
              onClick={toggleFullscreen}
              title={isFullscreen ? 'Exit fullscreen (Ctrl+Shift+F)' : 'Fullscreen (Ctrl+Shift+F)'}
              className="p-1 rounded hover:bg-black/5 text-[var(--rw-text-2)]"
            >
              {isFullscreen ? <Minimize size={14} /> : <Monitor size={14} />}
            </button>
            {activeIsEditing && activeTab && (
              <SaveStatusIndicator
                saving={Boolean(savingTabs[activeTab.id])}
                dirty={activeIsDirty}
                savedAt={savedAtTabs[activeTab.id]}
              />
            )}
          </div>
        </div>
      )}

      {/* Body */}
      <div ref={bodyContainerRef} className="flex-1 min-h-0 relative">
        {/* Mounted edit panes (one per editing tab). Inactive panes
            stay mounted via display:none so their buffers + Monaco
            instances survive tab switches. */}
        {editingTabList.map((tab) => (
          <div
            key={`edit-${tab.id}`}
            className="absolute inset-0"
            style={{ display: tab.id === activeTabId ? 'block' : 'none' }}
          >
            <EditableMonacoPane
              ref={setPaneRef(tab.id)}
              filePath={tab.filePath}
              language={languageForTab(tab)}
              autoSave
              onDirtyChange={handleDirtyChange(tab.id)}
              onSavingChange={handleSavingChange(tab.id)}
              onSaved={(fp, content) => {
                setSavedAtTabs((prev) => ({ ...prev, [tab.id]: Date.now() }));
                onTabSaved?.(tab.id, fp, content);
              }}
            />
          </div>
        ))}

        {/* View mode for the active tab (only when NOT editing). */}
        {activeTab && !activeIsEditing && (
          <div className="absolute inset-0 overflow-auto">
            {activeTab.type === 'spreadsheet' && activeTab.sheetData ? (
              <UniverSheet data={activeTab.sheetData} />
            ) : activeTab.type === 'csv' ? (
              <div className="min-h-0">
                <CSVTable
                  content={activeTab.content}
                  delimiter={/\.tsv$/i.test(activeTab.filePath) ? '\t' : ','}
                />
              </div>
            ) : activeTab.type === 'pdf' ? (
              <iframe
                title={activeTab.label}
                src={`${toFileUrl(activeTab.filePath)}#view=FitH`}
                style={{ width: '100%', height: '100%', border: 'none' }}
              />
            ) : activeTab.type === 'html' ? (
              htmlSourceTabs.has(activeTab.id) ? (
                <ReadonlyMonacoViewer
                  content={activeTab.content}
                  language="html"
                />
              ) : (
                <iframe
                  title={activeTab.label}
                  srcDoc={activeTab.content}
                  sandbox="allow-scripts allow-popups"
                  style={{ width: '100%', height: '100%', border: 'none' }}
                />
              )
            ) : activeTab.type === 'json' ||
              activeTab.type === 'code' ||
              activeTab.type === 'text' ? (
              <ReadonlyMonacoViewer
                content={activeTab.content}
                language={languageForTab(activeTab)}
              />
            ) : activeTab.type === 'binary' ? (
              <BinaryFallback
                filePath={activeTab.filePath}
                onOpenExternal={handleOpenExternal}
                onShowInFolder={handleDownloadClick}
              />
            ) : (
              // markdown (default)
              (() => {
                const { frontMatter, content: body } = parseFrontMatter(
                  activeTab.content,
                );
                return (
                  <div
                    ref={previewRef}
                    className="rw-doc-body prose prose-sm max-w-none"
                  >
                    {frontMatter && <FrontMatterTable frontMatter={frontMatter} />}
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      rehypePlugins={[rehypeRaw]}
                      components={{
                        td: StatusCell,
                        th: ({ children }) => <th>{children}</th>,
                        a: ({ href, children, ...props }) => {
                          if (href && /^https?:\/\//.test(href)) {
                            return (
                              <a
                                {...props}
                                href={href}
                                onClick={(e) => {
                                  e.preventDefault();
                                  window.open(href, '_blank', 'noopener,noreferrer');
                                }}
                                title={href}
                                style={{ cursor: 'pointer' }}
                              >
                                {children}
                              </a>
                            );
                          }
                          return (
                            <a {...props} href={href}>
                              {children}
                            </a>
                          );
                        },
                      }}
                    >
                      {body}
                    </ReactMarkdown>
                  </div>
                );
              })()
            )}
          </div>
        )}

        {/* Find bar overlay for markdown preview. Re-keyed by tab id
            so switching tabs unmounts the old bar (which cleans up
            its <mark> wrappers via its cleanup effect). */}
        {findBarOpen &&
          activeTab &&
          !activeIsEditing &&
          activeTab.type === 'markdown' && (
            <MarkdownFindBar
              key={`find-${activeTab.id}`}
              containerRef={previewRef}
              onClose={() => setFindBarOpen(false)}
            />
          )}
      </div>
    </div>
  );
};
