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

type QuickStartKind = 'intro' | 'task';
interface QuickStartCard {
  title: string;
  description: string;
  prompt: string;
  /** 'intro' cards auto-submit on click; 'task' cards fill the input. */
  kind: QuickStartKind;
}

/**
 * "了解 Stella" intro card — shared by both modes. Decoupled from any
 * target so the prompt is identical in Stella mode and workspace mode.
 * Auto-submits on click (editing "请介绍你自己" before sending adds no value).
 */
const INTRO_CARD: QuickStartCard = {
  title: '了解 Stella',
  description: '新手必看：核心能力 + 工作流',
  prompt: '请介绍你（Stella）的核心能力、典型工作流，以及推荐我作为投研用户的入门路径。',
  kind: 'intro',
};

/**
 * Build target-aware quick-start cards for workspace mode.
 *
 * Unlisted targets persist `stock_code === name` as a synthetic placeholder
 * — collapse the label to a single token in that case to avoid
 * `${name} ${name}`.
 */
function buildWorkspaceCards(
  targetName?: string | null,
  targetCode?: string | null,
): QuickStartCard[] {
  const isUnlisted = !!targetName && !!targetCode && targetName === targetCode;
  const label = isUnlisted
    ? (targetName as string)
    : (targetName && targetCode
        ? `${targetCode} ${targetName}`
        : (targetCode || targetName || ''));
  return [
    INTRO_CARD,
    {
      kind: 'task',
      title: '深度分析',
      description: '全面基本面分析',
      prompt: `请对 ${label} 做一份深度基本面分析报告（公司概况、业务结构、财务、估值、风险）。`,
    },
    {
      kind: 'task',
      title: '财报点评',
      description: '解读最新财报',
      prompt: `请点评 ${label} 最新一期财报，重点关注收入结构、利润率与现金流变化。`,
    },
    {
      kind: 'task',
      title: '边际跟踪',
      description: '跟踪关键变化',
      prompt: `请跟踪 ${label} 的最新边际变化（业绩、行业、估值），整理到 tracking.md。`,
    },
    {
      kind: 'task',
      title: '同业对比',
      description: '同业横向比较',
      prompt: `请为 ${label} 选 4 家可比公司，对比关键财务和估值指标。`,
    },
  ];
}

/**
 * Stella mode (no target) cards. Hardcoded sample companies — independent
 * of any persisted agent zero_states so the experience is consistent
 * regardless of legacy profile shape.
 */
const STELLA_CARDS: QuickStartCard[] = [
  INTRO_CARD,
  {
    kind: 'task',
    title: '深度分析',
    description: '对一家上市公司做全面基本面分析',
    prompt: '请对 600519 贵州茅台 做一份深度基本面分析报告（公司概况、业务结构、财务、估值、风险）。',
  },
  {
    kind: 'task',
    title: '全自动深度研报',
    description: '体验 6-phase 自动化流水线',
    prompt: '请用 600036 招商银行 跑一次 /stock-analyze 完整流程，生成一份自动化深度研报。',
  },
  {
    kind: 'task',
    title: '行业对比',
    description: '对比同行业多家公司的关键指标',
    prompt: '请对比白酒行业 TOP5（贵州茅台、五粮液、洋河、泸州老窖、山西汾酒）的营收增速、毛利率、ROE 与估值。',
  },
  {
    kind: 'task',
    title: '量化初筛',
    description: '按多因子条件筛选股票池',
    prompt: '在 A 股全市场筛选：PE(TTM) < 20、ROE(近 3 年均值) > 15%、营收近 3 年复合增速 > 10%。给出名单与关键指标。',
  },
];

const STELLA_GREETING =
  '你好，我是 Stella 📊 — 你的 AI 投资研究助手。可以帮你做深度分析、行业对比、财报点评、量化初筛。';

interface ResearchWelcomeProps {
  mode: 'workspace' | 'stella';
  targetName?: string | null;
  targetCode?: string | null;
  /** Fill-the-input handler for 'task' cards (user edits then presses Enter). */
  onPickFill: (text: string) => void;
  /** Auto-submit handler for 'intro' card (one-click send). */
  onPickSend: (text: string) => void;
}

