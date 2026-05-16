import React, { useCallback } from 'react';
import { PanelRightClose, PanelRightOpen } from 'lucide-react';
import ChatView from '../chat/ChatView';
import { useMessages } from '../../lib/chat/agentChatSessionCacheManager';

interface ResearchChatPaneProps {
  activeFileAbsPath: string | null;
  /** Currently-selected research target (null = no target / global). */
  targetName?: string | null;
  targetCode?: string | null;
  /** Title of the active chat session, shown next to target name. */
  chatTitle?: string | null;
  /** Width in pixels when expanded. Caller is responsible for clamping. */
  width?: number;
  /** When true, pane fills its parent (flex: 1) instead of using fixed width. */
  fill?: boolean;
  /** When true, render as a narrow icon strip instead of the full chat UI. */
  collapsed?: boolean;
  /** Toggle collapsed state. */
  onToggleCollapsed?: () => void;
  /**
   * Active research mode. Drives empty-state UX:
   * - 'workspace' (target picked): render the local hardcoded EmptySuggestions
   *   overlay; the agent ChatZeroStates is hidden via CSS.
   * - 'stella' (global Ask Stella): hide the local overlay; the agent
   *   ChatZeroStates (Stella greeting + quick_starts) is the welcome screen,
   *   topped by a small "Ask Stella" landing header.
   */
  mode?: 'workspace' | 'stella';
}

/**
 * Build context-aware quick prompts for the empty-chat state.
 *
 * - When a target is bound: prompts reference the target's name + code so
 *   one click kicks off real work on the current company.
 * - Without a target: fall back to generic research suggestions.
 */
function buildSuggestions(targetName?: string | null, targetCode?: string | null): string[] {
  const hasTarget = Boolean(targetName || targetCode);
  if (hasTarget) {
    const label = targetName && targetCode
      ? `${targetCode} ${targetName}`
      : (targetCode || targetName || '');
    return [
      `请对 ${label} 做一份深度基本面分析报告（公司概况、业务结构、财务、估值、风险）`,
      `请点评 ${label} 最新一期财报，重点关注收入结构、利润率与现金流变化`,
      `跟踪 ${label} 的边际变化（经营、行业、估值），整理成 tracking.md`,
    ];
  }
  return [
    '跟踪公司边际变化并随时推送',
    '找到今日蓝宝书排名前5的话题中,开盘后30分钟市场选择的龙头公司',
    '搭建海底捞过去10年的单店模型',
  ];
}

/**
 * Stella welcome screen rendered inside the research right pane when in
 * Stella mode and the active chat has no messages.
 *
 * This is intentionally self-contained (does NOT depend on the persisted
 * agent's `zero_states` field) because legacy profiles created before the
 * Stella zero_states config existed will lack that field, causing the
 * shared ChatZeroStates to render nothing.
 */
const STELLA_QUICK_STARTS: Array<{ title: string; description: string; prompt: string }> = [
  {
    title: '深度分析',
    description: '对一家上市公司做全面基本面分析',
    prompt: '请对 600519 贵州茅台 做一份深度基本面分析报告（公司概况、业务结构、财务、估值、风险）。',
  },
  {
    title: '行业对比',
    description: '对比同行业多家公司的关键指标',
    prompt: '请对比白酒行业 TOP5（贵州茅台、五粮液、洋河、泸州老窖、山西汾酒）的营收增速、毛利率、ROE 与估值。',
  },
  {
    title: '财报点评',
    description: '解读单季 / 年度财报',
    prompt: '请点评 002475 立讯精密 2025Q3 财报，重点关注收入结构、利润率与现金流变化。',
  },
  {
    title: '量化初筛',
    description: '按多因子条件筛选股票池',
    prompt: '在 A 股全市场筛选：PE(TTM) < 20、ROE(近 3 年均值) > 15%、营收近 3 年复合增速 > 10%。给出名单与关键指标。',
  },
];

const STELLA_GREETING =
  '你好，我是 Stella 📊 — 你的 AI 投资研究助手。可以帮你做深度分析、行业对比、财报点评、量化初筛。';

