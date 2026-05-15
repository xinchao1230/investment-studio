import React, { useState, useCallback, useRef, useEffect } from 'react';
import { PanelLeftOpen } from 'lucide-react';
import { TargetListSidebar } from './TargetListSidebar';
import { ContentTabs, Tab } from './ContentTabs';
import { ResearchChatPane } from './ResearchChatPane';
import { AddTargetSearch } from './AddTargetSearch';
import { usePortfolio, TargetFile } from './usePortfolio';
import { useTargetChats } from './useTargetChats';
import { LayoutProvider } from '../layout/LayoutProvider';
import { PasteToWorkspaceProvider } from '../chat/workspace/PasteToWorkspaceProvider';
import { agentChatSessionCacheManager } from '../../lib/chat/agentChatSessionCacheManager';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import ResizableDivider from '../ui/ResizableDivider';
import './research-theme.css';

// Layout constants for the 3-pane resizable workspace.
const LEFT_MIN = 200;
const LEFT_MAX = 480;
const LEFT_DEFAULT = 240;
const RIGHT_MIN = 400;
const RIGHT_DEFAULT = 400;
const CENTER_MIN = 240;  // The single absolute constraint: center pane never goes below this.
const LEFT_COLLAPSED_WIDTH = 32;
const RIGHT_COLLAPSED_WIDTH = 40;

const LS_KEY_LEFT_WIDTH = 'rw:leftWidth';
const LS_KEY_RIGHT_WIDTH = 'rw:rightWidth';
const LS_KEY_LEFT_COLLAPSED = 'rw:leftCollapsed';
const LS_KEY_RIGHT_COLLAPSED = 'rw:rightCollapsed';

const readNum = (key: string, fallback: number): number => {
  try {
    const v = localStorage.getItem(key);
    if (v == null) return fallback;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : fallback;
  } catch { return fallback; }
};
const readBool = (key: string): boolean => {
  try { return localStorage.getItem(key) === 'true'; } catch { return false; }
};
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));

