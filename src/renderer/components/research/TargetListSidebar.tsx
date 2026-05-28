import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  ChevronRight,
  ChevronDown,
  Folder,
  FolderClosed,
  FileText,
  FileCode,
  Trash2,
  Search,
  MoreHorizontal,
  MessageSquare,
  Pencil,
  Settings,
  PanelLeftClose,
  LogOut,
} from 'lucide-react';
import type { TargetFile, MoveResult } from './usePortfolio';
import type { ResearchChatSessionMeta } from './researchChatIpc';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { useTargetTreeClipboard } from './useTargetTreeClipboard';
import { MoveConflictDialog, MoveConflictChoice } from './MoveConflictDialog';
import { CrossTargetMoveConfirmDialog } from './CrossTargetMoveConfirmDialog';
import { RenameFileDialog } from './RenameFileDialog';
import { TargetTreeFileContextMenu } from './TargetTreeFileContextMenu';
import { TargetTreeFolderContextMenu } from './TargetTreeFolderContextMenu';
import { CreateItemDialog } from './CreateItemDialog';
import { useToast } from '../ui/ToastProvider';

export interface Target {
  stock_code: string;
  name: string;
  industry: string;
  follow_date: string;
  directory: string;
  /**
   * True when this target tracks a publicly-listed company (has a real
   * stock ticker). False when it tracks an unlisted/private company.
   * For unlisted targets, `stock_code` is a synthetic placeholder equal
   * to `name` (chosen so the renderer's stock_code-keyed maps keep
   * non-empty unique keys). UI should render "未上市" instead of the
   * code in those cases.
   */
  listed?: boolean;
}

interface TargetListSidebarProps {
  /** Top-level mode: workspace tree vs Ask Stella global chat list. */
  activeMode: 'workspace' | 'stella';
  onModeChange: (mode: 'workspace' | 'stella') => void;
  targets: Target[];
  selectedCode: string | null;
  expandedCodes: Set<string>;
  /** Expanded sub-category folder keys, shaped `<code>::<category>`. */
  expandedCats: Set<string>;
  filesByCode: Record<string, TargetFile[] | undefined>;
  activeFileAbsPath: string | null;
  onSelectTarget: (code: string) => void;
  onToggleExpand: (code: string) => void;
  onToggleCat: (key: string) => void;
  onOpenFile: (file: TargetFile) => void;
  onAddTarget: () => void;
  onDeleteTarget: (code: string, name: string) => void;
  /** Workspace root absolute path. Required for path-prefix safety checks. */
  workspaceDir?: string;
  /** Move a file. Resolves to MoveResult so the sidebar can show a conflict dialog. */
  onMoveFile?: (sourceAbs: string, destDirAbs: string, onConflict?: 'fail' | 'rename' | 'overwrite') => Promise<MoveResult>;
  /** Rename a file in place. */
  onRenameFile?: (sourceAbs: string, newName: string) => Promise<MoveResult>;
  /** Move a file to the OS trash. */
  onTrashFile?: (sourceAbs: string) => Promise<{ success: boolean; error?: string }>;
  /**
   * Force-reload the file list for a target. Used after creating files
   * via `fs:writeTextFileSafe` (which suppresses the watcher echo to
   * avoid clobbering open editor buffers — but that suppression also
   * stops fresh creates from refreshing the tree, so we ping manually).
   */
  onRefreshTarget?: (code: string) => void;
  /** Optional slot rendered above the tree (e.g. add-target combobox). */
  topSlot?: React.ReactNode;
  /** Whether the add-target slot is currently visible. The sidebar uses
   *  this only to drive the toolbar button's pressed/active state — the
   *  open/close lifecycle itself is owned by the parent. */
  addFormOpen?: boolean;
  // --- Target ↔ Chat binding ---
  /** chats[code] → sessions for that target (undefined = not yet loaded). */
  chatsByCode?: Record<string, ResearchChatSessionMeta[] | undefined>;
  /** Currently-active chatSession id (highlighted in the list). */
  activeChatSessionId?: string | null;
  onSelectChat?: (code: string, chatSessionId: string) => void;
  onNewChat?: (code: string) => void;
  onDeleteChat?: (code: string, chatSessionId: string) => void;
  onRenameChat?: (code: string, chatSessionId: string, newTitle: string) => void;
  /** Width of the sidebar in pixels. Caller is responsible for clamping. */
  width?: number;
  /** When provided, a PanelLeftClose button is rendered next to the Workspace title. */
  onCollapse?: () => void;

  // --- Ask Stella mode ---
  /** All Stella global chat sessions (undefined = not yet loaded). */
  stellaChats?: ResearchChatSessionMeta[];
  /** Currently-active Stella chat session id (highlighted). */
  stellaActiveSessionId?: string | null;
  onSelectStellaChat?: (chatSessionId: string) => void;
  onNewStellaChat?: () => void;
  onDeleteStellaChat?: (chatSessionId: string) => void;
  onRenameStellaChat?: (chatSessionId: string, newTitle: string) => void;

  // --- Ask tab unified list (all chats, including target-bound) ---
  /**
   * The full chronological list of every chat session under the active
   * chat config. When present, the Ask tab renders this list instead of
   * the legacy Stella-only list. Each entry may carry a `targetCode`;
   * rows with non-null targetCode get a small pill in front of the title.
   */
  allChats?: ResearchChatSessionMeta[];
  /** Active session id used for the Ask list's is-active highlight. */
  liveChatSessionId?: string | null;
  /** Click handler for any row in the Ask list. Routes by targetCode. */
  onSelectAnyChat?: (chatSessionId: string, targetCode: string | null) => void;
  /** Delete handler — routed to the right hook by targetCode. */
  onDeleteAnyChat?: (chatSessionId: string, targetCode: string | null) => void;
  /** Rename handler — routed to the right hook by targetCode. */
  onRenameAnyChat?: (chatSessionId: string, targetCode: string | null, newTitle: string) => void;
  /**
   * Lookup display label for a target pill. The renderer needs to map
   * `targetCode` to a short pill string (e.g. `00700.HK`, `海底捞`).
   * Falls back to the raw targetCode when this map doesn't have an entry.
   */
  targetPillLookup?: (targetCode: string) => string;
}

const SUBCATEGORIES = ['纪要', '专家交流', '公司交流', '研报', '模型', '公告', '其它'];

function fileIcon(relPath: string) {
  if (/\.(md|yaml|txt)$/i.test(relPath)) return FileText;
  if (/\.json$/i.test(relPath)) return FileCode;
  return FileText;
}

