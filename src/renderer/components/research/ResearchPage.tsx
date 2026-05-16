import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { PanelLeftOpen } from 'lucide-react';
import { TargetListSidebar } from './TargetListSidebar';
import { ContentTabs, Tab } from './ContentTabs';
import { ResearchChatPane } from './ResearchChatPane';
import { AddTargetSearch } from './AddTargetSearch';
import { usePortfolio, TargetFile } from './usePortfolio';
import { useTargetChats } from './useTargetChats';
import { useStellaChats } from './useStellaChats';
import { useTabsByCode } from './useTabsByCode';
import { useResearchSelection } from './useResearchSelection';
import {
  openTab as openTabRec,
  closeTab as closeTabRec,
  activateTab as activateTabRec,
  reconcileWithFileSystem,
  sortedTabs,
} from './tabState';
import { LayoutProvider } from '../layout/LayoutProvider';
import { PasteToWorkspaceProvider } from '../chat/workspace/PasteToWorkspaceProvider';
import { agentChatSessionCacheManager } from '../../lib/chat/agentChatSessionCacheManager';
import { profileDataManager } from '@renderer/lib/userData';
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
  // Per-target tab state (persisted to localStorage). Each entry holds an
  // ordered list of TabRecord (absPath + fractional sortKey) plus the
  // currently-active absPath. Switching targets restores both order and
  // active selection.
  const profileAlias = profileDataManager.getCurrentUserAlias() ?? '';
  const knownCodes = useMemo(
    () => new Set(targets.map((t) => t.stock_code)),
    [targets],
  );
  // Pass `null` until the portfolio finishes loading (so orphan cleanup
  // doesn't fire with an empty knownCodes set and wipe valid state).
  const { tabsByCode, setTabsByCode, flushNow } = useTabsByCode(
    profileAlias,
    loading ? null : knownCodes,
  );
  // Left-sidebar selection (selectedCode + expandedCodes + expandedCats)
  // persists to localStorage so it survives both intra-session navigation
  // (e.g. /research → /settings → Back, which unmounts ResearchPage) and
  // full app restart.
  const {
    selectedCode,
    setSelectedCode,
    expandedCodes,
    setExpandedCodes,
    expandedCats,
    setExpandedCats,
    flushNow: flushSelection,
    hydrated: selectionHydrated,
  } = useResearchSelection(profileAlias, loading ? null : knownCodes);

  // Top-level Research mode: workspace tree vs Ask Stella global chat.
  // Not persisted by design — always defaults to 'workspace' on app start.
  const [activeMode, setActiveMode] = useState<'workspace' | 'stella'>('workspace');
  const stella = useStellaChats();
  const [showAddForm, setShowAddForm] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addBusy, setAddBusy] = useState(false);
  const [filesByCode, setFilesByCode] = useState<Record<string, TargetFile[]>>({});
  // In-app confirm dialog state for delete-target. We avoid window.confirm()
  // because the native modal steals focus from the renderer; when the
  // following <AddTargetSearch> auto-mounts, its input.focus() becomes a
  // no-op until the user manually re-activates the window.
  const [pendingDelete, setPendingDelete] = useState<{ code: string; name: string } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // File-content cache, keyed by absPath. Populated lazily when a tab
  // becomes visible. Not persisted (intentional — too big and re-readable).
  // Bumping `contentCacheVersion` after a write triggers a re-render so
  // visibleTabs picks up the new content.
  const fileContentCacheRef = useRef<Map<string, { content: string; mtime: number }>>(new Map());
  const [contentCacheVersion, setContentCacheVersion] = useState(0);
  // Track in-flight reads to avoid duplicate fetches when visibleTabs churns.
  const inflightReadsRef = useRef<Set<string>>(new Set());

  const filesByCodeRef = useRef(filesByCode);
  filesByCodeRef.current = filesByCode;

  const targetChats = useTargetChats();
  const targetsRef = useRef(targets);
  targetsRef.current = targets;
  // Ref mirror of selectedCode so async effects can race-check it.
  const selectedCodeRef = useRef(selectedCode);
  selectedCodeRef.current = selectedCode;

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

  // Restore the last-active target on mount (after targets load). One-shot:
  // only fires when nothing is selected yet so user navigation is never overridden.
  const restoredTargetRef = useRef(false);
  useEffect(() => {
    if (restoredTargetRef.current) return;
    if (loading) return;
    if (targets.length === 0) return;
    if (selectedCode) { restoredTargetRef.current = true; return; }
    const api = (window as any).electronAPI?.researchTarget;
    if (!api?.getLastActive) { restoredTargetRef.current = true; return; }
    restoredTargetRef.current = true;
    (async () => {
      try {
        const res = await api.getLastActive();
        const code: string | null | undefined = res?.data;
        if (!code) return;
        if (!targets.some((t) => t.stock_code === code)) return;
        await handleSelectTarget(code);
      } catch (e) {
        console.warn('[ResearchPage] restore last-active target failed:', e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, targets.length]);

  // Persist last-active target whenever the selection changes (research workspace).
  // Skip the initial mount: selectedCode starts as null, and writing that null
  // would clobber the stored value before the restore effect has a chance to read it.
  const persistedTargetRef = useRef(false);
  useEffect(() => {
    if (!persistedTargetRef.current) {
      // Allow persisting once restore is done OR once user picks a target.
      if (!restoredTargetRef.current && selectedCode === null) return;
      persistedTargetRef.current = true;
    }
    const api = (window as any).electronAPI?.researchTarget;
    if (!api?.setLastActive) return;
    void api.setLastActive(selectedCode).catch((e: unknown) => {
      console.warn('[ResearchPage] persist last-active target failed:', e);
    });
  }, [selectedCode]);

  // When active chat changes, tell the chat engine to switch sessions so
  // the embedded ChatView reflects the right history.
  useEffect(() => {
    // In Stella mode, the stella effect below owns the active session.
    if (activeMode === 'stella') return;
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
  }, [targetChats.active, activeMode]);

  // Stella mode: when the active Stella session changes, switch the chat
  // engine to it (mirrors the target effect above).
  useEffect(() => {
    if (activeMode !== 'stella') return;
    if (!stella.active) return;
    const { chatId, chatSessionId } = stella.active;
    (async () => {
      try {
        await window.electronAPI.agentChat.switchToChatSession(chatId, chatSessionId);
        agentChatSessionCacheManager.setCurrentChatSessionId(chatId, chatSessionId);
      } catch (err) {
        console.error('[ResearchPage] switchToChatSession (stella) failed:', err);
      }
    })();
  }, [stella.active, activeMode]);

  // Mode switch: ensure the right chat session is active for the new mode.
  // - workspace: re-select the current target's chat (no-op if unchanged).
  // - stella: select (or auto-create) the most-recent Stella chat.
  const handleModeChange = useCallback(
    async (mode: 'workspace' | 'stella') => {
      if (mode === activeMode) return;
      setActiveMode(mode);
      if (mode === 'stella') {
        await stella.selectChat();
      } else if (selectedCode) {
        const target = targetsRef.current.find((t) => t.stock_code === selectedCode);
        await targetChats.selectChatForTarget(selectedCode, target);
      }
    },
    [activeMode, selectedCode, stella, targetChats],
  );

  const loadFiles = useCallback(
    async (code: string) => {
      if (filesByCodeRef.current[code]) return;
      const files = await getTargetFiles(code);
      setFilesByCode((prev) => ({ ...prev, [code]: files }));
    },
    [getTargetFiles],
  );

  // Post-hydration restore: when sessionStorage rehydrates a selectedCode
  // (e.g. user returned from /settings and ResearchPage just remounted),
  // re-trigger the per-target side effects that handleSelectTarget would
  // normally do (load files, restore chat). Fires once per (profileAlias,
  // selectedCode) pair to avoid clobbering subsequent user-driven changes.
  const hydratedOnceRef = useRef<string | null>(null);
  useEffect(() => {
    // Reset the guard when the profile changes so a different user gets
    // their own hydration pass.
    hydratedOnceRef.current = null;
  }, [profileAlias]);
  useEffect(() => {
    if (loading) return;
    if (!selectionHydrated) return;
    if (!selectedCode) return;
    if (hydratedOnceRef.current === selectedCode) return;
    const target = targetsRef.current.find((t) => t.stock_code === selectedCode);
    if (!target) return; // orphan cleanup will null it out shortly
    hydratedOnceRef.current = selectedCode;
    loadFiles(selectedCode);
    targetChats.selectChatForTarget(selectedCode, target).catch((err) => {
      console.error('[ResearchPage] post-hydration selectChatForTarget failed:', err);
    });
  }, [loading, selectionHydrated, selectedCode, targets, loadFiles, targetChats]);

  // Post-hydration: also load files + chat lists for every persisted
  // expanded target row, not just the selected one. Without this the
  // restored sub-category folder expansion (expandedCats) for unselected
  // targets has no files to render → the chevron renders disabled and
  // the user perceives the expansion state as lost.
  const expandedHydratedRef = useRef<string | null>(null);
  useEffect(() => {
    if (loading) return;
    if (!selectionHydrated) return;
    if (expandedHydratedRef.current === profileAlias) return;
    expandedHydratedRef.current = profileAlias;
    const known = new Set(targetsRef.current.map((t) => t.stock_code));
    for (const code of expandedCodes) {
      if (!known.has(code)) continue;
      loadFiles(code);
      targetChats.loadChats(code).catch(() => { /* logged inside */ });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, selectionHydrated, profileAlias, targets]);

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
      const target = targetsRef.current.find((t) => t.stock_code === code);
      await targetChats.deleteChat(code, chatSessionId, target);
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

  const handleToggleCat = useCallback(
    (key: string) => {
      setExpandedCats((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    },
    [setExpandedCats],
  );

  // Reverse-lookup the target that owns an arbitrary absPath. Returns the
  // stock_code or null if no target matches (e.g. the file's target was
  // deleted between persistence and rehydration).
  const findOwningCode = useCallback((absPath: string): string | null => {
    const t = targetsRef.current.find((tt) => absPath.startsWith(tt.directory));
    return t?.stock_code ?? null;
  }, []);

  // Async-load file content into the in-memory cache. Idempotent and
  // de-duplicates concurrent reads of the same path.
  const ensureContentLoaded = useCallback(async (absPath: string) => {
    if (fileContentCacheRef.current.has(absPath)) return;
    if (inflightReadsRef.current.has(absPath)) return;
    inflightReadsRef.current.add(absPath);
    try {
      const result: any = await window.electronAPI.fs!.readFile(absPath, 'utf-8');
      let text: string;
      let mtime = 0;
      if (result && result.success && typeof result.content === 'string') {
        text = result.content;
        if (typeof result.mtime === 'number') mtime = result.mtime;
      } else {
        const errMsg = result?.error ?? '请求失败';
        text = `(无法读取文件: ${errMsg})`;
      }
      fileContentCacheRef.current.set(absPath, { content: text, mtime });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      fileContentCacheRef.current.set(absPath, {
        content: `(无法读取文件: ${msg})`,
        mtime: 0,
      });
    } finally {
      inflightReadsRef.current.delete(absPath);
      setContentCacheVersion((v) => v + 1);
    }
  }, []);

  const handleOpenFile = useCallback(
    (file: TargetFile) => {
      const owningCode = findOwningCode(file.absPath);
      if (!owningCode) {
        console.warn('[ResearchPage] handleOpenFile: no owning target for', file.absPath);
        return;
      }
      // If the file belongs to a different target than the currently-selected
      // one, auto-switch so the user sees the tab they just opened.
      if (selectedCodeRef.current !== owningCode) {
        void handleSelectTarget(owningCode);
      }
      setTabsByCode((prev) => ({
        ...prev,
        [owningCode]: openTabRec(prev[owningCode], file.absPath),
      }));
      void ensureContentLoaded(file.absPath);
    },
    [findOwningCode, ensureContentLoaded, setTabsByCode, handleSelectTarget],
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
    // Layer 2 of the anti-bug defense: even if a previous delete didn't flush
    // (crash, race, etc.), defensively clear any persisted tab state for
    // this stock_code so the newly-recreated target starts clean.
    setTabsByCode((prev) => {
      if (!(c in prev)) return prev;
      const next = { ...prev };
      delete next[c];
      return next;
    });
    flushNow();
    setShowAddForm(false);
  }, [initTarget, setTabsByCode, flushNow]);

  const handleCancelAddTarget = useCallback(() => {
    setShowAddForm(false);
    setAddError(null);
  }, []);

  const handleTabSelect = useCallback(
    (id: string) => {
      const code = findOwningCode(id);
      if (!code) return;
      setTabsByCode((prev) => ({
        ...prev,
        [code]: activateTabRec(prev[code], id),
      }));
    },
    [findOwningCode, setTabsByCode],
  );

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
      // Cleanup: clear this target's tab state entirely (Layer 1 of the
      // anti-bug defense against recreated same-stockCode targets) and flush
      // synchronously so a quick re-add can't race with the debounced write.
      setTabsByCode((prev) => {
        if (!(code in prev)) return prev;
        const next = { ...prev };
        delete next[code];
        return next;
      });
      flushNow();
      // Drop cached file content belonging to this target's directory.
      const owningTarget = targetsRef.current.find((t) => t.stock_code === code);
      if (owningTarget) {
        const prefix = owningTarget.directory;
        for (const absPath of Array.from(fileContentCacheRef.current.keys())) {
          if (absPath.startsWith(prefix)) fileContentCacheRef.current.delete(absPath);
        }
      }
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
      // Flush selection state immediately so a quick re-add or app close
      // can't leave a stale selection of a now-deleted target.
      flushSelection();
    },
    [pendingDelete, deleteTarget, targetChats, setTabsByCode, flushNow, setExpandedCodes, setSelectedCode, flushSelection],
  );

  const handleTabClose = useCallback(
    (id: string) => {
      const code = findOwningCode(id);
      if (!code) return;
      setTabsByCode((prev) => ({
        ...prev,
        [code]: closeTabRec(prev[code], id),
      }));
    },
    [findOwningCode, setTabsByCode],
  );

  // Derived: tabs visible in the center pane (subset for the selected target).
  // Reads from fileContentCacheRef; `contentCacheVersion` is in the deps so
  // we re-derive whenever an async content read completes.
  const visibleTabs: Tab[] = useMemo(() => {
    if (!selectedCode) return [];
    const target = targets.find((t) => t.stock_code === selectedCode);
    if (!target) return [];
    const state = tabsByCode[selectedCode];
    if (!state) return [];
    const pathPrefix = `${target.name}.${target.stock_code.split('.').pop() ?? target.stock_code}`;
    return sortedTabs(state).map((rec) => {
      const cached = fileContentCacheRef.current.get(rec.absPath);
      return {
        id: rec.absPath,
        label: rec.absPath.split(/[\\/]/).pop() ?? rec.absPath,
        filePath: rec.absPath,
        content: cached?.content ?? '',
        type: 'markdown' as const,
        mtime: cached?.mtime ?? 0,
        pathPrefix,
      };
    });
    // contentCacheVersion intentionally tracked to refresh content cells.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCode, tabsByCode, targets, contentCacheVersion]);

  const activeTabId = (selectedCode && tabsByCode[selectedCode]?.activeAbsPath) || '';
  const activeFileAbsPath: string | null = activeTabId || null;

  // Lazily load file content for any visible tab that hasn't been read yet.
  useEffect(() => {
    for (const t of visibleTabs) {
      if (!fileContentCacheRef.current.has(t.id)) {
        void ensureContentLoaded(t.id);
      }
    }
  }, [visibleTabs, ensureContentLoaded]);

  // Reconcile persisted tab state with the filesystem when the user switches
  // target. Files that no longer exist are dropped; if the active tab was
  // dropped, fall back right-first-then-left over the original sort order.
  useEffect(() => {
    if (!selectedCode) return;
    const state = tabsByCode[selectedCode];
    if (!state || state.tabs.length === 0) return;
    const absPaths = state.tabs.map((r) => r.absPath);
    let cancelled = false;
    (async () => {
      const checks = await Promise.all(
        absPaths.map(async (p) => {
          try {
            const exists = await window.electronAPI.fs!.exists(p);
            return { p, ok: exists === true };
          } catch {
            return { p, ok: false };
          }
        }),
      );
      if (cancelled) return;
      if (selectedCodeRef.current !== selectedCode) return;
      const validPaths = new Set(checks.filter((c) => c.ok).map((c) => c.p));
      if (validPaths.size === absPaths.length) return; // all good
      setTabsByCode((prev) => {
        const cur = prev[selectedCode];
        if (!cur) return prev;
        const next = reconcileWithFileSystem(cur, validPaths);
        if (next === cur) return prev;
        return { ...prev, [selectedCode]: next };
      });
    })();
    return () => {
      cancelled = true;
    };
    // tabsByCode intentionally omitted; we only re-check on target switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCode, setTabsByCode]);

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
            activeMode={activeMode}
            onModeChange={handleModeChange}
            targets={targets}
            selectedCode={selectedCode}
            expandedCodes={expandedCodes}
            expandedCats={expandedCats}
            filesByCode={filesByCode}
            activeFileAbsPath={activeFileAbsPath}
            onSelectTarget={handleSelectTarget}
            onToggleExpand={handleToggleExpand}
            onToggleCat={handleToggleCat}
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
            stellaChats={stella.chats}
            stellaActiveSessionId={stella.active?.chatSessionId ?? null}
            onSelectStellaChat={(sid) => stella.selectChat(sid)}
            onNewStellaChat={() => stella.createChat()}
            onDeleteStellaChat={(sid) => stella.deleteChat(sid)}
            onRenameStellaChat={(sid, t) => stella.renameChat(sid, t)}
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
      {activeMode === 'workspace' && (
        <ContentTabs
          tabs={visibleTabs}
          activeTabId={activeTabId}
          onTabSelect={handleTabSelect}
          onTabClose={handleTabClose}
        />
      )}
      {!rightCollapsed && activeMode === 'workspace' && (
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
          flex: activeMode === 'stella'
            ? '1 1 0'
            : `0 0 ${rightCollapsed ? RIGHT_COLLAPSED_WIDTH : rightWidth}px`,
          minWidth: 0,
          transition: isDraggingDivider ? 'none' : 'flex-basis 0.2s ease',
          display: 'flex',
        }}
      >
        <ResearchChatPane
          activeFileAbsPath={activeFileAbsPath}
          mode={activeMode}
          targetName={activeMode === 'stella'
            ? 'Ask Stella'
            : (selectedCode ? (targets.find((t) => t.stock_code === selectedCode)?.name ?? null) : null)}
          targetCode={activeMode === 'stella' ? null : selectedCode}
          chatTitle={(() => {
            if (activeMode === 'stella') {
              const sid = stella.active?.chatSessionId;
              if (!sid || !stella.chats) return null;
              return stella.chats.find((c) => c.chatSession_id === sid)?.title ?? null;
            }
            const sid = targetChats.active?.chatSessionId;
            if (!sid || !selectedCode) return null;
            const list = targetChats.chatsByCode[selectedCode];
            return list?.find((c) => c.chatSession_id === sid)?.title ?? null;
          })()}
          width={activeMode === 'stella' ? undefined : rightWidth}
          fill={activeMode === 'stella'}
          collapsed={activeMode === 'stella' ? false : rightCollapsed}
          onToggleCollapsed={activeMode === 'stella' ? undefined : toggleRightCollapsed}
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
