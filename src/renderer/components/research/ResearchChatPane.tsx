import React, { useCallback } from 'react';
import {
  PanelRightClose,
  PanelRightOpen,
  Compass,
  ScanSearch,
  FileText,
  Activity,
  Scale,
  Target,
  FileBarChart,
  BarChart3,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react';
import ChatView from '../chat/ChatView';
import { useMessages } from '../../lib/chat/agentChatSessionCacheManager';

interface ResearchChatPaneProps {
  activeFileAbsPath: string | null;
  /** Currently-selected research target (null = no target / global). */
  targetName?: string | null;
  targetCode?: string | null;
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
   * - 'workspace' (target picked): the welcome screen is bound to the target
   *   company (headline = name, ticker badge = code).
   * - 'stella' (global, no target): the welcome screen shows a neutral
   *   "Investment Research" landing with sample starting points. (The literal
   *   'stella' is an internal mode key only — it drives `data-research-mode`
   *   CSS hooks and is never shown to the user.)
   */
  mode?: 'workspace' | 'stella';
}

type QuickStartKind = 'intro' | 'task';
interface QuickStartCard {
  title: string;
  description: string;
  prompt: string;
  /** Lucide glyph rendered in the card's accent tile. */
  icon: LucideIcon;
  /** 'intro' cards auto-submit on click; 'task' cards fill the input. */
  kind: QuickStartKind;
}

/**
 * Intro card — shared by both modes. Decoupled from any target so the prompt
 * is identical in both modes. Auto-submits on click (editing the prompt
 * before sending adds no value).
 *
 * The prompt is persona-neutral: it asks the agent to describe its own
 * capabilities without naming an assistant persona, so nothing the user sees
 * (input box or sent message) references a mascot name.
 */
const INTRO_CARD: QuickStartCard = {
  title: 'Capabilities',
  description: 'Core skills & research workflow',
  prompt: '请介绍你的核心能力、典型工作流，以及推荐我作为投研用户的入门路径。',
  icon: Compass,
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
      icon: ScanSearch,
      title: 'Deep Analysis',
      description: 'Full fundamental analysis',
      prompt: `请对 ${label} 做一份深度基本面分析报告（公司概况、业务结构、财务、估值、风险）。`,
    },
    {
      kind: 'task',
      icon: FileText,
      title: 'Earnings Review',
      description: 'Review latest earnings',
      prompt: `请点评 ${label} 最新一期财报，重点关注收入结构、利润率与现金流变化。`,
    },
    {
      kind: 'task',
      icon: Activity,
      title: 'Marginal Tracking',
      description: 'Track key changes',
      prompt: `请跟踪 ${label} 的最新边际变化（业绩、行业、估值），整理到 tracking.md。`,
    },
    {
      kind: 'task',
      icon: Scale,
      title: 'Peer Comparison',
      description: 'Compare against peers',
      prompt: `请为 ${label} 选 4 家可比公司，对比关键财务和估值指标。`,
    },
    {
      kind: 'task',
      icon: Target,
      title: 'Investment Thesis',
      description: 'Build an investment framework',
      prompt: `/key-drivers ${label}`,
    },
  ];
}

/**
 * Global mode (no target) cards. Hardcoded sample companies — independent
 * of any persisted agent zero_states so the experience is consistent
 * regardless of legacy profile shape.
 */
const GLOBAL_CARDS: QuickStartCard[] = [
  INTRO_CARD,
  {
    kind: 'task',
    icon: Target,
    title: 'Investment Thesis',
    description: 'Short / long-term drivers + tracking variables',
    prompt: '/key-drivers 600036 招商银行',
  },
  {
    kind: 'task',
    icon: FileBarChart,
    title: 'Deep Report',
    description: '6-phase automated research pipeline',
    prompt: '请用 600036 招商银行 跑一次 /stock-analyze 完整流程，生成一份自动化深度研报。',
  },
  {
    kind: 'task',
    icon: BarChart3,
    title: 'Industry Comparison',
    description: 'Key metrics across industry peers',
    prompt: '请对比白酒行业 TOP5（贵州茅台、五粮液、洋河、泸州老窖、山西汾酒）的营收增速、毛利率、ROE 与估值。',
  },
  {
    kind: 'task',
    icon: SlidersHorizontal,
    title: 'Quant Screening',
    description: 'Filter the universe by multi-factor criteria',
    prompt: '在 A 股全市场筛选：PE(TTM) < 20、ROE(近 3 年均值) > 15%、营收近 3 年复合增速 > 10%。给出名单与关键指标。',
  },
];

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
 * Unified welcome screen for both global mode (no target) and workspace mode
 * (target bound). Same card grid; the eyebrow/title and card source differ by
 * mode. Persona-neutral by design — this is a financial research surface, not
 * a chatbot greeting.
 */