export const ResearchPage: React.FC = () => {
  const { targets, loading, initTarget, deleteTarget, getTargetFiles } = usePortfolio();
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addBusy, setAddBusy] = useState(false);

  const [expandedCodes, setExpandedCodes] = useState<Set<string>>(new Set());
  const [filesByCode, setFilesByCode] = useState<Record<string, TargetFile[]>>({});
  const [activeFileAbsPath, setActiveFileAbsPath] = useState<string | null>(null);
  // In-app confirm dialog state for delete-target. We avoid window.confirm()
  // because the native modal steals focus from the renderer; when the
  // following <AddTargetSearch> auto-mounts, its input.focus() becomes a
  // no-op until the user manually re-activates the window.
  const [pendingDelete, setPendingDelete] = useState<{ code: string; name: string } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const filesByCodeRef = useRef(filesByCode);
  filesByCodeRef.current = filesByCode;

  const targetChats = useTargetChats();
  const targetsRef = useRef(targets);
  targetsRef.current = targets;

  // --- 3-pane resizable layout state -----------------------------------
  const [leftWidth, setLeftWidth] = useState<number>(() => {
    const w = clamp(readNum(LS_KEY_LEFT_WIDTH, LEFT_DEFAULT), LEFT_MIN, LEFT_MAX);
    const r = Math.max(RIGHT_MIN, readNum(LS_KEY_RIGHT_WIDTH, RIGHT_DEFAULT));
    // Defensive: if a stale wider window persisted values that no longer fit,
    // shrink left so center pane keeps CENTER_MIN.
    const avail = (typeof window !== 'undefined' ? window.innerWidth : 1200) - r - CENTER_MIN;
    return Math.min(w, Math.max(LEFT_MIN, avail));
  });
  const [rightWidth, setRightWidth] = useState<number>(() => {
    const w = Math.max(RIGHT_MIN, readNum(LS_KEY_RIGHT_WIDTH, RIGHT_DEFAULT));
    const l = clamp(readNum(LS_KEY_LEFT_WIDTH, LEFT_DEFAULT), LEFT_MIN, LEFT_MAX);
    const avail = (typeof window !== 'undefined' ? window.innerWidth : 1200) - l - CENTER_MIN;
    return Math.min(w, Math.max(RIGHT_MIN, avail));
  });
  const [leftCollapsed, setLeftCollapsed] = useState<boolean>(() => readBool(LS_KEY_LEFT_COLLAPSED));
  const [rightCollapsed, setRightCollapsed] = useState<boolean>(() => readBool(LS_KEY_RIGHT_COLLAPSED));
  const [isDraggingDivider, setIsDraggingDivider] = useState(false);
  // Track window width so dynamic max-width constraints react to window resize / maximize.
  const [windowWidth, setWindowWidth] = useState<number>(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1200,
  );

  // Dynamic max widths: bound purely by the available space after the
  // opposite pane + CENTER_MIN. No hard cap on right pane — user can drag
  // it as wide as the window allows while the center keeps CENTER_MIN.
  const oppositeForLeft = rightCollapsed ? RIGHT_COLLAPSED_WIDTH : rightWidth;
  const oppositeForRight = leftCollapsed ? LEFT_COLLAPSED_WIDTH : leftWidth;
  const dynLeftMax = Math.max(LEFT_MIN, Math.min(LEFT_MAX, windowWidth - oppositeForLeft - CENTER_MIN));
  const dynRightMax = Math.max(RIGHT_MIN, windowWidth - oppositeForRight - CENTER_MIN);

  // Persist widths & collapsed flags.
  useEffect(() => {
    try { localStorage.setItem(LS_KEY_LEFT_WIDTH, String(leftWidth)); } catch {}
  }, [leftWidth]);
  useEffect(() => {
    try { localStorage.setItem(LS_KEY_RIGHT_WIDTH, String(rightWidth)); } catch {}
  }, [rightWidth]);
  useEffect(() => {
    try { localStorage.setItem(LS_KEY_LEFT_COLLAPSED, String(leftCollapsed)); } catch {}
  }, [leftCollapsed]);
  useEffect(() => {
    try { localStorage.setItem(LS_KEY_RIGHT_COLLAPSED, String(rightCollapsed)); } catch {}
  }, [rightCollapsed]);

  const handleLeftResize = useCallback((w: number) => {
    const opposite = rightCollapsed ? RIGHT_COLLAPSED_WIDTH : rightWidth;
    const maxAllowed = window.innerWidth - opposite - CENTER_MIN;
    setLeftWidth(clamp(Math.min(w, maxAllowed), LEFT_MIN, LEFT_MAX));
  }, [rightCollapsed, rightWidth]);

  const handleRightResize = useCallback((w: number) => {
    const opposite = leftCollapsed ? LEFT_COLLAPSED_WIDTH : leftWidth;
    const maxAllowed = window.innerWidth - opposite - CENTER_MIN;
    setRightWidth(Math.max(RIGHT_MIN, Math.min(w, maxAllowed)));
  }, [leftCollapsed, leftWidth]);

  const handleDragStart = useCallback(() => setIsDraggingDivider(true), []);
  const handleDragEnd = useCallback(() => setIsDraggingDivider(false), []);

  // Window-resize tolerance: track width and shrink panes that overflow.
  useEffect(() => {
    const onResize = () => {
      const winW = window.innerWidth;
      setWindowWidth(winW);
      const lw = leftCollapsed ? LEFT_COLLAPSED_WIDTH : leftWidth;
      const rw = rightCollapsed ? RIGHT_COLLAPSED_WIDTH : rightWidth;
      const overflow = lw + rw + CENTER_MIN - winW;
      if (overflow <= 0) return;
      // Shrink right first
      if (!rightCollapsed) {
        const newRight = Math.max(RIGHT_MIN, rightWidth - overflow);
        const shaved = rightWidth - newRight;
        setRightWidth(newRight);
        const remaining = overflow - shaved;
        if (remaining > 0 && !leftCollapsed) {
          setLeftWidth(Math.max(LEFT_MIN, leftWidth - remaining));
        }
      } else if (!leftCollapsed) {
        setLeftWidth(Math.max(LEFT_MIN, leftWidth - overflow));
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [leftCollapsed, rightCollapsed, leftWidth, rightWidth]);

  // Keyboard shortcuts: Ctrl/Cmd+B toggles left, Ctrl/Cmd+/ toggles right.
  // Don't intercept when an input/textarea/contentEditable has focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;
      }
      if (e.key === 'b' || e.key === 'B') {
        e.preventDefault();
        setLeftCollapsed((v) => !v);
      } else if (e.key === '/') {
        e.preventDefault();
        setRightCollapsed((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // When un-collapsing a pane, clamp its restored width against current
  // window + opposite pane so the center pane never gets squeezed below
  // CENTER_MIN (e.g. user collapsed on a big window, resized down, then
  // expanded — old width may no longer fit).
  const toggleLeftCollapsed = useCallback(() => {
    setLeftCollapsed((prev) => {
      const next = !prev;
      if (!next) {
        const opposite = rightCollapsed ? RIGHT_COLLAPSED_WIDTH : rightWidth;
        const maxAllowed = Math.max(LEFT_MIN, window.innerWidth - opposite - CENTER_MIN);
        setLeftWidth((w) => Math.min(Math.max(w, LEFT_MIN), maxAllowed, LEFT_MAX));
      }
      return next;
    });
  }, [rightCollapsed, rightWidth]);
  const toggleRightCollapsed = useCallback(() => {
    setRightCollapsed((prev) => {
      const next = !prev;
      if (!next) {
        const opposite = leftCollapsed ? LEFT_COLLAPSED_WIDTH : leftWidth;
        const maxAllowed = Math.max(RIGHT_MIN, window.innerWidth - opposite - CENTER_MIN);
        setRightWidth((w) => Math.min(Math.max(w, RIGHT_MIN), maxAllowed));
      }
      return next;
    });
  }, [leftCollapsed, leftWidth]);
  // ----------------------------------------------------------------------

  // First-use / empty-state UX: auto-open the add-target entry whenever the
  // list is empty (initial load with no targets, or after the user clears the
  // last one). Equivalent to the user clicking the "+" button automatically.
  useEffect(() => {
    if (loading) return;
    if (targets.length === 0 && !showAddForm) {
      setAddError(null);
      setShowAddForm(true);
    }
  }, [loading, targets.length, showAddForm]);

  // When active chat changes, tell the chat engine to switch sessions so
  // the embedded ChatView reflects the right history.
  useEffect(() => {
    if (!targetChats.active) return;
    const { chatId, chatSessionId } = targetChats.active;
    (async () => {
      try {
        await window.electronAPI.agentChat.switchToChatSession(chatId, chatSessionId);
        // Mirror the switch in the renderer cache so the embedded ChatView
        // (compact mode) sees the active session and skips its bootstrap.
        agentChatSessionCacheManager.setCurrentChatSessionId(chatId, chatSessionId);
      } catch (err) {
        console.error('[ResearchPage] switchToChatSession failed:', err);
      }
    })();
  }, [targetChats.active]);

  const loadFiles = useCallback(
    async (code: string) => {
      if (filesByCodeRef.current[code]) return;
      const files = await getTargetFiles(code);
      setFilesByCode((prev) => ({ ...prev, [code]: files }));
    },
    [getTargetFiles],
  );

  const handleSelectTarget = useCallback(
    async (code: string) => {
      setSelectedCode(code);
      setExpandedCodes((prev) => {
        const next = new Set(prev);
        next.add(code);
        return next;
      });
      await loadFiles(code);
      const target = targetsRef.current.find((t) => t.stock_code === code);
      await targetChats.selectChatForTarget(code, target);
    },
    [loadFiles, targetChats],
  );

  const handleSelectChat = useCallback(
    async (code: string, chatSessionId: string) => {
      const target = targetsRef.current.find((t) => t.stock_code === code);
      // Also activate the target so the chat-pane header reflects it.
      setSelectedCode(code);
      await targetChats.selectChatForTarget(code, target, chatSessionId);
    },
    [targetChats],
  );

  const handleNewChat = useCallback(
    async (code: string) => {
      const target = targetsRef.current.find((t) => t.stock_code === code);
      setSelectedCode(code);
      await targetChats.createChatForTarget(code, target);
    },
    [targetChats],
  );

  const handleDeleteChat = useCallback(
    async (code: string, chatSessionId: string) => {
      await targetChats.deleteChat(code, chatSessionId);
    },
    [targetChats],
  );

  const handleRenameChat = useCallback(
    async (code: string, chatSessionId: string, title: string) => {
      await targetChats.renameChat(code, chatSessionId, title);
    },
    [targetChats],
  );

  const handleToggleExpand = useCallback(
    (code: string) => {
      setExpandedCodes((prev) => {
        const next = new Set(prev);
        if (next.has(code)) {
          next.delete(code);
        } else {
          next.add(code);
          loadFiles(code);
          // Lazy-load chat list when the row is expanded the first time.
          targetChats.loadChats(code).catch(() => { /* logged inside */ });
        }
        return next;
      });
    },
    [loadFiles, targetChats],
  );

  const handleOpenFile = useCallback(
    (file: TargetFile) => {
      const tabId = file.absPath;
      // Derive the breadcrumb prefix from whichever target this file belongs to.
      // Format mirrors the screenshot reference: "<name>.<market>" (e.g. "携程集团.HK").
      const owningTarget = targetsRef.current.find((t) => file.absPath.startsWith(t.directory));
      const pathPrefix = owningTarget
        ? `${owningTarget.name}.${owningTarget.stock_code.split('.').pop() ?? owningTarget.stock_code}`
        : undefined;

      let isNew = false;
      setTabs((prev) => {
        const existing = prev.find((t) => t.id === tabId);
        if (existing) return prev;
        isNew = true;
        const newTab: Tab = {
          id: tabId,
          label: file.relPath.split('/').pop() ?? file.relPath,
          filePath: file.absPath,
          // Start with empty content; if the file is missing or empty it will
          // simply render as an empty document (consistent across key-drivers.md,
          // notes.md and tracking.md).
          content: '',
          type: 'markdown',
          mtime: file.mtime,
          pathPrefix,
        };
        return [...prev, newTab];
      });
      setActiveTabId(tabId);
      setActiveFileAbsPath(file.absPath);

      // Always (re)load file content on open so HMR / stale tabs never get
      // stuck with empty content. Local file reads are cheap.
      void (async () => {
        try {
          const result: any = await window.electronAPI.fs!.readFile(file.absPath, 'utf-8');
          // eslint-disable-next-line no-console
          console.debug('[ResearchPage] fs:readFile', file.absPath, {
            success: result?.success,
            size: result?.size,
            contentLen: typeof result?.content === 'string' ? result.content.length : -1,
            error: result?.error,
          });
          let text: string;
          if (result && result.success && typeof result.content === 'string') {
            text = result.content;
          } else {
            const errMsg = result?.error ?? '请求失败';
            text = `(无法读取文件: ${errMsg})`;
          }
          setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, content: text } : t)));
        } catch (err: any) {
          const msg = err?.message ?? String(err);
          setTabs((prev) =>
            prev.map((t) => (t.id === tabId ? { ...t, content: `(无法读取文件: ${msg})` } : t)),
          );
        }
      })();
      // Silence unused-var warning when not in dev; isNew is intentionally tracked
      // for potential future use (e.g. focus management on new tabs).
      void isNew;
    },
    [],
  );

  const handleOpenAddForm = useCallback(() => {
    setAddError(null);
    setShowAddForm(true);
  }, []);

  const handleSubmitAddTarget = useCallback(async (code: string, name: string) => {
    const c = code.trim();
    const n = name.trim();
    if (!c || !n) {
      setAddError('请选择股票');
      return;
    }
    setAddBusy(true);
    setAddError(null);
    const result = await initTarget(c, n);
    setAddBusy(false);
    if (!result.success) {
      setAddError(result.error || '添加失败');
      return;
    }
    setShowAddForm(false);
  }, [initTarget]);

  const handleCancelAddTarget = useCallback(() => {
    setShowAddForm(false);
    setAddError(null);
  }, []);

  const handleTabSelect = useCallback((id: string) => {
    setActiveTabId(id);
    setActiveFileAbsPath(id);
  }, []);

  const handleDeleteTarget = useCallback(
    async (code: string, name: string) => {
      // Open the in-app confirm dialog; the actual delete runs in confirmDeleteTarget.
      setPendingDelete({ code, name });
    },
    [],
  );

  const confirmDeleteTarget = useCallback(
    async () => {
      if (!pendingDelete) return;
      const { code } = pendingDelete;
      setDeleteBusy(true);
      const result = await deleteTarget(code);
      setDeleteBusy(false);
      if (!result.success) {
        setPendingDelete(null);
        window.alert(`Failed to delete: ${result.error || 'Unknown error'}`);
        return;
      }
      setPendingDelete(null);
      // Cascade-delete: remove all chat sessions bound to this target.
      const chats = targetChats.chatsByCode[code];
      if (chats && chats.length > 0) {
        await Promise.all(
          chats.map((c) =>
            targetChats.deleteChat(code, c.chatSession_id).catch((err) => {
              console.error('[ResearchPage] cascade-delete chat failed:', err);
            }),
          ),
        );
      }
      // Cleanup: close any open tabs belonging to this target, drop cached files,
      // collapse the row, and clear selection if it was active.
      const files = filesByCodeRef.current[code];
      const absPathsToClose = new Set<string>(
        (files ?? []).map((f) => f.absPath),
      );
      setTabs((prev) => prev.filter((t) => !absPathsToClose.has(t.id)));
      setActiveTabId((prev) => (absPathsToClose.has(prev) ? '' : prev));
      setActiveFileAbsPath((prev) => (prev && absPathsToClose.has(prev) ? null : prev));
      setFilesByCode((prev) => {
        const next = { ...prev };
        delete next[code];
        return next;
      });
      setExpandedCodes((prev) => {
        if (!prev.has(code)) return prev;
        const next = new Set(prev);
        next.delete(code);
        return next;
      });
      setSelectedCode((prev) => (prev === code ? null : prev));
    },
    [pendingDelete, deleteTarget, targetChats],
  );

  const handleTabClose = useCallback(
    (id: string) => {
      setTabs((prev) => prev.filter((t) => t.id !== id));
      if (activeTabId === id) {
        const remaining = tabs.filter((t) => t.id !== id);
        const nextId = remaining.length > 0 ? remaining[0].id : '';
        setActiveTabId(nextId);
        setActiveFileAbsPath(nextId || null);
      }
    },
    [activeTabId, tabs],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
        Loading portfolio...
      </div>
    );
  }

  return (
    <LayoutProvider>
    <PasteToWorkspaceProvider>
    <div data-theme="research" className="flex h-full w-full">
      {leftCollapsed ? (
        <div
          className="rw-pane-left rw-pane-left--collapsed"
          onClick={toggleLeftCollapsed}
          title="Expand sidebar (Ctrl+B)"
          style={{ width: LEFT_COLLAPSED_WIDTH, flex: `0 0 ${LEFT_COLLAPSED_WIDTH}px` }}
        >
          <button
            type="button"
            className="rw-side-icon-btn"
            aria-label="Expand sidebar"
            onClick={(e) => { e.stopPropagation(); toggleLeftCollapsed(); }}
          >
            <PanelLeftOpen size={14} />
          </button>
        </div>
      ) : (
        <div
          className="flex flex-col"
          style={{
            width: leftWidth,
            flex: `0 0 ${leftWidth}px`,
            transition: isDraggingDivider ? 'none' : 'width 0.2s ease, flex-basis 0.2s ease',
            overflow: 'hidden',
          }}
        >
          <TargetListSidebar
            targets={targets}
            selectedCode={selectedCode}
            expandedCodes={expandedCodes}
            filesByCode={filesByCode}
            activeFileAbsPath={activeFileAbsPath}
            onSelectTarget={handleSelectTarget}
            onToggleExpand={handleToggleExpand}
            onOpenFile={handleOpenFile}
            onAddTarget={handleOpenAddForm}
            onDeleteTarget={handleDeleteTarget}
            addFormOpen={showAddForm}
            onOpenSearch={handleCancelAddTarget}
            chatsByCode={targetChats.chatsByCode}
            activeChatSessionId={targetChats.active?.chatSessionId ?? null}
            onSelectChat={handleSelectChat}
            onNewChat={handleNewChat}
            onDeleteChat={handleDeleteChat}
            onRenameChat={handleRenameChat}
            width={leftWidth}
            onCollapse={toggleLeftCollapsed}
            topSlot={showAddForm ? (
              <AddTargetSearch
                busy={addBusy}
                error={addError}
                onSubmit={handleSubmitAddTarget}
                onCancel={handleCancelAddTarget}
              />
            ) : null}
          />
        </div>
      )}
      {!leftCollapsed && (
        <ResizableDivider
          onResize={handleLeftResize}
          minWidth={LEFT_MIN}
          maxWidth={dynLeftMax}
          currentWidth={leftWidth}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        />
      )}
      <ContentTabs
        tabs={tabs}
        activeTabId={activeTabId}
        onTabSelect={handleTabSelect}
        onTabClose={handleTabClose}
      />
      {!rightCollapsed && (
        <ResizableDivider
          onResize={handleRightResize}
          minWidth={RIGHT_MIN}
          maxWidth={dynRightMax}
          currentWidth={rightWidth}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          invert
        />
      )}
      <div
        style={{
          flex: `0 0 ${rightCollapsed ? RIGHT_COLLAPSED_WIDTH : rightWidth}px`,
          transition: isDraggingDivider ? 'none' : 'flex-basis 0.2s ease',
          display: 'flex',
        }}
      >
        <ResearchChatPane
          activeFileAbsPath={activeFileAbsPath}
          targetName={selectedCode ? (targets.find((t) => t.stock_code === selectedCode)?.name ?? null) : null}
          targetCode={selectedCode}
          chatTitle={(() => {
            const sid = targetChats.active?.chatSessionId;
            if (!sid || !selectedCode) return null;
            const list = targetChats.chatsByCode[selectedCode];
            return list?.find((c) => c.chatSession_id === sid)?.title ?? null;
          })()}
          width={rightWidth}
          collapsed={rightCollapsed}
          onToggleCollapsed={toggleRightCollapsed}
        />
      </div>
      <Dialog open={!!pendingDelete} onOpenChange={(open) => { if (!open && !deleteBusy) setPendingDelete(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete target?</DialogTitle>
          </DialogHeader>
          <div className="text-sm text-gray-600 py-2">
            {pendingDelete
              ? `Delete target "${pendingDelete.name}" (${pendingDelete.code})? It will be moved to the system recycle bin.`
              : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)} disabled={deleteBusy}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDeleteTarget} disabled={deleteBusy}>
              {deleteBusy ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </PasteToWorkspaceProvider>
    </LayoutProvider>
  );
};
