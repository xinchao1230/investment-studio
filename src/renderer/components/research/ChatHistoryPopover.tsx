import React, { useEffect, useRef, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
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
}) => {
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
        background: 'var(--rw-bg-popover, white)',
        borderColor: 'var(--rw-border, rgba(0,0,0,0.1))',
      }}
    >
      {chats.length === 0 ? (
        <div className="px-3 py-4 text-xs text-gray-500">
          No chats yet. Click + to start one.
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
              className="group flex items-start justify-between gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-gray-50"
              onClick={() => {
                if (isRenaming) return;
                void onSelectChat(c.chatSession_id);
                onClose();
              }}
            >
              <div className="min-w-0 flex-1">
                {isRenaming ? (
                  <input
                    autoFocus
                    className="w-full px-1 py-0.5 text-sm border rounded"
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
                  <>
                    <div className="truncate">{displayTitle}</div>
                    <div className="text-xs text-gray-500">{formatRelative(c.updated_at)}</div>
                  </>
                )}
              </div>
              {!isRenaming && (
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
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
              )}
            </div>
          );
        })
      )}
    </div>
  );
};