const StellaWelcome: React.FC<{ onPick: (text: string) => void }> = ({ onPick }) => (
  <div className="rw-stella-welcome">
    <div className="rw-stella-welcome-header">
      <span className="rw-stella-welcome-emoji" aria-hidden>📊</span>
      <span className="rw-stella-welcome-title">Ask Stella</span>
    </div>
    <div className="rw-stella-welcome-greeting">{STELLA_GREETING}</div>
    <div className="rw-stella-welcome-cards">
      {STELLA_QUICK_STARTS.map((q) => (
        <button
          key={q.title}
          type="button"
          className="rw-stella-welcome-card"
          onClick={() => onPick(q.prompt)}
        >
          <div className="rw-stella-welcome-card-title">{q.title}</div>
          <div className="rw-stella-welcome-card-desc">{q.description}</div>
        </button>
      ))}
    </div>
  </div>
);

const EmptySuggestions: React.FC<{
  suggestions: string[];
  onPick: (text: string) => void;
}> = ({ suggestions, onPick }) => (
  <div className="px-5 py-6">
    <div className="rw-suggest-title">
      今天一起<span className="rw-suggest-title-accent">研究什么?</span>
    </div>
    <div className="flex flex-col">
      {suggestions.map((s) => (
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
  width = 380,
  fill = false,
  collapsed = false,
  onToggleCollapsed,
  mode = 'workspace',
}) => {
  const messages = useMessages();
  /**
   * Empty-state check mirrors ChatViewContent.tsx: a chat is "empty" iff it
   * has no user-visible content AND no frontend-only "say-hi" greeting.
   *
   * - Exclude system/tool messages (the agent system prompt is always present)
   * - The "say-hi-" assistant message is a frontend placeholder; if present,
   *   the chat is not considered empty (we want the say-hi to show through).
   *
   * Single-pass with early-exit to avoid two array traversals.
   */
  const isEmpty = React.useMemo(() => {
    if (!messages || messages.length === 0) return true;
    for (const m of messages) {
      if (m.role === 'assistant' && m.id?.startsWith('say-hi-')) return false;
      if (m.role !== 'system' && m.role !== 'tool') return false;
    }
    return true;
  }, [messages]);

  const handlePick = useCallback((text: string) => {
    window.dispatchEvent(
      new CustomEvent('agent:fillInput', { detail: { text } }),
    );
  }, []);

  const hasTarget = Boolean(targetName || targetCode);
  const suggestions = React.useMemo(
    () => buildSuggestions(targetName, targetCode),
    [targetName, targetCode],
  );

  if (collapsed) {
    return (
      <aside
        className="rw-pane-right rw-pane-right--collapsed"
        onClick={onToggleCollapsed}
        title="Expand assistant (Ctrl+/)"
      >
        <button
          type="button"
          className="rw-side-icon-btn"
          aria-label="Expand assistant"
          onClick={(e) => { e.stopPropagation(); onToggleCollapsed?.(); }}
        >
          <PanelRightOpen size={14} />
        </button>
        <span className="rw-pane-right--collapsed-emoji" aria-hidden>📊</span>
      </aside>
    );
  }

  return (
    <aside
      className="rw-pane-right flex flex-col h-full"
      style={fill
        ? { flex: '1 1 0', minWidth: 0, width: '100%' }
        : { width, flex: `0 0 ${width}px` }}
      data-target-selected={hasTarget ? 'true' : 'false'}
      data-research-mode={mode}
    >
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
        {onToggleCollapsed && (
          <button
            type="button"
            className="rw-side-icon-btn flex-shrink-0"
            title="Collapse assistant (Ctrl+/)"
            aria-label="Collapse assistant"
            onClick={onToggleCollapsed}
          >
            <PanelRightClose size={14} />
          </button>
        )}
      </header>
      <div className="flex-1 min-h-0 overflow-hidden relative">
        {isEmpty && mode === 'workspace' && (
          <div className="absolute inset-x-0 top-0 z-10 pointer-events-none">
            <div className="pointer-events-auto">
              <EmptySuggestions suggestions={suggestions} onPick={handlePick} />
            </div>
          </div>
        )}
        {isEmpty && mode === 'stella' && (
          <div className="absolute inset-x-0 top-0 z-10 pointer-events-none">
            <div className="pointer-events-auto">
              <StellaWelcome onPick={handlePick} />
            </div>
          </div>
        )}
        <ChatView mode="compact" />
      </div>
    </aside>
  );
};
