import React, { useRef } from 'react';
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
}) => {
  const ref = useRef<HTMLDivElement>(null);
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
          const displayTitle = c.title && c.title.trim() ? c.title : 'Untitled chat';
          return (
            <div
              key={c.chatSession_id}
              role="option"
              aria-selected={isActive}
              aria-current={isActive ? 'true' : 'false'}
              className="px-3 py-2 text-sm cursor-pointer hover:bg-gray-50"
            >
              <div className="truncate">{displayTitle}</div>
              <div className="text-xs text-gray-500">{formatRelative(c.updated_at)}</div>
            </div>
          );
        })
      )}
    </div>
  );
};
