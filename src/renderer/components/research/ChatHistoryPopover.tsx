import React, { useEffect, useRef, useState } from 'react';
import { Check, MessageSquare, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { ChatHistoryPopoverChat } from './ResearchChatPane';
import {
  getChatHistoryDisplayTitle,
  getChatHistoryGroupLabel,
  groupChatHistory,
  type ChatHistoryTargetNameLookup,
} from './chatHistoryGrouping';

export interface ChatHistoryPopoverProps {
  chats: ChatHistoryPopoverChat[];
  activeChatSessionId: string | null;
  /** Null when in Stella (no-target) context. Passed back to rename/delete
   * callbacks so the parent can route to the right hook. */
  targetCode: string | null;
  onSelectChat: (chatSessionId: string, targetCode?: string | null) => void | Promise<void>;
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
  /** Maps stock codes to display names for all-chat group labels. */
  targetNameLookup?: ChatHistoryTargetNameLookup;
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
  targetNameLookup,
}) => {
  const trimmedTargetName = selectedTargetName && selectedTargetName.trim()
    ? selectedTargetName.trim()
    : null;
  const showTargetCreateRow = showCreateActions && !!trimmedTargetName;
  const showGlobalCreateRow = showCreateActions;
  const targetCreateLabel = trimmedTargetName && targetCode && targetCode !== trimmedTargetName
    ? `New chat for ${trimmedTargetName} (${targetCode})`
    : 'New chat';
  const grouped = targetCode ? [{ key: '', chats }] : groupChatHistory(chats);
  const ref = useRef<HTMLDivElement>(null);
  const [renamingRow, setRenamingRow] = useState<{ id: string; value: string } | null>(null);
  // Inline confirm for delete on chats the user has actually used. Untouched
  // chats (default 'New Chat' title — see agentChatSessionService.ts) skip
  // confirm entirely. Keeps the popover self-contained: no portaled dialog,
  // no second focus layer.
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

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
              <span className="truncate">{targetCreateLabel}</span>
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
              <span>New general chat</span>
            </button>
          )}
          <div className="rw-history-create-divider" />
        </>
      )}
      {chats.length === 0 ? (
        <div className="rw-history-empty">
          <MessageSquare size={20} strokeWidth={1.5} />
          <div className="rw-history-empty-text">
            {showCreateActions
              ? 'No previous chats'
              : 'No chats yet'}
          </div>
          {!showCreateActions && (
            <div className="rw-history-empty-hint">Click + to start one</div>
          )}
        </div>
      ) : (
        grouped.map((chatGroup) => (
          <React.Fragment key={chatGroup.key || 'scoped'}>
            {!targetCode && (
              <div className="rw-history-group-label" role="presentation">
                {getChatHistoryGroupLabel(chatGroup.key, targetNameLookup)}
              </div>
            )}
            {chatGroup.chats.map((c) => {
              const isActive = c.chatSession_id === activeChatSessionId;
              const isRenaming = renamingRow?.id === c.chatSession_id;
              const rowTargetCode = c.targetCode ?? targetCode;
              const displayTitle = getChatHistoryDisplayTitle(c.title, targetCode ? null : chatGroup.key);
              return (
                <div
                  key={c.chatSession_id}
                  role="option"
                  aria-selected={isActive}
                  aria-current={isActive ? 'true' : 'false'}
                  className={`group rw-history-chat-row ${!targetCode ? 'is-grouped' : ''} ${isActive ? 'is-active' : ''}`}
                  onClick={() => {
                    if (isRenaming) return;
                    if (c.targetCode !== undefined) {
                      void onSelectChat(c.chatSession_id, c.targetCode);
                    } else {
                      void onSelectChat(c.chatSession_id);
                    }
                    onClose();
                  }}
                >
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
                            if (newTitle) void onRenameChat(c.chatSession_id, rowTargetCode, newTitle);
                            setRenamingRow(null);
                          } else if (e.key === 'Escape') {
                            e.stopPropagation();
                            setRenamingRow(null);
                          }
                        }}
                      />
                    ) : (
                      <div className="flex items-center min-w-0">
                        <div
                          className="truncate"
                          style={{
                            color: isActive ? 'var(--rw-text)' : 'var(--rw-text-2)',
                            fontWeight: isActive ? 600 : 500,
                          }}
                        >
                          {displayTitle}
                        </div>
                      </div>
                    )}
                  </div>
                  {!isRenaming && (
                    <>
                      {confirmingDeleteId === c.chatSession_id ? (
                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            className="rw-side-icon-btn rw-history-confirm-yes"
                            title="Confirm delete"
                            aria-label="Confirm delete"
                            onClick={(e) => {
                              e.stopPropagation();
                              void onDeleteChat(c.chatSession_id, rowTargetCode);
                              setConfirmingDeleteId(null);
                            }}
                          >
                            <Check size={12} />
                          </button>
                          <button
                            type="button"
                            className="rw-side-icon-btn"
                            title="Cancel"
                            aria-label="Cancel delete"
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmingDeleteId(null);
                            }}
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ) : (
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
                              const untouched = !c.title || c.title === 'New Chat';
                              if (untouched) {
                                void onDeleteChat(c.chatSession_id, rowTargetCode);
                              } else {
                                setConfirmingDeleteId(c.chatSession_id);
                              }
                            }}
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </React.Fragment>
        ))
      )}
    </div>
  );
};