export const TargetListSidebar: React.FC<TargetListSidebarProps> = ({
  activeMode,
  onModeChange,
  targets,
  selectedCode,
  expandedCodes,
  expandedCats,
  filesByCode,
  activeFileAbsPath,
  onSelectTarget,
  onToggleExpand,
  onToggleCat,
  onOpenFile,
  onAddTarget,
  onDeleteTarget,
  workspaceDir = '',
  onMoveFile,
  onRenameFile,
  onTrashFile,
  onRefreshTarget,
  topSlot,
  addFormOpen,
  chatsByCode,
  activeChatSessionId,
  onSelectChat,
  onNewChat,
  onDeleteChat,
  onRenameChat,
  width = 240,
  onCollapse,
  stellaChats,
  stellaActiveSessionId,
  onSelectStellaChat,
  onNewStellaChat,
  onDeleteStellaChat,
  onRenameStellaChat,
  allChats,
  liveChatSessionId,
  onSelectAnyChat,
  onDeleteAnyChat,
  onRenameAnyChat,
  targetPillLookup,
}) => {
  const { showError, showSuccess } = useToast();
  const clipboard = useTargetTreeClipboard();

  // File-tree drag-and-drop / context-menu / dialog state.
  type FileRef = { absPath: string; fileName: string; ownerCode: string; isProtected: boolean };
  const [pendingMoveConflict, setPendingMoveConflict] = useState<{
    source: FileRef;
    destDirAbs: string;
    destDirLabel: string;
  } | null>(null);
  const [pendingCrossTargetMove, setPendingCrossTargetMove] = useState<{
    source: FileRef;
    destDirAbs: string;
    fromTargetName: string;
    toTargetName: string;
  } | null>(null);
  const [pendingRenameFile, setPendingRenameFile] = useState<FileRef | null>(null);
  const [pendingDeleteFile, setPendingDeleteFile] = useState<FileRef | null>(null);
  // User-created subfolder pending trash confirmation. Triggered by the
  // 删除 item in the folder context menu.
  const [pendingDeleteFolder, setPendingDeleteFolder] = useState<{
    folderAbsPath: string;
    folderName: string;
    ownerCode: string;
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    file: FileRef;
    position: { top: number; left: number };
  } | null>(null);
  // Folder context menu (right-click on a target row or a subcategory row).
  const [folderContextMenu, setFolderContextMenu] = useState<{
    folderAbsPath: string;
    folderName: string;
    ownerCode: string;
    position: { top: number; left: number };
  } | null>(null);
  // "New file" / "New folder" prompt — opened from the folder context menu.
  const [pendingCreate, setPendingCreate] = useState<{
    kind: 'file' | 'folder';
    parentDirAbs: string;
    parentLabel: string;
    ownerCode: string;
  } | null>(null);
  // Optimistic top-level folders per target. The on-disk listing returned by
  // `portfolio_get_target_files` skips empty directories, so a freshly
  // mkdir'd folder is invisible until it contains a file. We stitch
  // user-created top-level folders into the `extras` calculation below so
  // they appear immediately. Entries naturally dedupe with disk-derived
  // categories (Set), and become harmless once files are added.
  // Tracks user-created folders that may be empty on disk. Each value is
  // a list of POSIX-style relPaths under that target's directory (e.g.
  // "test" for a top-level folder or "研报/test" for a nested one).
  // Empty dirs aren't returned by the file listing tool, so without this
  // state they would be invisible until a file is added.
  const [optimisticFolders, setOptimisticFolders] = useState<Record<string, string[]>>({});
  // Active drop highlight; key is `${code}` for the target's root or
  // `${code}::${cat}` for a sub-category folder.
  const [dropHover, setDropHover] = useState<string | null>(null);
  const fileTreeFocusRef = useRef<HTMLDivElement | null>(null);

  // In-app confirm/rename dialog state. We avoid window.confirm() and
  // window.prompt() because on Electron + Windows those native dialogs
  // briefly steal OS-level keyboard focus and don't fully release it back
  // to the BrowserWindow on close. The visible symptom is: after deleting
  // a chat, clicking the chat input shows a focus ring but no caret blinks
  // and keystrokes are dropped — switching to any other OS window and back
  // restores keyboard input. Using an in-app <Dialog> keeps focus inside
  // the same WebContents and avoids the bug entirely.
  type ChatRef =
    | { kind: 'stella'; code?: undefined; sessionId: string; title: string }
    | { kind: 'workspace'; code: string; sessionId: string; title: string }
    | { kind: 'ask'; code?: undefined; targetCode: string | null; sessionId: string; title: string };
  const [pendingDeleteChat, setPendingDeleteChat] = useState<ChatRef | null>(null);
  const [pendingRenameChat, setPendingRenameChat] = useState<ChatRef | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  const openRename = useCallback((ref: ChatRef) => {
    setRenameDraft(ref.title || '');
    setPendingRenameChat(ref);
  }, []);

  const confirmRename = useCallback(() => {
    if (!pendingRenameChat) return;
    const next = renameDraft.trim();
    if (next && next !== pendingRenameChat.title) {
      if (pendingRenameChat.kind === 'stella') {
        onRenameStellaChat?.(pendingRenameChat.sessionId, next);
      } else if (pendingRenameChat.kind === 'workspace') {
        onRenameChat?.(pendingRenameChat.code, pendingRenameChat.sessionId, next);
      } else if (pendingRenameChat.kind === 'ask') {
        onRenameAnyChat?.(pendingRenameChat.sessionId, pendingRenameChat.targetCode, next);
      }
    }
    setPendingRenameChat(null);
  }, [pendingRenameChat, renameDraft, onRenameStellaChat, onRenameChat, onRenameAnyChat]);

  const confirmDeleteChat = useCallback(() => {
    if (!pendingDeleteChat) return;
    if (pendingDeleteChat.kind === 'stella') {
      onDeleteStellaChat?.(pendingDeleteChat.sessionId);
    } else if (pendingDeleteChat.kind === 'workspace') {
      onDeleteChat?.(pendingDeleteChat.code, pendingDeleteChat.sessionId);
    } else if (pendingDeleteChat.kind === 'ask') {
      onDeleteAnyChat?.(pendingDeleteChat.sessionId, pendingDeleteChat.targetCode);
    }
    setPendingDeleteChat(null);
  }, [pendingDeleteChat, onDeleteStellaChat, onDeleteChat, onDeleteAnyChat]);

  // ---- File tree move/rename/delete helpers ---------------------------

  // Map from lowercased target dir absolute path → target code. Keyed by
  // both `\\` and `/` separators because mutation paths may use either.
  const targetDirToCode = useMemo(() => {
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

  void targetDirToCode; // reserved for future drag-source detection

  const makeFileRef = useCallback((file: TargetFile, code: string): FileRef => {
    const fileName = file.relPath.split(/[\\/]/).pop() || file.relPath;
    return {
      absPath: file.absPath,
      fileName,
      ownerCode: code,
      isProtected: fileName.toLowerCase() === 'profile.yaml',
    };
  }, []);

  const findFileByAbsPath = useCallback((absPath: string): FileRef | null => {
    for (const code of Object.keys(filesByCode)) {
      const files = filesByCode[code];
      if (!files) continue;
      const hit = files.find((f) => f.absPath === absPath);
      if (hit) return makeFileRef(hit, code);
    }
    return null;
  }, [filesByCode, makeFileRef]);

  const tryMove = useCallback(async (
    source: FileRef,
    destDirAbs: string,
    destDirLabel: string,
  ) => {
    if (!onMoveFile) return;
    if (source.isProtected) {
      showError('profile.yaml is protected and cannot be moved');
      return;
    }
    const sourceDir = source.absPath.replace(/[\\/][^\\/]+$/, '');
    if (sourceDir.toLowerCase() === destDirAbs.toLowerCase()) return; // no-op
    const result = await onMoveFile(source.absPath, destDirAbs, 'fail');
    if (result.success) {
      showSuccess('Moved');
      return;
    }
    if (result.code === 'EXISTS') {
      setPendingMoveConflict({ source, destDirAbs, destDirLabel });
      return;
    }
    showError(result.error || 'Move failed');
  }, [onMoveFile, showError, showSuccess]);

  const resolveMoveConflict = useCallback(async (choice: MoveConflictChoice) => {
    const ctx = pendingMoveConflict;
    setPendingMoveConflict(null);
    if (!ctx || choice === 'cancel' || !onMoveFile) return;
    const result = await onMoveFile(ctx.source.absPath, ctx.destDirAbs, choice);
    if (result.success) {
      showSuccess(choice === 'overwrite' ? 'Replaced' : 'Moved');
    } else {
      showError(result.error || 'Move failed');
    }
  }, [pendingMoveConflict, onMoveFile, showError, showSuccess]);

  const handleDeleteFile = useCallback(async () => {
    const ref = pendingDeleteFile;
    setPendingDeleteFile(null);
    if (!ref || !onTrashFile) return;
    if (ref.isProtected) {
      showError('profile.yaml is protected and cannot be deleted');
      return;
    }
    const r = await onTrashFile(ref.absPath);
    if (r.success) showSuccess('Moved to trash');
    else showError(r.error || 'Delete failed');
  }, [pendingDeleteFile, onTrashFile, showError, showSuccess]);

  const handleConfirmDeleteFolder = useCallback(async () => {
    const ctx = pendingDeleteFolder;
    setPendingDeleteFolder(null);
    if (!ctx) return;
    const api: any = (window as any).electronAPI;
    const trash = api?.portfolio?.trashPath;
    if (!trash) { showError('文件系统接口不可用'); return; }
    try {
      const r = await trash(ctx.folderAbsPath);
      if (r?.success) {
        // Drop optimistic entries that are now gone (the folder itself or
        // anything underneath it).
        const ownerTarget = targets.find((t) => t.stock_code === ctx.ownerCode);
        if (ownerTarget) {
          const baseDir = ownerTarget.directory;
          const sep = baseDir.includes('\\') ? '\\' : '/';
          const prefix = baseDir.endsWith(sep) ? baseDir : baseDir + sep;
          const relPosix = ctx.folderAbsPath.startsWith(prefix)
            ? ctx.folderAbsPath.slice(prefix.length).replace(/\\/g, '/')
            : '';
          if (relPosix) {
            setOptimisticFolders((prev) => {
              const existing = prev[ctx.ownerCode];
              if (!existing || existing.length === 0) return prev;
              const filtered = existing.filter((p) => p !== relPosix && !p.startsWith(relPosix + '/'));
              if (filtered.length === existing.length) return prev;
              return { ...prev, [ctx.ownerCode]: filtered };
            });
          }
        }
        showSuccess(`已删除 ${ctx.folderName}`);
        onRefreshTarget?.(ctx.ownerCode);
      } else {
        showError(r?.error || '删除失败');
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    }
  }, [pendingDeleteFolder, targets, showError, showSuccess, onRefreshTarget]);

  const handleConfirmRenameFile = useCallback(async (newName: string) => {
    const ref = pendingRenameFile;
    setPendingRenameFile(null);
    if (!ref || !onRenameFile) return;
    if (ref.isProtected) {
      showError('profile.yaml is protected and cannot be renamed');
      return;
    }
    const r = await onRenameFile(ref.absPath, newName);
    if (r.success) showSuccess('Renamed');
    else showError(r.error || 'Rename failed');
  }, [pendingRenameFile, onRenameFile, showError, showSuccess]);

  const handlePaste = useCallback(async (destDirAbs: string, destDirLabel: string) => {
    if (!clipboard.clipboard || !onMoveFile) return;
    const ref = findFileByAbsPath(clipboard.clipboard.absPath);
    if (!ref) {
      clipboard.clear();
      return;
    }
    await tryMove(ref, destDirAbs, destDirLabel);
    clipboard.clear();
  }, [clipboard, onMoveFile, findFileByAbsPath, tryMove]);

  const beginDrag = useCallback((e: React.DragEvent, file: TargetFile, code: string) => {
    const ref = makeFileRef(file, code);
    if (ref.isProtected) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('application/x-target-file', ref.absPath); } catch { /* ignore */ }
    try { e.dataTransfer.setData('text/plain', ref.absPath); } catch { /* ignore */ }
  }, [makeFileRef]);

  const readDragAbsPath = (e: React.DragEvent): string | null => {
    try {
      const v = e.dataTransfer.getData('application/x-target-file') || e.dataTransfer.getData('text/plain');
      return v || null;
    } catch { return null; }
  };

  const handleDropOnTarget = useCallback(async (e: React.DragEvent, destCode: string) => {
    e.preventDefault();
    setDropHover(null);
    const abs = readDragAbsPath(e);
    if (!abs) return;
    const source = findFileByAbsPath(abs);
    if (!source) return;
    const destTarget = targets.find((t) => t.stock_code === destCode);
    if (!destTarget) return;
    const destDirAbs = destTarget.directory;
    if (source.ownerCode !== destCode) {
      const fromTarget = targets.find((t) => t.stock_code === source.ownerCode);
      setPendingCrossTargetMove({
        source,
        destDirAbs,
        fromTargetName: fromTarget?.name ?? source.ownerCode,
        toTargetName: destTarget.name,
      });
      return;
    }
    await tryMove(source, destDirAbs, destTarget.name);
  }, [findFileByAbsPath, targets, tryMove]);

  const handleDropOnSubcategory = useCallback(async (
    e: React.DragEvent,
    destCode: string,
    cat: string,
  ) => {
    e.preventDefault();
    setDropHover(null);
    const abs = readDragAbsPath(e);
    if (!abs) return;
    const source = findFileByAbsPath(abs);
    if (!source) return;
    const destTarget = targets.find((t) => t.stock_code === destCode);
    if (!destTarget) return;
    const sep = destTarget.directory.includes('\\') ? '\\' : '/';
    const destDirAbs = `${destTarget.directory}${sep}${cat}`;
    if (source.ownerCode !== destCode) {
      const fromTarget = targets.find((t) => t.stock_code === source.ownerCode);
      setPendingCrossTargetMove({
        source,
        destDirAbs,
        fromTargetName: fromTarget?.name ?? source.ownerCode,
        toTargetName: `${destTarget.name} / ${cat}`,
      });
      return;
    }
    await tryMove(source, destDirAbs, `${destTarget.name} / ${cat}`);
  }, [findFileByAbsPath, targets, tryMove]);

  const confirmCrossTargetMove = useCallback(async () => {
    const ctx = pendingCrossTargetMove;
    setPendingCrossTargetMove(null);
    if (!ctx) return;
    await tryMove(ctx.source, ctx.destDirAbs, ctx.toTargetName);
  }, [pendingCrossTargetMove, tryMove]);

  const selectedFile = useMemo<FileRef | null>(() => {
    if (!activeFileAbsPath) return null;
    return findFileByAbsPath(activeFileAbsPath);
  }, [activeFileAbsPath, findFileByAbsPath]);

  const onTreeKeyDown = useCallback((e: React.KeyboardEvent) => {
    const isMod = e.ctrlKey || e.metaKey;
    if (isMod && e.key.toLowerCase() === 'x') {
      if (selectedFile && !selectedFile.isProtected) {
        clipboard.setCut(selectedFile.absPath);
        e.preventDefault();
      }
      return;
    }
    if (isMod && e.key.toLowerCase() === 'v') {
      if (!clipboard.clipboard) return;
      const code = selectedCode || (selectedFile?.ownerCode);
      if (!code) return;
      const t = targets.find((tt) => tt.stock_code === code);
      if (!t) return;
      e.preventDefault();
      void handlePaste(t.directory, t.name);
      return;
    }
    if (e.key === 'F2' && selectedFile && !selectedFile.isProtected) {
      e.preventDefault();
      setPendingRenameFile(selectedFile);
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedFile && !selectedFile.isProtected) {
      e.preventDefault();
      setPendingDeleteFile(selectedFile);
      return;
    }
  }, [selectedFile, clipboard, selectedCode, targets, handlePaste]);

  const openFileContextMenu = useCallback((e: React.MouseEvent, file: TargetFile, code: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      file: makeFileRef(file, code),
      position: { top: e.clientY, left: e.clientX },
    });
  }, [makeFileRef]);

  const openFolderContextMenu = useCallback((e: React.MouseEvent, folderAbsPath: string, folderName: string, ownerCode: string) => {
    e.preventDefault();
    e.stopPropagation();
    setFolderContextMenu({
      folderAbsPath,
      folderName,
      ownerCode,
      position: { top: e.clientY, left: e.clientX },
    });
  }, []);

  const joinPath = useCallback((dir: string, name: string) => {
    const sep = dir.includes('\\') ? '\\' : '/';
    return `${dir}${sep}${name}`;
  }, []);

  const handleConfirmCreate = useCallback(async (name: string) => {
    const ctx = pendingCreate;
    setPendingCreate(null);
    if (!ctx) return;
    const target = joinPath(ctx.parentDirAbs, name);
    const api: any = (window as any).electronAPI;
    try {
      if (ctx.kind === 'file') {
        const writer = api?.fs?.writeTextFileSafe ?? api?.fs?.writeFile;
        if (!writer) { showError('文件系统接口不可用'); return; }
        // Check for existing file via stat to avoid silently overwriting.
        try {
          const s = await api?.fs?.stat?.(target);
          if (s?.success && s.stats?.isFile) {
            showError(`文件已存在：${name}`);
            return;
          }
        } catch { /* stat is best-effort */ }
        const r = await writer(target, '');
        if (r?.success) {
          showSuccess(`已创建文件 ${name}`);
          // fs:writeTextFileSafe / fs:writeFile both call
          // PortfolioWatcher.suppressOnce() to silence editor-save echoes,
          // which unfortunately also silences fresh creates. Force-reload
          // the affected target so the new file appears immediately.
          onRefreshTarget?.(ctx.ownerCode);

          // Reveal & open the freshly-created file: compute its POSIX-style
          // relPath under the target dir, ensure the target row and every
          // intermediate folder is expanded in the tree, then open it in the
          // editor pane.
          const ownerTarget = targets.find((t) => t.stock_code === ctx.ownerCode);
          if (ownerTarget) {
            const baseDir = ownerTarget.directory;
            const sep = baseDir.includes('\\') ? '\\' : '/';
            const prefix = baseDir.endsWith(sep) ? baseDir : baseDir + sep;
            let relPath = name;
            if (ctx.parentDirAbs !== baseDir) {
              const rel = ctx.parentDirAbs.startsWith(prefix)
                ? ctx.parentDirAbs.slice(prefix.length)
                : ctx.parentDirAbs;
              relPath = `${rel.replace(/\\/g, '/')}/${name}`;
            }

            if (!expandedCodes.has(ctx.ownerCode)) {
              onToggleExpand(ctx.ownerCode);
            }
            // Expand every ancestor folder so the file is actually visible
            // in the tree (the category renderer uses composite keys of
            // form `${code}::${relPosix}` for both top-level categories
            // and arbitrarily-nested subfolders).
            const segs = relPath.split('/');
            for (let i = 1; i < segs.length; i += 1) {
              const partial = segs.slice(0, i).join('/');
              const catKey = `${ctx.ownerCode}::${partial}`;
              if (!expandedCats.has(catKey)) {
                onToggleCat(catKey);
              }
            }

            onOpenFile({ relPath, absPath: target, mtime: Date.now() });
          }
        } else {
          showError(r?.error || '创建文件失败');
        }
      } else {
        if (!api?.fs?.mkdir) { showError('文件系统接口不可用'); return; }
        const r = await api.fs.mkdir(target);
        if (r?.success) {
          if (r.exists) {
            showError(`文件夹已存在：${name}`);
          } else {
            // Record the new folder optimistically. Empty dirs are not
            // returned by the file listing tool, so without this they
            // would be invisible until the user drops a file into them.
            const ownerTarget = targets.find((t) => t.stock_code === ctx.ownerCode);
            if (ownerTarget) {
              const baseDir = ownerTarget.directory;
              // Compute POSIX-style relPath under the target dir.
              let relPath = name;
              if (ctx.parentDirAbs !== baseDir) {
                // Strip the target dir prefix (+ separator) from parentDirAbs.
                const sep = baseDir.includes('\\') ? '\\' : '/';
                const prefix = baseDir.endsWith(sep) ? baseDir : baseDir + sep;
                const rel = ctx.parentDirAbs.startsWith(prefix)
                  ? ctx.parentDirAbs.slice(prefix.length)
                  : ctx.parentDirAbs;
                relPath = `${rel.replace(/\\/g, '/')}/${name}`;
              }
              setOptimisticFolders((prev) => {
                const existing = prev[ctx.ownerCode] ?? [];
                if (existing.includes(relPath)) return prev;
                return { ...prev, [ctx.ownerCode]: [...existing, relPath] };
              });
              // Ensure the target row is expanded so the new folder is
              // actually visible (otherwise it hides behind a collapsed
              // parent).
              if (!expandedCodes.has(ctx.ownerCode)) {
                onToggleExpand(ctx.ownerCode);
              }
              // For nested folders, also expand the parent category row
              // so the empty folder is visible underneath it.
              if (relPath.includes('/')) {
                const parentCat = relPath.split('/')[0];
                const catKey = `${ctx.ownerCode}::${parentCat}`;
                if (!expandedCats.has(catKey)) {
                  onToggleCat(catKey);
                }
              }
            }
            showSuccess(`已创建文件夹 ${name}`);
            // Still ping a refresh so any race with concurrent writes
            // (e.g. an LLM tool placing a file inside the new dir) shows up.
            onRefreshTarget?.(ctx.ownerCode);
          }
        } else {
          showError(r?.error || '创建文件夹失败');
        }
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    }
  }, [pendingCreate, joinPath, showError, showSuccess, onRefreshTarget, targets, expandedCodes, onToggleExpand, expandedCats, onToggleCat, onOpenFile]);

  const navigate = useNavigate();

  return (
    <div className="rw-pane-left flex flex-col h-full" style={{ width }}>
      {/* Header — Workspace title (extra top padding for macOS traffic lights) */}
      <div className="flex items-center justify-between px-3 pb-2" style={{ paddingTop: 40 }}>
        <span className="rw-side-title">Workspace</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="rw-side-icon-btn"
            title="Settings"
            aria-label="Open Settings"
            onClick={() => {
              const settingsApi = (window as any).electronAPI?.settingsWindow;
              if (settingsApi?.open) {
                settingsApi.open();
                return;
              }
              sessionStorage.setItem('previousPath', window.location.hash.replace(/^#/, '') || '/research');
              navigate('/settings');
            }}
          >
            <Settings size={14} />
          </button>
          <button
            type="button"
            className="rw-side-icon-btn"
            title="Logout"
            aria-label="Logout"
            onClick={async () => {
              const confirmed = window.confirm(
                'Are you sure you want to sign out? Any unsaved work in this workspace will be lost.'
              );
              if (!confirmed) return;
              try {
                await window.electronAPI.auth.signOut();
              } catch (err) {
                console.error('[Logout] Sign-out failed:', err);
                window.alert('Sign out failed. Please try again.');
              }
            }}
          >
            <LogOut size={14} />
          </button>
          {onCollapse && (
            <button
              type="button"
              className="rw-side-icon-btn"
              title="Collapse sidebar (Ctrl+B)"
              aria-label="Collapse sidebar"
              onClick={onCollapse}
            >
              <PanelLeftClose size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Secondary tab row */}
      <div className="flex items-center px-3 pb-2 rw-divider gap-3">
        <button
          type="button"
          className={`rw-side-tab ${activeMode === 'workspace' ? 'is-active' : ''}`}
          onClick={() => onModeChange('workspace')}
        >
          工作区
        </button>
        <button
          type="button"
          className={`rw-side-tab ${activeMode === 'stella' ? 'is-active' : ''}`}
          onClick={() => onModeChange('stella')}
        >
          Ask
        </button>
        <div className="flex-1" />
        {activeMode === 'workspace' ? (
          <div className="flex items-center gap-1">
            <button
              type="button"
              className={`rw-side-icon-btn ${addFormOpen ? 'is-active' : ''}`}
              onClick={onAddTarget}
              title="查找或添加 Target"
              aria-pressed={addFormOpen}
            >
              <Search size={14} />
            </button>
            <button
              type="button"
              className="rw-side-icon-btn"
              title="More (coming soon)"
              onClick={() => console.log('[Research] more menu clicked (placeholder)')}
            >
              <MoreHorizontal size={14} />
            </button>
          </div>
        ) : (
          onNewStellaChat && (
            <button
              type="button"
              className="rw-side-icon-btn"
              onClick={onNewStellaChat}
              title="New chat"
            >
              <Plus size={14} />
            </button>
          )
        )}
      </div>

      {topSlot}

      {/* Body — Ask tab: unified chat list (Stella + every target-bound chat) */}
      {activeMode === 'stella' && (
        <div className="flex-1 overflow-y-auto pt-1">
          {/*
            Prefer the unified `allChats` feed when supplied; fall back to the
            Stella-only list for compatibility (e.g. if a future caller wires
            the sidebar without the unified hook).
          */}
          {(() => {
            const useUnified = allChats !== undefined;
            const list = useUnified ? allChats : stellaChats;
            const activeId = useUnified
              ? (liveChatSessionId ?? stellaActiveSessionId ?? null)
              : (stellaActiveSessionId ?? null);

            if (list === undefined) {
              return (
                <div className="px-3 py-4 text-xs text-[var(--rw-text-3)] text-center">
                  Loading…
                </div>
              );
            }
            if (list.length === 0) {
              return (
                <div className="px-3 py-4 text-xs text-[var(--rw-text-3)] text-center">
                  No chats yet
                </div>
              );
            }
            // Already sorted by chatSession_id asc in main (listAll). For
            // the legacy stellaChats fallback, sort defensively here so the
            // ordering contract holds regardless of feed.
            const sorted = useUnified
              ? list
              : [...list].sort((a, b) => a.chatSession_id.localeCompare(b.chatSession_id));

            return sorted.map((chat) => {
              const targetCode = chat.targetCode ?? null;
              const pill = targetCode
                ? (targetPillLookup ? targetPillLookup(targetCode) : targetCode)
                : null;
              const isActive = activeId === chat.chatSession_id;
              return (
                <div
                  key={chat.chatSession_id}
                  className={`rw-tree-row rw-chat-row group ${isActive ? 'is-active' : ''}`}
                  style={{ paddingLeft: 12 }}
                  onClick={() => {
                    if (useUnified) {
                      onSelectAnyChat?.(chat.chatSession_id, targetCode);
                    } else {
                      onSelectStellaChat?.(chat.chatSession_id);
                    }
                  }}
                >
                  <MessageSquare size={13} className="flex-shrink-0 mr-1 text-[var(--rw-text-3)]" />
                  {pill && (
                    <span className="rw-chat-row-pill" title={targetCode || ''}>
                      {pill}
                    </span>
                  )}
                  <span className="truncate flex-1">{chat.title || 'Untitled'}</span>
                  {(useUnified ? onRenameAnyChat : onRenameStellaChat) && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (useUnified) {
                          openRename({ kind: 'ask', targetCode, sessionId: chat.chatSession_id, title: chat.title || '' });
                        } else {
                          openRename({ kind: 'stella', sessionId: chat.chatSession_id, title: chat.title || '' });
                        }
                      }}
                      className="ml-1 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-black/10 text-[var(--rw-text-3)] transition-opacity"
                      title="Rename"
                    >
                      <Pencil size={11} />
                    </button>
                  )}
                  {(useUnified ? onDeleteAnyChat : onDeleteStellaChat) && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (useUnified) {
                          setPendingDeleteChat({ kind: 'ask', targetCode, sessionId: chat.chatSession_id, title: chat.title || 'Untitled' });
                        } else {
                          setPendingDeleteChat({ kind: 'stella', sessionId: chat.chatSession_id, title: chat.title || 'Untitled' });
                        }
                      }}
                      className="ml-1 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-black/10 text-[var(--rw-text-3)] hover:text-red-500 transition-opacity"
                      title="Delete chat"
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
              );
            });
          })()}
        </div>
      )}

      {/* Body — Workspace tree */}
      {activeMode === 'workspace' && (
      <div
        ref={fileTreeFocusRef}
        tabIndex={0}
        onKeyDown={onTreeKeyDown}
        className="flex-1 overflow-y-auto pt-1 focus:outline-none"
      >
        {targets.length === 0 && (
          <div className="px-3 py-4 text-xs text-[var(--rw-text-3)] text-center">
            No targets yet
          </div>
        )}

        {targets.map((target) => {
          const code = target.stock_code;
          const isExpanded = expandedCodes.has(code);
          const files = filesByCode[code];

          const rootFiles = files?.filter((f) => !f.relPath.includes('/')) ?? [];

          return (
            <React.Fragment key={code}>
              {/* Target row */}
              <div
                className={`rw-tree-row group ${selectedCode === code ? 'is-active' : ''} ${dropHover === code ? 'rw-tree-row-drop' : ''}`}
                onContextMenu={(e) => openFolderContextMenu(e, target.directory, target.name, code)}
                onDragOver={(e) => {
                  if (readDragAbsPath(e) == null && !e.dataTransfer.types.includes('text/plain') && !e.dataTransfer.types.includes('application/x-target-file')) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  setDropHover(code);
                }}
                onDragLeave={() => { if (dropHover === code) setDropHover(null); }}
                onDrop={(e) => { void handleDropOnTarget(e, code); }}
              >
                <span
                  className="flex-shrink-0 cursor-pointer text-[var(--rw-text-3)]"
                  onClick={() => onToggleExpand(code)}
                >
                  {isExpanded
                    ? <ChevronDown size={12} />
                    : <ChevronRight size={12} />}
                </span>
                <FolderClosed
                  size={13}
                  className="flex-shrink-0 ml-1 text-[var(--rw-text-2)] cursor-pointer"
                  onClick={() => onSelectTarget(code)}
                />
                <span
                  className="ml-1.5 truncate cursor-pointer"
                  style={{ fontWeight: 700 }}
                  onClick={() => onSelectTarget(code)}
                >
                  {target.name}
                </span>
                <span
                  className="ml-1.5 flex-shrink-0 text-[11px] text-[var(--rw-text-3)] cursor-pointer"
                  onClick={() => onSelectTarget(code)}
                >
                  {/* Unlisted targets carry `stock_code === name`; show a "未上市"
                      pill instead of the synthetic placeholder code. */}
                  {target.listed === false || target.stock_code === target.name
                    ? <span className="px-1 rounded bg-gray-100 text-gray-500 text-[10px]">未上市</span>
                    : code}
                </span>
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onDeleteTarget(code, target.name); }}
                  className="ml-1 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-black/10 text-[var(--rw-text-3)] hover:text-red-500 transition-opacity"
                  title="Delete target"
                >
                  <Trash2 size={12} />
                </button>
              </div>

              {/* Expanded contents */}
              {isExpanded && files && (
                <div
                  onDragOver={(e) => {
                    if (readDragAbsPath(e) == null && !e.dataTransfer.types.includes('text/plain') && !e.dataTransfer.types.includes('application/x-target-file')) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    setDropHover(code);
                  }}
                  onDragLeave={(e) => {
                    // Only clear when the pointer truly leaves the wrapper
                    // (not when crossing into a child element).
                    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                    if (dropHover === code) setDropHover(null);
                  }}
                  onDrop={(e) => { void handleDropOnTarget(e, code); }}
                >
                  {/* Chat list — Target ↔ Chat binding */}
                  {onSelectChat && (
                    <>
                      <div
                        className="rw-tree-row group cursor-pointer"
                        style={{ paddingLeft: 12 }}
                        // Clicking the "对话" header behaves like clicking the
                        // target itself: re-select the target so its most
                        // recently-active chat is restored. Useful when the
                        // user is viewing a sub-chat and wants to jump back to
                        // the target's default chat view.
                        onClick={() => onSelectTarget(code)}
                      >
                        <span style={{ width: 13 }} className="flex-shrink-0" />
                        <MessageSquare size={13} className="flex-shrink-0 mr-1" />
                        <span className="truncate flex-1" style={{ color: 'var(--rw-text)' }}>对话</span>
                        {onNewChat && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onNewChat(code); }}
                            className="ml-1 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-black/10 text-[var(--rw-text-3)] transition-opacity"
                            title="New chat"
                          >
                            <Plus size={12} />
                          </button>
                        )}
                      </div>
                      {[...(chatsByCode?.[code] ?? [])]
                        // Sort by creation time ascending (oldest first, newest
                        // at the bottom). Stays stable across last_updated
                        // changes so the list does not jump while chatting.
                        .sort((a, b) => a.chatSession_id.localeCompare(b.chatSession_id))
                        .map((chat) => (
                        <div
                          key={chat.chatSession_id}
                          className={`rw-tree-row rw-chat-row group ${activeChatSessionId === chat.chatSession_id ? 'is-active' : ''}`}
                          style={{ paddingLeft: 24 }}
                          onClick={() => onSelectChat(code, chat.chatSession_id)}
                        >
                          <span style={{ width: 13 }} className="flex-shrink-0" />
                          <MessageSquare size={12} className="flex-shrink-0 mr-1 text-[var(--rw-text-3)]" />
                          <span className="truncate flex-1">{chat.title || 'Untitled'}</span>
                          {onRenameChat && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                openRename({ kind: 'workspace', code, sessionId: chat.chatSession_id, title: chat.title || '' });
                              }}
                              className="ml-1 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-black/10 text-[var(--rw-text-3)] transition-opacity"
                              title="Rename"
                            >
                              <Pencil size={11} />
                            </button>
                          )}
                          {onDeleteChat && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setPendingDeleteChat({ kind: 'workspace', code, sessionId: chat.chatSession_id, title: chat.title || 'Untitled' });
                              }}
                              className="ml-1 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-black/10 text-[var(--rw-text-3)] hover:text-red-500 transition-opacity"
                              title="Delete chat"
                            >
                              <Trash2 size={11} />
                            </button>
                          )}
                        </div>
                      ))}
                    </>
                  )}

                  {/* Root-level files */}
                  {rootFiles.map((file) => {
                    const Icon = fileIcon(file.relPath);
                    const ref = makeFileRef(file, code);
                    const isCut = clipboard.clipboard?.absPath === file.absPath;
                    return (
                      <div
                        key={file.absPath}
                        draggable={!ref.isProtected}
                        className={`rw-tree-row ${activeFileAbsPath === file.absPath ? 'is-active' : ''} ${isCut ? 'opacity-50' : ''}`}
                        style={{ paddingLeft: 12 }}
                        onClick={() => onOpenFile(file)}
                        onContextMenu={(e) => openFileContextMenu(e, file, code)}
                        onDragStart={(e) => beginDrag(e, file, code)}
                      >
                        <span style={{ width: 13 }} className="flex-shrink-0" />
                        <Icon size={13} className="flex-shrink-0 mr-1" />
                        <span className="truncate">{file.relPath}</span>
                      </div>
                    );
                  })}

                  {/* Sub-categories — standard 7 first, plus any extra
                      top-level folders we find under this target (so files
                      placed in user-created subfolders remain visible).
                      Also includes optimistic folders just created via the
                      right-click "新建文件夹" action — those are empty on disk
                      and would otherwise be invisible. */}
                  {(() => {
                    const optimistic = optimisticFolders[code] ?? [];
                    const fromFiles = files
                      .filter((f) => f.relPath.includes('/'))
                      .map((f) => f.relPath.split('/')[0]);
                    const fromOptimistic = optimistic.map((p) => p.split('/')[0]);
                    const extras = Array.from(new Set(
                      [...fromFiles, ...fromOptimistic]
                        .filter((c) => c && !SUBCATEGORIES.includes(c))
                    ));
                    return [...SUBCATEGORIES, ...extras];
                  })().map((cat) => {
                    const catFiles = files.filter((f) => f.relPath.startsWith(cat + '/'));
                    const catKey = `${code}::${cat}`;
                    const isCatExpanded = expandedCats.has(catKey);
                    // Optimistic empty folders living directly under this
                    // category (e.g. "研报/test"). Top-level optimistic
                    // entries (no '/') manifest themselves as their own
                    // category row instead, so they're excluded here.
                    // All optimistic folder relPaths under this category
                    // (any depth). e.g. for cat='纪要', this includes
                    // '纪要/eee', '纪要/foo/bar', etc.
                    const optimisticUnderCat = (optimisticFolders[code] ?? [])
                      .filter((p) => p.startsWith(cat + '/'));
                    const hasFiles = catFiles.length > 0 || optimisticUnderCat.length > 0;
                    const catDirAbs = joinPath(target.directory, cat);

                    return (
                      <React.Fragment key={catKey}>
                        <div
                          onDragOver={(e) => {
                            // Subcategory drop zone covers the folder row AND
                            // (when expanded) its child files area, so users
                            // don't have to land precisely on the row.
                            e.preventDefault();
                            e.stopPropagation();
                            e.dataTransfer.dropEffect = 'move';
                            setDropHover(catKey);
                          }}
                          onDragLeave={(e) => {
                            if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                            if (dropHover === catKey) setDropHover(null);
                          }}
                          onDrop={(e) => {
                            e.stopPropagation();
                            void handleDropOnSubcategory(e, code, cat);
                          }}
                        >
                          <div
                            className={`rw-tree-row ${!hasFiles ? 'is-disabled' : ''} ${dropHover === catKey ? 'rw-tree-row-drop' : ''}`}
                            style={{ paddingLeft: 12 }}
                            onClick={hasFiles ? () => onToggleCat(catKey) : undefined}
                            onContextMenu={(e) => openFolderContextMenu(e, catDirAbs, `${target.name} / ${cat}`, code)}
                          >
                            {hasFiles
                              ? (isCatExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />)
                              : <span style={{ width: 13 }} />}
                            <Folder size={13} className="flex-shrink-0 mr-1" />
                            <span className="truncate" style={{ color: 'var(--rw-text)' }}>{cat}</span>
                          </div>

                          {hasFiles && isCatExpanded && (() => {
                            // Build a hierarchical tree of files + optimistic
                            // folders under this category, so nested paths
                            // (e.g. '纪要/eee/eee.md') render as a folder
                            // containing the file rather than a flat row
                            // with '/' in the label.
                            type Node = {
                              name: string;
                              fullRel: string;       // POSIX path under target.directory
                              children: Map<string, Node>;
                              file?: TargetFile;     // present iff this is a leaf file
                            };
                            const root: Node = { name: cat, fullRel: cat, children: new Map() };
                            const ensureFolder = (segments: string[]): Node => {
                              let node = root;
                              for (let i = 0; i < segments.length; i++) {
                                const seg = segments[i];
                                let child = node.children.get(seg);
                                if (!child) {
                                  child = {
                                    name: seg,
                                    fullRel: `${node.fullRel}/${seg}`,
                                    children: new Map(),
                                  };
                                  node.children.set(seg, child);
                                }
                                node = child;
                              }
                              return node;
                            };
                            // Insert files.
                            for (const f of catFiles) {
                              const parts = f.relPath.split('/'); // [cat, ...inner, fileName]
                              const innerDirs = parts.slice(1, -1);
                              const fileName = parts[parts.length - 1];
                              const parent = ensureFolder(innerDirs);
                              parent.children.set(fileName, {
                                name: fileName,
                                fullRel: f.relPath,
                                children: new Map(),
                                file: f,
                              });
                            }
                            // Insert optimistic (possibly empty) folders.
                            for (const optRel of optimisticUnderCat) {
                              const innerDirs = optRel.split('/').slice(1); // strip cat
                              if (innerDirs.length === 0) continue;
                              ensureFolder(innerDirs);
                            }

                            const renderNode = (node: Node, depth: number): React.ReactNode => {
                              const paddingLeft = 12 + depth * 12;
                              if (node.file) {
                                const f = node.file;
                                const Icon = fileIcon(f.relPath);
                                const ref = makeFileRef(f, code);
                                const isCut = clipboard.clipboard?.absPath === f.absPath;
                                return (
                                  <div
                                    key={f.absPath}
                                    draggable={!ref.isProtected}
                                    className={`rw-tree-row ${activeFileAbsPath === f.absPath ? 'is-active' : ''} ${isCut ? 'opacity-50' : ''}`}
                                    style={{ paddingLeft }}
                                    onClick={() => onOpenFile(f)}
                                    onContextMenu={(e) => openFileContextMenu(e, f, code)}
                                    onDragStart={(e) => beginDrag(e, f, code)}
                                  >
                                    <Icon size={13} className="flex-shrink-0 mr-1" />
                                    <span className="truncate">{node.name}</span>
                                  </div>
                                );
                              }
                              // Folder node.
                              const folderKey = `${code}::${node.fullRel}`;
                              const folderAbs = joinPath(target.directory, node.fullRel);
                              const hasChildren = node.children.size > 0;
                              const isExpanded = expandedCats.has(folderKey);
                              // Sort: folders first then files, alphabetic.
                              const sortedChildren = [...node.children.values()].sort((a, b) => {
                                const aIsFile = !!a.file;
                                const bIsFile = !!b.file;
                                if (aIsFile !== bIsFile) return aIsFile ? 1 : -1;
                                return a.name.localeCompare(b.name);
                              });
                              return (
                                <React.Fragment key={folderKey}>
                                  <div
                                    className={`rw-tree-row ${!hasChildren ? 'is-disabled' : ''}`}
                                    style={{ paddingLeft }}
                                    onClick={hasChildren ? () => onToggleCat(folderKey) : undefined}
                                    onContextMenu={(e) => openFolderContextMenu(e, folderAbs, `${target.name} / ${node.fullRel}`, code)}
                                  >
                                    {hasChildren
                                      ? (isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />)
                                      : <span style={{ width: 13 }} />}
                                    <Folder size={13} className="flex-shrink-0 mr-1" />
                                    <span className="truncate">{node.name}</span>
                                  </div>
                                  {hasChildren && isExpanded && sortedChildren.map((c) => renderNode(c, depth + 1))}
                                </React.Fragment>
                              );
                            };

                            // Render root's children (root itself == the cat
                            // row which is rendered above this IIFE).
                            const rootSorted = [...root.children.values()].sort((a, b) => {
                              const aIsFile = !!a.file;
                              const bIsFile = !!b.file;
                              if (aIsFile !== bIsFile) return aIsFile ? 1 : -1;
                              return a.name.localeCompare(b.name);
                            });
                            return rootSorted.map((c) => renderNode(c, 1));
                          })()}
                        </div>
                      </React.Fragment>
                    );
                  })}
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
      )}

      {/* Delete-chat confirm dialog (in-app to avoid Electron focus bug). */}
      <Dialog open={!!pendingDeleteChat} onOpenChange={(open) => { if (!open) setPendingDeleteChat(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete chat?</DialogTitle>
          </DialogHeader>
          <div className="text-sm text-gray-600 py-2">
            {pendingDeleteChat ? `Delete chat "${pendingDeleteChat.title}"? This cannot be undone.` : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDeleteChat(null)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDeleteChat}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename-chat dialog (in-app to avoid Electron focus bug). */}
      <Dialog open={!!pendingRenameChat} onOpenChange={(open) => { if (!open) setPendingRenameChat(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename chat</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <input
              autoFocus
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); confirmRename(); }
                else if (e.key === 'Escape') { e.preventDefault(); setPendingRenameChat(null); }
              }}
              placeholder="Chat title"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingRenameChat(null)}>Cancel</Button>
            <Button onClick={confirmRename} disabled={!renameDraft.trim()}>Rename</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* File-move conflict resolution */}
      <MoveConflictDialog
        open={!!pendingMoveConflict}
        fileName={pendingMoveConflict?.source.fileName ?? ''}
        destDirLabel={pendingMoveConflict?.destDirLabel ?? ''}
        onResolve={(choice) => { void resolveMoveConflict(choice); }}
      />

      {/* Cross-target move confirmation */}
      <CrossTargetMoveConfirmDialog
        open={!!pendingCrossTargetMove}
        fileName={pendingCrossTargetMove?.source.fileName ?? ''}
        fromTargetName={pendingCrossTargetMove?.fromTargetName ?? ''}
        toTargetName={pendingCrossTargetMove?.toTargetName ?? ''}
        onConfirm={() => { void confirmCrossTargetMove(); }}
        onCancel={() => setPendingCrossTargetMove(null)}
      />

      {/* Rename file dialog */}
      <RenameFileDialog
        open={!!pendingRenameFile}
        originalName={pendingRenameFile?.fileName ?? ''}
        onConfirm={(newName) => { void handleConfirmRenameFile(newName); }}
        onCancel={() => setPendingRenameFile(null)}
      />

      {/* Delete file confirmation */}
      <Dialog open={!!pendingDeleteFile} onOpenChange={(open) => { if (!open) setPendingDeleteFile(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete file?</DialogTitle>
          </DialogHeader>
          <div className="text-sm text-gray-600 py-2">
            {pendingDeleteFile ? `Move "${pendingDeleteFile.fileName}" to the trash?` : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDeleteFile(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => { void handleDeleteFile(); }}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete-folder confirm dialog */}
      <Dialog open={!!pendingDeleteFolder} onOpenChange={(open) => { if (!open) setPendingDeleteFolder(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除文件夹？</DialogTitle>
          </DialogHeader>
          <div className="text-sm text-gray-600 py-2">
            {pendingDeleteFolder
              ? `将 "${pendingDeleteFolder.folderName}" 及其全部内容移至回收站？`
              : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDeleteFolder(null)}>取消</Button>
            <Button variant="destructive" onClick={() => { void handleConfirmDeleteFolder(); }}>删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* File context menu (right-click) */}
      {contextMenu && (
        <TargetTreeFileContextMenu
          position={contextMenu.position}
          absPath={contextMenu.file.absPath}
          fileName={contextMenu.file.fileName}
          canDelete={!contextMenu.file.isProtected}
          onClose={() => setContextMenu(null)}
          onCut={() => clipboard.setCut(contextMenu.file.absPath)}
          onRename={() => setPendingRenameFile(contextMenu.file)}
          onDelete={() => setPendingDeleteFile(contextMenu.file)}
        />
      )}

      {/* Folder context menu (right-click on target row or subcategory row) */}
      {folderContextMenu && (() => {
        const fcm = folderContextMenu;
        const ownerTarget = targets.find((t) => t.stock_code === fcm.ownerCode);
        // Disallow deleting the target root (handled by deleteTarget) and
        // the seven standard subcategory rows (they're virtual folders the
        // user shouldn't trash). Everything else — user-created subfolders
        // at any depth — is deletable.
        let canDelete = false;
        if (ownerTarget) {
          const baseDir = ownerTarget.directory;
          const sep = baseDir.includes('\\') ? '\\' : '/';
          const prefix = baseDir.endsWith(sep) ? baseDir : baseDir + sep;
          if (fcm.folderAbsPath !== baseDir && fcm.folderAbsPath.startsWith(prefix)) {
            const relPosix = fcm.folderAbsPath.slice(prefix.length).replace(/\\/g, '/');
            const isStandardCategoryRoot = SUBCATEGORIES.includes(relPosix);
            canDelete = !isStandardCategoryRoot;
          }
        }
        return (
          <TargetTreeFolderContextMenu
            position={fcm.position}
            folderAbsPath={fcm.folderAbsPath}
            folderName={fcm.folderName}
            canDelete={canDelete}
            onClose={() => setFolderContextMenu(null)}
            onNewFile={() => setPendingCreate({
              kind: 'file',
              parentDirAbs: fcm.folderAbsPath,
              parentLabel: fcm.folderName,
              ownerCode: fcm.ownerCode,
            })}
            onNewFolder={() => setPendingCreate({
              kind: 'folder',
              parentDirAbs: fcm.folderAbsPath,
              parentLabel: fcm.folderName,
              ownerCode: fcm.ownerCode,
            })}
            onDelete={() => setPendingDeleteFolder({
              folderAbsPath: fcm.folderAbsPath,
              folderName: fcm.folderName,
              ownerCode: fcm.ownerCode,
            })}
          />
        );
      })()}

      {/* New file / new folder prompt */}
      <CreateItemDialog
        open={!!pendingCreate}
        title={pendingCreate?.kind === 'folder' ? '新建文件夹' : '新建文件'}
        placeholder={pendingCreate?.kind === 'folder' ? '文件夹名' : '文件名（含扩展名，如 notes.md）'}
        parentHint={pendingCreate?.parentLabel}
        defaultValue=""
        onConfirm={(name) => { void handleConfirmCreate(name); }}
        onCancel={() => setPendingCreate(null)}
      />
    </div>
  );
};
