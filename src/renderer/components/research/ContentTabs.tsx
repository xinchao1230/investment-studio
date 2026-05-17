import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { X, Search, Download, MoreHorizontal, Edit3, Eye } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { UniverSheet } from './UniverSheet';
import { CSVTable } from '../ui/OverlayFileViewer';
import EditableMonacoPane, {
  type EditableMonacoPaneHandle,
} from '../editor/EditableMonacoPane';
import { useDirtyEditors } from '../../contexts/DirtyEditorsContext';

export interface Tab {
  id: string;
  label: string;
  filePath: string;
  content: string;
  type: 'markdown' | 'spreadsheet' | 'csv';
  sheetData?: any;
  mtime?: number;
  /** Optional breadcrumb prefix shown before the filename (e.g. "携程集团.HK"). */
  pathPrefix?: string;
}

interface ContentTabsProps {
  tabs: Tab[];
  activeTabId: string;
  onTabSelect: (id: string) => void;
  onTabClose: (id: string) => void;
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

/** Pick a Monaco language id from a tab. */
function languageForTab(tab: Tab): string {
  if (tab.type === 'markdown') return 'markdown';
  // CSV / fallback → plaintext; Monaco's csv mode is minimal and
  // tokenization noise hurts the edit experience more than it helps.
  return 'plaintext';
}

export const ContentTabs: React.FC<ContentTabsProps> = ({
  tabs,
  activeTabId,
  onTabSelect,
  onTabClose,
}) => {
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const { isDirty } = useDirtyEditors();

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
  const handleDirtyChange = useCallback(
    (tabId: string) => (dirty: boolean) => {
      setDirtyTabs((prev) => {
        if (Boolean(prev[tabId]) === dirty) return prev;
        return { ...prev, [tabId]: dirty };
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
  }, [tabs]);

  const activeIsEditing = activeTab ? editingTabs.has(activeTab.id) : false;
  const activeIsEditable =
    !!activeTab && (activeTab.type === 'markdown' || activeTab.type === 'csv');
  const activeIsDirty = activeTab ? Boolean(dirtyTabs[activeTab.id]) : false;

  const toggleEdit = useCallback(() => {
    if (!activeTab || !activeIsEditable) return;
    const tabId = activeTab.id;
    setEditingTabs((prev) => {
      const next = new Set(prev);
      if (next.has(tabId)) {
        // Switching edit → view. Block if there are unsaved changes;
        // require an explicit discard.
        if (dirtyTabs[tabId]) {
          const discard = window.confirm(
            '有未保存的修改，切换到预览将丢弃修改。确定继续？',
          );
          if (!discard) return prev;
        }
        next.delete(tabId);
      } else {
        next.add(tabId);
      }
      return next;
    });
  }, [activeTab, activeIsEditable, dirtyTabs]);

  const handleSaveClick = useCallback(() => {
    if (!activeTab) return;
    const handle = paneRefs.current.get(activeTab.id);
    if (!handle) return;
    void handle.save();
  }, [activeTab]);

  // Guard tab close on unsaved changes.
  const handleTabCloseGuarded = useCallback(
    (tabId: string) => {
      if (dirtyTabs[tabId]) {
        const discard = window.confirm(
          '该文件有未保存的修改，确定关闭标签页？修改将丢失。',
        );
        if (!discard) return;
      }
      onTabClose(tabId);
    },
    [dirtyTabs, onTabClose],
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

  if (tabs.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--rw-text-3)] text-sm">
        从左侧选择文件以打开
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-w-0" style={{ background: 'var(--rw-bg)' }}>
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
                  title="有未保存的修改"
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
          <div className="flex items-center">
            <button
              className="p-1 rounded hover:bg-black/5 text-[var(--rw-text-2)]"
              disabled
            >
              <Search size={14} />
            </button>
            <button
              className="p-1 rounded hover:bg-black/5 text-[var(--rw-text-2)]"
              disabled
            >
              <Download size={14} />
            </button>
            <button
              className="p-1 rounded hover:bg-black/5 text-[var(--rw-text-2)]"
              disabled
            >
              <MoreHorizontal size={14} />
            </button>
            {activeIsEditable && (
              <button
                onClick={toggleEdit}
                title={activeIsEditing ? '切换到预览' : '编辑'}
                className="ml-1 p-1 rounded hover:bg-black/5 text-[var(--rw-text-2)]"
              >
                {activeIsEditing ? <Eye size={14} /> : <Edit3 size={14} />}
              </button>
            )}
            <button
              onClick={handleSaveClick}
              disabled={!activeIsEditing || !activeIsDirty}
              className={`ml-2 px-3 h-6 rounded bg-[var(--rw-accent)] text-white text-[12px] ${
                !activeIsEditing || !activeIsDirty
                  ? 'opacity-50 cursor-not-allowed'
                  : 'hover:opacity-90'
              }`}
            >
              保存
            </button>
          </div>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 min-h-0 relative">
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
              onDirtyChange={handleDirtyChange(tab.id)}
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
            ) : (
              <div className="rw-doc-body prose prose-sm max-w-none">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    td: StatusCell,
                    th: ({ children }) => <th>{children}</th>,
                  }}
                >
                  {activeTab.content}
                </ReactMarkdown>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