const ResearchWelcome: React.FC<ResearchWelcomeProps> = ({
  mode,
  targetName,
  targetCode,
  onPickFill,
  onPickSend,
}) => {
  // Workspace mode without a selected target = empty state. The 6 target-
  // scoped cards would render with an empty `${label}` (broken prompts), so
  // fall back to the global sample cards.
  const hasActiveTarget = !!(targetName || targetCode);
  const cards = React.useMemo(
    () =>
      mode === 'workspace' && hasActiveTarget
        ? buildWorkspaceCards(targetName, targetCode)
        : GLOBAL_CARDS,
    [mode, hasActiveTarget, targetName, targetCode],
  );

  const isUnlisted = !!targetName && !!targetCode && targetName === targetCode;
  const showTicker = mode === 'workspace' && !!targetCode && !isUnlisted;
  const inWorkspace = mode === 'workspace' && hasActiveTarget;

  // Eyebrow + headline adapt to context. Workspace = the bound company;
  // global = a neutral "Research Desk" framing.
  const eyebrow = inWorkspace ? 'Research Workspace' : 'Investment Research';
  const headline = inWorkspace
    ? (targetName || (targetCode as string))
    : 'Where would you like to begin?';

  return (
    <div className="rw-welcome">
      <div className="rw-welcome-head">
        <div className="rw-welcome-eyebrow">{eyebrow}</div>
        <div className="rw-welcome-headline-row">
          <h2 className="rw-welcome-headline">{headline}</h2>
          {showTicker && (
            <span className="rw-welcome-ticker">{targetCode}</span>
          )}
          {inWorkspace && isUnlisted && (
            <span className="rw-welcome-tag">Unlisted</span>
          )}
        </div>
        {!inWorkspace && (
          <p className="rw-welcome-sub">
            Pick a starting point below, or describe a company, sector, or
            screen to research.
          </p>
        )}
      </div>
      <div className="rw-welcome-cards">
        {cards.map((q) => {
          const isIntro = q.kind === 'intro';
          const Icon = q.icon;
          return (
            <button
              key={q.title}
              type="button"
              className={`rw-welcome-card${isIntro ? ' rw-welcome-card--intro' : ''}`}
              title={q.description}
              onClick={() => (isIntro ? onPickSend(q.prompt) : onPickFill(q.prompt))}
            >
              <span className="rw-welcome-card-icon" aria-hidden>
                <Icon size={15} strokeWidth={1.75} />
              </span>
              <span className="rw-welcome-card-text">
                <span className="rw-welcome-card-title">{q.title}</span>
                <span className="rw-welcome-card-desc">{q.description}</span>
              </span>
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
        className="relative flex items-center h-10 px-3 gap-2"
        style={{ background: 'var(--rw-bg-chat-header)' }}
      >
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-baseline justify-center gap-2 max-w-[70%]">
          {/* While the welcome screen is up, its headline already shows the
              company name + ticker badge — suppress the header copy to avoid
              printing the same name twice. Once the chat has content, restore
              the header so the bound target stays visible as the user scrolls. */}
          {isEmpty ? null : targetName ? (
            <>
              <span className="text-[12px] font-medium text-[var(--rw-accent-strong)] truncate">
                {targetName}
              </span>
              {targetCode && (
                targetCode === targetName ? (
                  // Unlisted target: stock_code === name. Show an "Unlisted" pill
                  // instead of duplicating the company name on the right.
                  <span className="px-1 rounded bg-gray-100 text-gray-500 text-[10px] flex-shrink-0">
                    Unlisted
                  </span>
                ) : (
                  <span className="text-[11px] text-[var(--si-gold)] flex-shrink-0">
                    {targetCode}
                  </span>
                )
              )}
            </>
          ) : (
            <span className="text-[11px] text-[var(--rw-text-3)]">No target selected</span>
          )}
        </div>
        {onToggleCollapsed && (
          <button
            type="button"
            className="rw-side-icon-btn flex-shrink-0 ml-auto"
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
