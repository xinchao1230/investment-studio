import React, { useCallback } from 'react';
import ChatView from '../chat/ChatView';
import { useMessages } from '../../lib/chat/agentChatSessionCacheManager';

interface ResearchChatPaneProps {
  activeFileAbsPath: string | null;
  /** Currently-selected research target (null = no target / global). */
  targetName?: string | null;
  targetCode?: string | null;
  /** Title of the active chat session, shown next to target name. */
  chatTitle?: string | null;
}

const SUGGESTIONS: string[] = [
  '跟踪公司边际变化并随时推送',
  '找到今日蓝宝书排名前5的话题中,开盘后30分钟市场选择的龙头公司',
  '搭建海底捞过去10年的单店模型',
];

const EmptySuggestions: React.FC<{ onPick: (text: string) => void }> = ({ onPick }) => (
  <div className="px-5 py-6">
    <div className="rw-suggest-title">
      今天一起<span className="rw-suggest-title-accent">研究什么?</span>
    </div>
    <div className="flex flex-col">
      {SUGGESTIONS.map((s) => (
        <div
          key={s}
          className="rw-suggest-row"
          role="button"
          tabIndex={0}
          onClick={() => onPick(s)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onPick(s); }}
        >
          <span className="rw-suggest-icon" aria-hidden />
          <span className="flex-1">{s}</span>
        </div>
      ))}
    </div>
    <div className="rw-suggest-divider" />
  </div>
);

/**
 * Embeds the existing ChatView in the research workspace right pane.
 *
 * Visual compaction is delivered via scoped CSS overrides under
 * [data-theme="research"] .rw-pane-right (see research-theme.css).
 *
 * When the embedded chat has no messages yet, an EmptySuggestions overlay
 * is rendered above ChatView. Clicking a suggestion fills the chat input
 * (via the global `agent:fillInput` event already handled by ChatInput).
 * The user presses Enter to send.
 */
export const ResearchChatPane: React.FC<ResearchChatPaneProps> = ({
  activeFileAbsPath: _activeFileAbsPath,
  targetName,
  targetCode,
  chatTitle,
}) => {
  const messages = useMessages();
  const isEmpty = !messages || messages.length === 0;

  const handlePick = useCallback((text: string) => {
    window.dispatchEvent(
      new CustomEvent('agent:fillInput', { detail: { text } }),
    );
  }, []);

  return (
    <aside className="rw-pane-right flex flex-col h-full" style={{ width: 380, flex: '0 0 380px' }}>
      <header
        className="flex items-center justify-between h-10 px-3 rw-divider gap-2"
        style={{ background: 'var(--rw-bg-chat-header)' }}
      >
        <div className="flex items-baseline gap-2 min-w-0 flex-1">
          {targetName ? (
            <>
              <span className="text-[12px] font-medium text-[var(--rw-text-1)] truncate">
                {targetName}
              </span>
              {targetCode && (
                <span className="text-[11px] text-[var(--rw-text-3)] flex-shrink-0">
                  {targetCode}
                </span>
              )}
              {chatTitle && (
                <span className="text-[11px] text-[var(--rw-text-3)] truncate" title={chatTitle}>
                  · {chatTitle}
                </span>
              )}
            </>
          ) : (
            <span className="text-[11px] text-[var(--rw-text-3)]">未选择标的</span>
          )}
        </div>
        <span className="text-[11px] text-[var(--rw-text-3)] flex-shrink-0">Research Assistant</span>
      </header>
      <div className="flex-1 min-h-0 overflow-hidden relative">
        {isEmpty && (
          <div className="absolute inset-x-0 top-0 z-10 pointer-events-none">
            <div className="pointer-events-auto">
              <EmptySuggestions onPick={handlePick} />
            </div>
          </div>
        )}
        <ChatView mode="compact" />
      </div>
    </aside>
  );
};
