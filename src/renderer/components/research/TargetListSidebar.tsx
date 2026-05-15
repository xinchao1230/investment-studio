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
} from 'lucide-react';
import type { TargetFile } from './usePortfolio';
import type { ResearchChatSessionMeta } from './researchChatIpc';

export interface Target {
  stock_code: string;
  name: string;
  industry: string;
  follow_date: string;
  directory: string;
}

interface TargetListSidebarProps {
  targets: Target[];
  selectedCode: string | null;
  expandedCodes: Set<string>;
  filesByCode: Record<string, TargetFile[] | undefined>;
  activeFileAbsPath: string | null;
  onSelectTarget: (code: string) => void;
  onToggleExpand: (code: string) => void;
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
}

const SUBCATEGORIES = ['纪要', '专家交流', '公司交流', '研报', '模型', '公告', '其它'];

function fileIcon(relPath: string) {
  if (/\.(md|yaml|txt)$/i.test(relPath)) return FileText;
  if (/\.json$/i.test(relPath)) return FileCode;
  return FileText;
}

export const TargetListSidebar: React.FC<TargetListSidebarProps> = ({
  targets,
  selectedCode,
  expandedCodes,
  filesByCode,
  activeFileAbsPath,
  onSelectTarget,
  onToggleExpand,
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
}) => {
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = React.useRef<HTMLInputElement | null>(null);

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

  const toggleCat = useCallback((key: string) => {
    setExpandedCats((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const navigate = useNavigate();

  return (
    <div className="rw-pane-left flex flex-col h-full" style={{ width: 240 }}>
      {/* Header — Workspace title */}
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <span className="rw-side-title">Workspace</span>
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
      </div>

      {/* Secondary tab row */}
      <div className="flex items-center px-3 pb-2 rw-divider">
        <span className="rw-side-tab">工作区</span>
        <div className="flex-1" />
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
      </div>

      {topSlot}

      {searchOpen && (
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

      {/* Tree */}
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
                  className="ml-1.5 truncate flex-1 cursor-pointer"
                  style={{ fontWeight: 700 }}
                  onClick={() => onSelectTarget(code)}
                >
                  {target.name}
                </span>
                <span className="ml-1.5 flex-shrink-0 text-[11px] text-[var(--rw-text-3)]">
                  {code}
                </span>
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
                        <span className="truncate flex-1" style={{ fontWeight: 700, color: 'var(--rw-text)' }}>对话</span>
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
                      {(chatsByCode?.[code] ?? []).map((chat) => (
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
                                const next = window.prompt('Rename chat', chat.title || '');
                                if (next && next.trim() && next.trim() !== chat.title) {
                                  onRenameChat(code, chat.chatSession_id, next.trim());
                                }
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
                                if (window.confirm(`Delete chat "${chat.title || 'Untitled'}"?`)) {
                                  onDeleteChat(code, chat.chatSession_id);
                                }
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
                          onClick={hasFiles ? () => toggleCat(catKey) : undefined}
                        >
                          {hasFiles
                            ? (isCatExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />)
                            : <span style={{ width: 13 }} />}
                          <Folder size={13} className="flex-shrink-0 mr-1" />
                          <span className="truncate" style={{ fontWeight: 700, color: 'var(--rw-text)' }}>{cat}</span>
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
    </div>
  );
};