/**
 * Unified welcome screen for both Stella mode (global Ask Stella) and
 * workspace mode (target bound). Same card grid; header text and card
 * source differ by mode.
 */
const ResearchWelcome: React.FC<ResearchWelcomeProps> = ({
  mode,
  targetName,
  targetCode,
  onPickFill,
  onPickSend,
}) => {
  const cards = React.useMemo(
    () => (mode === 'workspace' ? buildWorkspaceCards(targetName, targetCode) : STELLA_CARDS),
    [mode, targetName, targetCode],
  );

  const isUnlisted = !!targetName && !!targetCode && targetName === targetCode;
  const showCodeSub = mode === 'workspace' && !!targetCode && !isUnlisted;

  return (
    <div className="rw-stella-welcome">
      <div className="rw-stella-welcome-header">
        <span className="rw-stella-welcome-emoji" aria-hidden>📊</span>
        <span className="rw-stella-welcome-title">
          {mode === 'workspace' ? `研究 ${targetName ?? ''}` : 'Ask Stella'}
        </span>
        {mode === 'workspace' && isUnlisted && (
          <span className="rw-stella-welcome-pill">未上市</span>
        )}
      </div>
      {showCodeSub && (
        <div className="rw-stella-welcome-subtitle">{targetCode}</div>
      )}
      {mode === 'stella' && (
        <div className="rw-stella-welcome-greeting">{STELLA_GREETING}</div>
      )}
      <div className="rw-stella-welcome-cards">
        {cards.map((q) => {
          const isIntro = q.kind === 'intro';
          return (
            <button
              key={q.title}
              type="button"
              className={`rw-stella-welcome-card${isIntro ? ' rw-stella-welcome-card--intro' : ''}`}
              onClick={() => (isIntro ? onPickSend(q.prompt) : onPickFill(q.prompt))}
            >
              {isIntro && (
                <span className="rw-stella-welcome-card-icon" aria-hidden>💡</span>
              )}
              <div className="rw-stella-welcome-card-title">{q.title}</div>
              <div className="rw-stella-welcome-card-desc">{q.description}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

/**
 * Embeds the existing ChatView in the research workspace right pane.
 *
 * Visual compaction is delivered via scoped CSS overrides under
 * [data-theme="research"] .rw-pane-right (see research-theme.css).
 *
 * When the embedded chat has no messages yet, the unified ResearchWelcome
 * overlay is rendered above ChatView. Task cards fill the chat input (via
 * the global `agent:fillInput` event already handled by ChatInput) — the
 * user presses Enter to send. The intro card auto-submits via the same
 * event with `autoSubmit: true`.
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

  const handlePickFill = useCallback((text: string) => {
    window.dispatchEvent(
      new CustomEvent('agent:fillInput', { detail: { text } }),
    );
  }, []);

  const handlePickSend = useCallback((text: string) => {
    window.dispatchEvent(
      new CustomEvent('agent:fillInput', { detail: { text, autoSubmit: true } }),
    );
  }, []);

  const hasTarget = Boolean(targetName || targetCode);

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
                targetCode === targetName ? (
                  // Unlisted target: stock_code === name. Show a "未上市" pill
                  // instead of duplicating the company name on the right.
                  <span className="px-1 rounded bg-gray-100 text-gray-500 text-[10px] flex-shrink-0">
                    未上市
                  </span>
                ) : (
                  <span className="text-[11px] text-[var(--rw-text-3)] flex-shrink-0">
                    {targetCode}
                  </span>
                )
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
        {isEmpty && (
          <div className="absolute inset-x-0 top-0 z-10 pointer-events-none">
            <div className="pointer-events-auto">
              <ResearchWelcome
                mode={mode}
                targetName={targetName}
                targetCode={targetCode}
                onPickFill={handlePickFill}
                onPickSend={handlePickSend}
              />
            </div>
          </div>
        )}
        <ChatView mode="compact" />
      </div>
    </aside>
  );
};
