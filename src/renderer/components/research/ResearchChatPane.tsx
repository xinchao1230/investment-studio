import React from 'react';
import ChatView from '../chat/ChatView';

interface ResearchChatPaneProps {
  activeFileAbsPath: string | null;
}

/**
 * Embeds the existing ChatView in the research workspace right pane.
 *
 * Visual compaction is delivered via scoped CSS overrides under
 * [data-theme="research"] .rw-pane-right (see research-theme.css).
 *
 * This iteration intentionally does NOT modify ChatView itself — that is
 * a follow-up task (compact mode prop). Today we constrain width and let
 * the existing component render inside the narrow pane.
 */
export const ResearchChatPane: React.FC<ResearchChatPaneProps> = ({ activeFileAbsPath: _activeFileAbsPath }) => {
  return (
    <aside className="rw-pane-right flex flex-col h-full" style={{ width: 380, flex: '0 0 380px' }}>
      <header className="flex items-center justify-between h-10 px-3 rw-divider" style={{ background: 'var(--rw-bg-chat-header)' }}>
        <span className="text-[13px] font-medium text-[var(--rw-text)]">PaiPai</span>
        {/* placeholder icon slots — wire up later */}
        <span className="text-[11px] text-[var(--rw-text-3)]">投研助手</span>
      </header>
      <div className="flex-1 min-h-0 overflow-hidden">
        <ChatView />
      </div>
    </aside>
  );
};
