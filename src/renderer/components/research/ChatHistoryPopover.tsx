import React, { useEffect, useRef, useState } from 'react';
import { MessageSquare, Pencil, Plus, Trash2 } from 'lucide-react';
import type { ChatHistoryPopoverChat } from './ResearchChatPane';

export interface ChatHistoryPopoverProps {
  chats: ChatHistoryPopoverChat[];
  activeChatSessionId: string | null;
  /** Null when in Stella (no-target) context. Passed back to rename/delete
   * callbacks so the parent can route to the right hook. */
  targetCode: string | null;
  onSelectChat: (chatSessionId: string) => void | Promise<void>;
  onRenameChat: (chatSessionId: string, targetCode: string | null, title: string) => void | Promise<void>;
  onDeleteChat: (chatSessionId: string, targetCode: string | null) => void | Promise<void>;
  onClose: () => void;
  /** When true, render a create section above the chat list (Workbench mode).
   * Stella mode omits this since the right-pane New chat button already
   * creates a global chat. */
  showCreateActions?: boolean;
  /** Display name of the currently-selected target. When provided, a
   * "+ New chat for <name>" row is rendered. Null/empty hides it. */
  selectedTargetName?: string | null;
  /** Workbench mode: create a chat bound to the currently-selected target. */
  onCreateTargetChat?: () => void;
  /** Workbench mode: create a global chat. Parent is expected to also
   * switch the sidebar to Stella mode so the new chat is visible. */
  onCreateGlobalChat?: () => void;
}

function formatRelative(ts?: number | string): string {
  if (ts == null) return '';
  const n = typeof ts === 'string' ? new Date(ts).getTime() : ts;
  if (!Number.isFinite(n)) return '';
  const delta = Date.now() - n;
  const min = Math.round(delta / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(n).toLocaleDateString();
}

export const ChatHistoryPopover: React.FC<ChatHistoryPopoverProps> = ({
  chats,
  activeChatSessionId,
  targetCode,
  onSelectChat,
  onRenameChat,
  onDeleteChat,
  onClose,
  showCreateActions = false,
  selectedTargetName = null,
  onCreateTargetChat,
  onCreateGlobalChat,
}) => {
  const trimmedTargetName = selectedTargetName && selectedTargetName.trim()
    ? selectedTargetName.trim()
    : null;
  const showTargetCreateRow = showCreateActions && !!trimmedTargetName;
  const showGlobalCreateRow = showCreateActions;
  const ref = useRef<HTMLDivElement>(null);
  const [renamingRow, setRenamingRow] = useState<{ id: string; value: string } | null>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const handleMouse = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', handleKey);
    window.addEventListener('mousedown', handleMouse, true);
    return () => {
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('mousedown', handleMouse, true);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="listbox"
      aria-label="Chat history"
      className="absolute z-50 rounded-md border shadow-lg"
      style={{
        top: 40,
        left: 36,
        width: 'min(320px, calc(100% - 24px))',
        maxHeight: '60vh',
        overflowY: 'auto',
        paddingTop: 4,
        paddingBottom: 6,
        background: 'var(--rw-bg-popover, white)',
        borderColor: 'var(--rw-border, rgba(0,0,0,0.1))',
      }}
    >
      {showCreateActions && (
        <>
          {showTargetCreateRow && (
            <button
              type="button"
              className="rw-history-create-row"
              onClick={() => {
                onCreateTargetChat?.();
                onClose();
              }}
            >
              <Plus size={14} />
              <span className="truncate">New chat for {trimmedTargetName}</span>
            </button>
          )}
          {showGlobalCreateRow && (
            <button
              type="button"
              className="rw-history-create-row"
              onClick={() => {
                onCreateGlobalChat?.();
                onClose();
              }}
            >
              <Plus size={14} />
              <span>New global chat</span>
            </button>
          )}
          <div className="rw-history-create-divider" />
        </>
      )}
      {chats.length === 0 ? (
        <div className="px-3 py-4 text-xs text-gray-500">
          {showCreateActions ? 'No chats yet.' : 'No chats yet. Click + to start one.'}
        </div>
      ) : (
        chats.map((c) => {
          const isActive = c.chatSession_id === activeChatSessionId;
          const isRenaming = renamingRow?.id === c.chatSession_id;
          const displayTitle = c.title && c.title.trim() ? c.title : 'Untitled chat';
          return (
            <div
              key={c.chatSession_id}
              role="option"
              aria-selected={isActive}
              aria-current={isActive ? 'true' : 'false'}
              className={`group rw-history-chat-row ${isActive ? 'is-active' : ''}`}
              onClick={() => {
                if (isRenaming) return;
                void onSelectChat(c.chatSession_id);
                onClose();
              }}
            >
              <MessageSquare size={14} aria-hidden />
              <div className="min-w-0 flex-1">
                {isRenaming ? (
                  <input
                    autoFocus
                    className="w-full px-1 py-0.5 text-[13px] border rounded"
                    value={renamingRow!.value}
                    onChange={(e) => setRenamingRow({ id: c.chatSession_id, value: e.target.value })}
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const newTitle = renamingRow!.value.trim();
                        if (newTitle) void onRenameChat(c.chatSession_id, targetCode, newTitle);
                        setRenamingRow(null);
                      } else if (e.key === 'Escape') {
                        e.stopPropagation();
                        setRenamingRow(null);
                      }
                    }}
                  />
                ) : (
                  <div
                    className="truncate"
                    style={{
                      color: isActive ? 'var(--rw-text)' : 'var(--rw-text-2)',
                      fontWeight: isActive ? 600 : 500,
                    }}
                  >
                    {displayTitle}
                  </div>
                )}
              </div>
              {!isRenaming && (
                <>
                  <span className="rw-history-chat-time">{formatRelative(c.last_updated)}</span>
                  <div className="hidden group-hover:flex items-center gap-1">
                    <button
                      type="button"
                      className="rw-side-icon-btn"
                      title="Rename chat"
                      aria-label="Rename chat"
                      onClick={(e) => {
                        e.stopPropagation();
                        setRenamingRow({ id: c.chatSession_id, value: c.title ?? '' });
                      }}
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      type="button"
                      className="rw-side-icon-btn"
                      title="Delete chat"
                      aria-label="Delete chat"
                      onClick={(e) => {
                        e.stopPropagation();
                        void onDeleteChat(c.chatSession_id, targetCode);
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </>
              )}
            </div>
          );
        })
      )}
    </div>
  );
};
