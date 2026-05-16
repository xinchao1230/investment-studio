import React, { useState, useCallback } from 'react';
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
} from 'lucide-react';
import type { TargetFile } from './usePortfolio';
import type { ResearchChatSessionMeta } from './researchChatIpc';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';

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
  /** Optional slot rendered above the tree (e.g. add-target combobox). */
  topSlot?: React.ReactNode;
  /** Whether the add-target slot is currently visible. When it becomes
   *  visible, the sidebar auto-closes its built-in search so the two
   *  inputs are mutually exclusive. */
  addFormOpen?: boolean;
  /** Fired when the user opens the search input. Parent can close the
   *  add-target form to keep both inputs mutually exclusive. */
  onOpenSearch?: () => void;
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
  topSlot,
  addFormOpen,
  onOpenSearch,
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
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = React.useRef<HTMLInputElement | null>(null);

  // In-app confirm/rename dialog state. We avoid window.confirm() and
  // window.prompt() because on Electron + Windows those native dialogs
  // briefly steal OS-level keyboard focus and don't fully release it back
  // to the BrowserWindow on close. The visible symptom is: after deleting
  // a chat, clicking the chat input shows a focus ring but no caret blinks
  // and keystrokes are dropped — switching to any other OS window and back
  // restores keyboard input. Using an in-app <Dialog> keeps focus inside
  // the same WebContents and avoids the bug entirely.
  type ChatRef = { kind: 'stella' | 'workspace'; code?: string; sessionId: string; title: string };
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
      } else if (pendingRenameChat.code) {
        onRenameChat?.(pendingRenameChat.code, pendingRenameChat.sessionId, next);
      }
    }
    setPendingRenameChat(null);
  }, [pendingRenameChat, renameDraft, onRenameStellaChat, onRenameChat]);

  const confirmDeleteChat = useCallback(() => {
    if (!pendingDeleteChat) return;
    if (pendingDeleteChat.kind === 'stella') {
      onDeleteStellaChat?.(pendingDeleteChat.sessionId);
    } else if (pendingDeleteChat.code) {
      onDeleteChat?.(pendingDeleteChat.code, pendingDeleteChat.sessionId);
    }
    setPendingDeleteChat(null);
  }, [pendingDeleteChat, onDeleteStellaChat, onDeleteChat]);

  // Search is owned locally; add-form open state is owned by parent. We
  // derive `searchOpen` so that whenever the parent shows the add-form,
  // search is hidden in the same render — no useEffect, no race.
  const [searchOpenLocal, setSearchOpenLocal] = useState(false);
  const searchOpen = searchOpenLocal && !addFormOpen;

  const openSearch = useCallback(() => {
    if (addFormOpen) onOpenSearch?.();   // ask parent to close add-form
    setSearchOpenLocal(true);
    setTimeout(() => searchInputRef.current?.focus(), 0);
  }, [addFormOpen, onOpenSearch]);

  const closeSearch = useCallback(() => {
    setSearchOpenLocal(false);
    setSearchQuery('');
  }, []);

  const toggleSearch = useCallback(() => {
    if (searchOpen) closeSearch();
    else openSearch();
  }, [searchOpen, openSearch, closeSearch]);

  const q = searchQuery.trim().toLowerCase();
  const filteredTargets = q
    ? targets.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.stock_code.toLowerCase().includes(q) ||
          (t.industry ?? '').toLowerCase().includes(q),
      )
    : targets;

  const navigate = useNavigate();

  return (
    <div className="rw-pane-left flex flex-col h-full" style={{ width }}>
      {/* Header — Workspace title */}
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <span className="rw-side-title">Workspace</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="rw-side-icon-btn"
            title="Settings"
            aria-label="Open Settings"
            onClick={() => {
              sessionStorage.setItem('previousPath', window.location.hash.replace(/^#/, '') || '/research');
              navigate('/settings');
            }}
          >
            <Settings size={14} />
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
          <>
            <button
              type="button"
              className={`rw-side-icon-btn ${searchOpen ? 'is-active' : ''}`}
              title="Search targets"
              aria-label="Search targets"
              aria-pressed={searchOpen}
              onClick={toggleSearch}
            >
              <Search size={14} />
            </button>
            <button
              type="button"
              className="rw-side-icon-btn"
              onClick={onAddTarget}
              title="Add target"
            >
              <Plus size={14} />
            </button>
            <button
              type="button"
              className="rw-side-icon-btn"
              title="More (coming soon)"
              onClick={() => console.log('[Research] more menu clicked (placeholder)')}
            >
              <MoreHorizontal size={14} />
            </button>
          </>
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

      {activeMode === 'workspace' && searchOpen && (
        <div className="px-3 py-2 rw-divider">
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') closeSearch(); }}
            placeholder="名称 / 代码 / 行业"
            className="w-full text-xs px-2 py-1 border border-[var(--rw-border)] rounded bg-white focus:outline-none focus:border-blue-500"
          />
        </div>
      )}

      {/* Body — Stella global chat list */}
      {activeMode === 'stella' && (
        <div className="flex-1 overflow-y-auto pt-1">
          {stellaChats === undefined && (
            <div className="px-3 py-4 text-xs text-[var(--rw-text-3)] text-center">
              Loading…
            </div>
          )}
          {stellaChats && stellaChats.length === 0 && (
            <div className="px-3 py-4 text-xs text-[var(--rw-text-3)] text-center">
              No chats yet
            </div>
          )}
          {stellaChats && [...stellaChats]
            .sort((a, b) => (b.last_updated || '').localeCompare(a.last_updated || ''))
            .map((chat) => (
              <div
                key={chat.chatSession_id}
                className={`rw-tree-row rw-chat-row group ${stellaActiveSessionId === chat.chatSession_id ? 'is-active' : ''}`}
                style={{ paddingLeft: 12 }}
                onClick={() => onSelectStellaChat?.(chat.chatSession_id)}
              >
                <MessageSquare size={13} className="flex-shrink-0 mr-1 text-[var(--rw-text-3)]" />
                <span className="truncate flex-1">{chat.title || 'Untitled'}</span>
                {onRenameStellaChat && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      openRename({ kind: 'stella', sessionId: chat.chatSession_id, title: chat.title || '' });
                    }}
                    className="ml-1 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-black/10 text-[var(--rw-text-3)] transition-opacity"
                    title="Rename"
                  >
                    <Pencil size={11} />
                  </button>
                )}
                {onDeleteStellaChat && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPendingDeleteChat({ kind: 'stella', sessionId: chat.chatSession_id, title: chat.title || 'Untitled' });
                    }}
                    className="ml-1 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-black/10 text-[var(--rw-text-3)] hover:text-red-500 transition-opacity"
                    title="Delete chat"
                  >
                    <Trash2 size={11} />
                  </button>
                )}
              </div>
            ))}
        </div>
      )}

      {/* Body — Workspace tree */}
      {activeMode === 'workspace' && (
      <div className="flex-1 overflow-y-auto pt-1">
        {targets.length === 0 && (
          <div className="px-3 py-4 text-xs text-[var(--rw-text-3)] text-center">
            No targets yet
          </div>
        )}
        {targets.length > 0 && filteredTargets.length === 0 && (
          <div className="px-3 py-4 text-xs text-[var(--rw-text-3)] text-center">
            无匹配结果
          </div>
        )}

        {filteredTargets.map((target) => {
          const code = target.stock_code;
          const isExpanded = expandedCodes.has(code);
          const files = filesByCode[code];

          const rootFiles = files?.filter((f) => !f.relPath.includes('/')) ?? [];

          return (
            <React.Fragment key={code}>
              {/* Target row */}
              <div
                className={`rw-tree-row group ${selectedCode === code ? 'is-active' : ''}`}
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
                <>
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
                        .sort((a, b) => (a.last_updated || '').localeCompare(b.last_updated || ''))
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
                    return (
                      <div
                        key={file.absPath}
                        className={`rw-tree-row ${activeFileAbsPath === file.absPath ? 'is-active' : ''}`}
                        style={{ paddingLeft: 12 }}
                        onClick={() => onOpenFile(file)}
                      >
                        <span style={{ width: 13 }} className="flex-shrink-0" />
                        <Icon size={13} className="flex-shrink-0 mr-1" />
                        <span className="truncate">{file.relPath}</span>
                      </div>
                    );
                  })}

                  {/* Sub-categories */}
                  {SUBCATEGORIES.map((cat) => {
                    const catFiles = files.filter((f) => f.relPath.startsWith(cat + '/'));
                    const catKey = `${code}::${cat}`;
                    const isCatExpanded = expandedCats.has(catKey);
                    const hasFiles = catFiles.length > 0;

                    return (
                      <React.Fragment key={catKey}>
                        <div
                          className={`rw-tree-row ${!hasFiles ? 'is-disabled' : ''}`}
                          style={{ paddingLeft: 12 }}
                          onClick={hasFiles ? () => onToggleCat(catKey) : undefined}
                        >
                          {hasFiles
                            ? (isCatExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />)
                            : <span style={{ width: 13 }} />}
                          <Folder size={13} className="flex-shrink-0 mr-1" />
                          <span className="truncate" style={{ color: 'var(--rw-text)' }}>{cat}</span>
                        </div>

                        {hasFiles && isCatExpanded && catFiles.map((file) => {
                          const Icon = fileIcon(file.relPath);
                          const fileName = file.relPath.slice(cat.length + 1);
                          return (
                            <div
                              key={file.absPath}
                              className={`rw-tree-row ${activeFileAbsPath === file.absPath ? 'is-active' : ''}`}
                              style={{ paddingLeft: 24 }}
                              onClick={() => onOpenFile(file)}
                            >
                              <Icon size={13} className="flex-shrink-0 mr-1" />
                              <span className="truncate">{fileName}</span>
                            </div>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
                </>
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
    </div>
  );
};
