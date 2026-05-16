import React, { useState, useCallback, memo, useMemo, useEffect, useRef } from 'react';
import {
  useOutletContext,
  useParams,
  useNavigate,
  useLocation,
} from 'react-router-dom';

import ChatViewHeader from './ChatViewHeader';
import ChatViewContent from './ChatViewContent';
import { ContextMenu } from './ContextMenu';
import ApprovalBar from './ApprovalBar';
import { EditAgentMenuDropdown, AttachMenuDropdown } from '../menu';
import { Message } from '../../types/chatTypes';
import { useProfileData, useChats, useAgentConfig } from '../userData/userDataProvider';
import { useToast } from '../ui/ToastProvider';
import { useLayout } from '../layout/LayoutProvider';
import {
  ContextOption,
  ContextMenuOptionType,
  ContextMenuTriggerType,
  MentionSourceType,
  getDefaultMenuOptions,
  getContextMenuTriggerType,
  getCurrentSkillSearchQuery,
  filterSkillsByQuery,
  insertSkillMention,
} from '../../lib/chat/contextMentions';
import { quickSearchFiles, searchWorkspaceFiles } from '../../lib/workspace/workspaceSearchService';
import { WorkspaceMenuActions } from './workspace/WorkspaceExplorerSidepane';
import {
  useCurrentChatSessionId,
  usePendingApprovalRequests,
  useErrorMessage,
  useMessages,
  useStreamingMessageId,
  agentChatSessionCacheManager,
} from '../../lib/chat/agentChatSessionCacheManager';
import { agentChatIpc } from '../../lib/chat/agentChatIpc';
import { profileDataManager } from '../../lib/userData';
import { AgentContextType } from '../../types/agentContextTypes';
import { BRAND_NAME } from '@shared/constants/branding';
import { getDefaultPrimaryAgentName } from '../../../main/lib/userDataADO/types/profile';

// Compact (embedded) mode: ensure the backend has an active chat session.
// If not, pick the primary agent (or first chat) from the profile and start
// a new chat session for it. Mirrors AgentPage.selectPrimaryAgentOnStartup.
async function ensureCompactChatSession(): Promise<void> {
  if (agentChatSessionCacheManager.getCurrentChatSessionId()) return;
  try {
    if (window.electronAPI?.agentChat?.getCurrentChatSession) {
      const cur = await window.electronAPI.agentChat.getCurrentChatSession();
      if (cur?.success && cur.data?.chatId && cur.data?.chatSessionId) {
        agentChatSessionCacheManager.setCurrentChatSessionId(cur.data.chatId, cur.data.chatSessionId);
        return;
      }
    }
    const profile = profileDataManager.getProfile() as any;
    if (!profile) return;
    const primaryAgentName = profile.primaryAgent || getDefaultPrimaryAgentName(BRAND_NAME);
    const chats = profile.chats || [];
    if (chats.length === 0) return;
    const primaryChat = chats.find((c: any) => c.agent?.name === primaryAgentName);
    const targetChatId = primaryChat?.chat_id || chats[0]?.chat_id;
    if (!targetChatId) return;
    if (window.electronAPI?.agentChat?.startNewChatFor) {
      const result = await window.electronAPI.agentChat.startNewChatFor(targetChatId);
      if (result?.success && result.chatSessionId) {
        agentChatSessionCacheManager.setCurrentChatSessionId(targetChatId, result.chatSessionId);
      }
    }
  } catch (err) {
    console.error('[ChatView compact] ensureCompactChatSession failed:', err);
  }
}

export interface ChatViewProps {
  mode?: 'full' | 'compact';
}

const ChatView: React.FC<ChatViewProps> = memo(({ mode = 'full' }) => {
  // 🔥 DEBUG: Log when ChatView renders
  console.log('[ChatView] 🚀 ChatView component rendering');
  
  // Investment Studio Research workspace embeds ChatView OUTSIDE of the
  // /agent outlet, so useOutletContext returns undefined there. Default to an
  // empty context object so destructuring doesn't crash the entire renderer.
  // (Embedded ChatView in Research is a placeholder pending real wiring.)
  const outletCtx = (useOutletContext<AgentContextType>() ?? {}) as Partial<AgentContextType>;

  // In compact mode (embedded in Research workspace), there is no outlet
  // context. Source messages and sendMessage internally so the chat actually
  // works.
  const internalMessages = useMessages();
  const internalStreamingMessageId = useStreamingMessageId() || undefined;
  const internalSendMessage = useCallback(async (message: Message) => {
    try {
      await ensureCompactChatSession();
      const userMsg: Message = {
        ...message,
        id: message.id || Date.now().toString(),
        streamingComplete: true,
      };
      const sid = agentChatSessionCacheManager.getCurrentChatSessionId();
      if (sid) {
        agentChatSessionCacheManager.addUserMessage(sid, userMsg);
      }
      await agentChatIpc.streamMessage(userMsg, {
        onAssistantMessage: () => {},
        onToolUse: () => {},
        onToolResult: () => {},
      });
    } catch (error) {
      const sid = agentChatSessionCacheManager.getCurrentChatSessionId();
      const msg = error instanceof Error ? error.message : String(error);
      if (sid) agentChatSessionCacheManager.setErrorMessage(sid, msg);
      console.error('[ChatView compact] sendMessage failed:', error);
    }
  }, []);

  // Cancel handler for compact mode (research workspace etc.). Uses current
  // chatId from the cache so we don't need to thread an outlet context down.
  const internalCancelChat = useCallback(async () => {
    const cid = agentChatSessionCacheManager.getCurrentChatId();
    if (!cid) return;
    try {
      await agentChatIpc.cancelChat(cid);
    } catch (err) {
      console.error('[ChatView compact] cancelChat failed:', err);
    }
  }, []);

  // Compact-mode bootstrap: make sure backend has a current chat session so
  // model selector / sendMessage have something to operate on.
  useEffect(() => {
    if (mode !== 'compact') return;
    void ensureCompactChatSession();
  }, [mode]);

  const {
    messages = mode === 'compact' ? internalMessages : [],
    allMessages = mode === 'compact' ? internalMessages : [],
    streamingMessageId = mode === 'compact' ? internalStreamingMessageId : undefined,
    onSendMessage = mode === 'compact' ? internalSendMessage : () => {},
    onCancelChat = mode === 'compact' ? internalCancelChat : undefined,
    onWorkspaceMenuToggle,
    workspaceMenuState,
    onEditAgentMenuToggle: ctxEditAgentMenuToggle,
    onAttachMenuToggle: ctxAttachMenuToggle,
    onFileTreeNodeMenuToggle,
  } = outletCtx;

  // Compact-mode local state for the Edit Agent / Attach popups, since the
  // global versions live in AppLayout which is not in scope here.
  type MenuPos = { top: number; left: number; triggerTop?: number };
  const [compactEditAgentMenu, setCompactEditAgentMenu] = useState<{ isOpen: boolean; position: MenuPos | null }>({ isOpen: false, position: null });
  const [compactAttachMenu, setCompactAttachMenu] = useState<{ isOpen: boolean; position: MenuPos | null }>({ isOpen: false, position: null });
  const compactEditAgentMenuRef = useRef<HTMLDivElement>(null);
  const compactAttachMenuRef = useRef<HTMLDivElement>(null);

  const computeMenuPosition = (buttonElement: HTMLElement, menuWidth: number): MenuPos => {
    const rect = buttonElement.getBoundingClientRect();
    let left = rect.left;
    if (left + menuWidth > window.innerWidth) {
      left = rect.right - menuWidth;
    }
    return { top: rect.bottom + 4, left, triggerTop: rect.top };
  };

  const handleCompactEditAgentToggle = useCallback((buttonElement: HTMLElement) => {
    setCompactEditAgentMenu((prev) => prev.isOpen
      ? { isOpen: false, position: null }
      : { isOpen: true, position: computeMenuPosition(buttonElement, 240) });
  }, []);
  const handleCompactAttachToggle = useCallback((buttonElement: HTMLElement) => {
    setCompactAttachMenu((prev) => prev.isOpen
      ? { isOpen: false, position: null }
      : { isOpen: true, position: computeMenuPosition(buttonElement, 200) });
  }, []);
  const handleCompactEditAgentClose = useCallback(() => setCompactEditAgentMenu({ isOpen: false, position: null }), []);
  const handleCompactAttachClose = useCallback(() => setCompactAttachMenu({ isOpen: false, position: null }), []);

  // Click-outside to close compact menus
  useEffect(() => {
    if (mode !== 'compact') return;
    if (!compactEditAgentMenu.isOpen && !compactAttachMenu.isOpen) return;
    const onDocDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (compactEditAgentMenu.isOpen && compactEditAgentMenuRef.current && !compactEditAgentMenuRef.current.contains(target)) {
        setCompactEditAgentMenu({ isOpen: false, position: null });
      }
      if (compactAttachMenu.isOpen && compactAttachMenuRef.current && !compactAttachMenuRef.current.contains(target)) {
        setCompactAttachMenu({ isOpen: false, position: null });
      }
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [mode, compactEditAgentMenu.isOpen, compactAttachMenu.isOpen]);

  const onEditAgentMenuToggle = mode === 'compact' ? handleCompactEditAgentToggle : ctxEditAgentMenuToggle;
  const onAttachMenuToggle = mode === 'compact' ? handleCompactAttachToggle : ctxAttachMenuToggle;

  // 🔥 Route Synchronization
  const { chatId: routeChatId, sessionId: routeSessionId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  // Handle selectedText from navigation state
  useEffect(() => {
    const state = location.state as { selectedText?: string } | null;
    if (state?.selectedText) {
      // Dispatch event to fill input
      const fillInputEvent = new CustomEvent('agent:fillInput', {
        detail: { text: state.selectedText },
      });
      window.dispatchEvent(fillInputEvent);

      // Clear state to prevent re-triggering
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state, navigate, location.pathname]);

  // Get currentChatId and currentChatSessionId from agentChatSessionCacheManager
  const [currentChatId, setCurrentChatId] = useState<string | null>(
    agentChatSessionCacheManager.getCurrentChatId(),
  );
  const [currentChatSessionId, setCurrentChatSessionId] = useState<
    string | null
  >(agentChatSessionCacheManager.getCurrentChatSessionId());

  // Subscribe to changes
  useEffect(() => {
    const unsubscribe =
      agentChatSessionCacheManager.subscribeToCurrentChatSessionId(() => {
        const newChatId = agentChatSessionCacheManager.getCurrentChatId();
        const newChatSessionId =
          agentChatSessionCacheManager.getCurrentChatSessionId();
        setCurrentChatId(newChatId);
        setCurrentChatSessionId(newChatSessionId);

        // Skip auto-navigation in compact mode (embedded in Research workspace).
        if (mode === 'compact') return;

        // 🔥 Fix: When cache manager updates and current route has no ID, navigate immediately
        // This fixes ChatView's inability to sync route correctly after FRE completion
        // Because useEffect dependency updates may be delayed, causing syncRoute not to re-execute
        if (newChatId && newChatSessionId) {
          // Check if current route is the default route (no chatId and sessionId)
          const currentPath = window.location.pathname;
          if (currentPath === '/agent/chat' || currentPath === '/agent' || currentPath === '/agent/') {
            console.log('[ChatView] 🔥 Cache updated with new session, navigating from default route:', {
              newChatId,
              newChatSessionId,
              currentPath
            });
            // Use window.history or trigger navigation directly
            // Use setTimeout to ensure execution after React render cycle
            setTimeout(() => {
              window.dispatchEvent(new CustomEvent('chatview:forceNavigate', {
                detail: { chatId: newChatId, sessionId: newChatSessionId }
              }));
            }, 0);
          }
        }
      });
    return unsubscribe;
  }, []);
  
  // 🔥 New: listen for force navigation event
  useEffect(() => {
    if (mode === 'compact') return;
    const handleForceNavigate = (event: CustomEvent<{ chatId: string; sessionId: string }>) => {
      const { chatId, sessionId } = event.detail;
      const currentPath = window.location.pathname;
      // Only navigate on default route
      if (currentPath === '/agent/chat' || currentPath === '/agent' || currentPath === '/agent/') {
        console.log('[ChatView] 🔥 Force navigating to session:', { chatId, sessionId });
        navigate(`/agent/chat/${chatId}/${sessionId}`, { replace: true });
      }
    };
    
    window.addEventListener('chatview:forceNavigate', handleForceNavigate as EventListener);
    return () => {
      window.removeEventListener('chatview:forceNavigate', handleForceNavigate as EventListener);
    };
  }, [navigate]);

  // 🔥 New: On first component render, proactively fetch current session state from backend
  // This fixes the issue of potentially missing initial IPC events on normal startup
  // Scenario: Backend has already sent currentChatSessionIdChanged event before frontend sets up IPC listeners
  const initialFetchDoneRef = useRef(false);
  useEffect(() => {
    if (mode === 'compact') return;
    // Only execute once
    if (initialFetchDoneRef.current) return;
    initialFetchDoneRef.current = true;

    const fetchCurrentSession = async () => {
      // Check if cache manager already has values
      const cacheCurrentChatId = agentChatSessionCacheManager.getCurrentChatId();
      const cacheCurrentChatSessionId = agentChatSessionCacheManager.getCurrentChatSessionId();
      
      if (cacheCurrentChatId && cacheCurrentChatSessionId) {
        console.log('[ChatView] 🔥 Initial: Cache already has session:', {
          cacheCurrentChatId,
          cacheCurrentChatSessionId
        });
        
        // 🔥 Fix: If cache already has values, check if current route needs navigation
        const currentPath = window.location.pathname;
        if (currentPath === '/agent/chat' || currentPath === '/agent' || currentPath === '/agent/') {
          console.log('[ChatView] 🔥 Initial: Navigating to existing session from default route');
          window.dispatchEvent(new CustomEvent('chatview:forceNavigate', {
            detail: { chatId: cacheCurrentChatId, sessionId: cacheCurrentChatSessionId }
          }));
        }
        return;
      }

      // Cache manager has no values, try fetching from backend
      console.log('[ChatView] 🔥 Initial: Cache empty, fetching current session from backend...');
      
      try {
        if (window.electronAPI?.agentChat?.getCurrentChatSession) {
          const result = await window.electronAPI.agentChat.getCurrentChatSession();
          if (result.success && result.data?.chatId && result.data?.chatSessionId) {
            console.log('[ChatView] 🔥 Initial: Got session from backend:', {
              chatId: result.data.chatId,
              chatSessionId: result.data.chatSessionId
            });
            
            // Update cache manager (this triggers subscription callbacks, then navigation)
            agentChatSessionCacheManager.setCurrentChatSessionId(result.data.chatId, result.data.chatSessionId);
          } else {
            console.log('[ChatView] 🔥 Initial: Backend has no active session yet');
          }
        } else {
          console.log('[ChatView] 🔥 Initial: getCurrentChatSession API not available');
        }
      } catch (error) {
        console.error('[ChatView] 🔥 Initial: Failed to fetch current session:', error);
      }
    };

    // Delay execution to ensure IPC is ready
    setTimeout(fetchCurrentSession, 100);
  }, []);

  // We need to track the last processed route to avoid redundant updates
  const lastProcessedRouteRef = useRef<string>('');

  useEffect(() => {
    if (mode === 'compact') return;
    const syncRoute = async () => {
      const currentRouteKey = `${routeChatId}-${routeSessionId}`;

      // Case 1: Route has both IDs (Switch Session)
      if (routeChatId && routeSessionId) {
        // Update ref to ensure we can detect when we leave this route
        lastProcessedRouteRef.current = currentRouteKey;

        // Only switch if the session ID doesn't match the current one
        // AND we haven't just processed this route (to prevent loops)
        if (routeSessionId !== currentChatSessionId) {
          console.log('[ChatView] 🔄 Route changed, switching session:', {
            routeChatId,
            routeSessionId,
          });
          if (window.electronAPI?.agentChat?.switchToChatSession) {
            await window.electronAPI.agentChat.switchToChatSession(
              routeChatId,
              routeSessionId,
            );
          }
        }
        return;
      }

      // Case 2: Route has only chatId (New Chat intent)
      if (routeChatId && !routeSessionId) {
        // Only trigger if we haven't just processed this intent
        if (lastProcessedRouteRef.current !== currentRouteKey) {
          console.log(
            '[ChatView] 🆕 Route has chatId only, starting new chat:',
            routeChatId,
          );
          lastProcessedRouteRef.current = currentRouteKey;

          if (window.electronAPI?.agentChat?.startNewChatFor) {
            const result = await window.electronAPI.agentChat.startNewChatFor(
              routeChatId,
            );
            if (result.success && result.chatSessionId) {
              console.log(
                '[ChatView] ✅ New chat started, redirecting to session:',
                result.chatSessionId,
              );
              // Replace URL with new session ID
              navigate(`/agent/chat/${routeChatId}/${result.chatSessionId}`, {
                replace: true,
                state: location.state,
              });
            }
          }
        }
        return;
      }

      // Case 3: No IDs in route (Default view)
      if (!routeChatId && !routeSessionId) {
        // If we have a current session, redirect to it to keep URL in sync
        // 🔥 Fix: Get latest values directly from cache manager, instead of using potentially stale local state
        const cacheCurrentChatId = agentChatSessionCacheManager.getCurrentChatId();
        const cacheCurrentChatSessionId = agentChatSessionCacheManager.getCurrentChatSessionId();
        if (cacheCurrentChatId && cacheCurrentChatSessionId) {
          console.log(
            '[ChatView] 🔀 Default route, redirecting to current session:',
            { cacheCurrentChatId, cacheCurrentChatSessionId },
          );
          navigate(`/agent/chat/${cacheCurrentChatId}/${cacheCurrentChatSessionId}`, {
            replace: true,
          });
        }
      }
    };

    syncRoute();
  }, [routeChatId, routeSessionId, currentChatSessionId, navigate]);

  // Minimal mode state for chat popup - now obtained from LayoutProvider
  const { isMinimalMode, setMinimalMode } = useLayout();
  const [originalWindowSize, setOriginalWindowSize] = useState<{
    width: number;
    height: number;
  } | null>(null);

  // Workspace explorer sidepane state
  const [isWorkspaceExplorerVisible, setIsWorkspaceExplorerVisible] =
    useState(false);

  // Context Menu state
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuOptions, setContextMenuOptions] = useState<ContextOption[]>(
    [],
  );
  const [selectedMenuIndex, setSelectedMenuIndex] = useState(0);
  const [menuPosition, setMenuPosition] = useState({
    top: 0,
    left: 0,
    width: 0,
  });
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // 🆕 Track current trigger type (@ or #)
  const [currentTriggerType, setCurrentTriggerType] = useState<ContextMenuTriggerType | null>(null);

  // 🔥 Fix: Use new hook to subscribe to batch approval request changes
  const currentSessionId = useCurrentChatSessionId();
  const batchApprovalRequests = usePendingApprovalRequests();
  
  // 🔥 New: Use useErrorMessage hook to subscribe to error message changes
  const errorMessage = useErrorMessage();

  // Keep batchRequestId for tracking current batch (extracted from first request)
  const batchRequestId = useMemo(() => {
    if (batchApprovalRequests.length === 0) return null;
    // Extract batchRequestId from requestId (format: batch_approval_TIMESTAMP_RANDOM_toolCallId_path)
    const firstRequestId = batchApprovalRequests[0].requestId;
    const parts = firstRequestId.split('_');
    if (parts.length >= 4) {
      // batch_approval_TIMESTAMP_RANDOM
      return parts.slice(0, 4).join('_');
    }
    return null;
  }, [batchApprovalRequests]);

  // Chat Status state management
  const [chatStatus, setChatStatus] = useState<{
    chatId: string;
    chatStatus:
      | 'idle'
      | 'sending_response'
      | 'compressing_context'
      | 'compressed_context'
      | 'received_response';
    agentName?: string;
  } | null>(null);

  // 🔥 Agent action handling - now triggers events, handled by ContentContainer
  const handleNewAgent = useCallback(() => {
    window.dispatchEvent(new CustomEvent('agent:newAgent'));
  }, []);

  const handleEditAgent = useCallback(
    (chatId: string, initialTab?: 'basic' | 'mcp' | 'prompt' | 'skills') => {
      window.dispatchEvent(
        new CustomEvent('agent:editAgent', {
          detail: { chatId, initialTab },
        }),
      );
    },
    [],
  );

  const { chats } = useProfileData();
  const { deleteChat } = useChats();
  const { showSuccess, showError } = useToast();
  const { agent: currentAgent } = useAgentConfig();

  const currentChat = currentChatId
    ? profileDataManager.getCurrentChat()
    : null;

  // Get current workspace path
  const workspacePath = currentChat?.agent?.workspace || '';

  // Get current Agent's Zero States configuration
  const baseZeroStates = currentAgent?.zero_states;

  // Track current chat session's target binding (research workspace). When
  // a target is bound, swap the agent-level zero_states for target-aware
  // quick_starts so the new-chat experience speaks to "this company".
  const [sessionTarget, setSessionTarget] = useState<{
    targetCode: string | null;
    targetName: string | null;
  } | null>(null);

  useEffect(() => {
    if (!currentChatSessionId) {
      setSessionTarget(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await window.electronAPI.agentChat.getCurrentChatSession();
        if (cancelled) return;
        const sess: any = res?.data;
        if (!sess || !sess.targetCode) {
          setSessionTarget(null);
          return;
        }
        // Parse target name from targetDir basename (pattern: `${name}_${code}`).
        const td = typeof sess.targetDir === 'string' ? sess.targetDir : '';
        const sepIdx = Math.max(td.lastIndexOf('/'), td.lastIndexOf('\\'));
        const baseName = sepIdx >= 0 ? td.slice(sepIdx + 1) : td;
        const lastUnderscore = baseName.lastIndexOf('_');
        const name = lastUnderscore > 0 ? baseName.slice(0, lastUnderscore) : baseName;
        setSessionTarget({ targetCode: sess.targetCode, targetName: name || null });
      } catch {
        if (!cancelled) setSessionTarget(null);
      }
    })();
    return () => { cancelled = true; };
  }, [currentChatSessionId]);

  const zeroStates = useMemo(() => {
    if (!sessionTarget?.targetCode) return baseZeroStates;
    // For unlisted targets, postProcessForPortfolioInitTarget stores
    // `targetCode === name` so the chat session retains a non-empty code.
    // Avoid rendering `"我的私募基金 我的私募基金"` by collapsing the label.
    const isUnlisted = !!sessionTarget.targetName
      && sessionTarget.targetName === sessionTarget.targetCode;
    const label = isUnlisted
      ? (sessionTarget.targetName as string)
      : (sessionTarget.targetName
          ? `${sessionTarget.targetCode} ${sessionTarget.targetName}`
          : sessionTarget.targetCode);
    return {
      greeting: baseZeroStates?.greeting || '',
      quick_starts: [
        {
          title: '深度分析',
          description: '全面基本面分析',
          prompt: `请对 ${label} 做一份深度基本面分析报告（公司概况、业务结构、财务、估值、风险）。`,
        },
        {
          title: '财报点评',
          description: '解读最新财报',
          prompt: `请点评 ${label} 最新一期财报，重点关注收入结构、利润率与现金流变化。`,
        },
        {
          title: '边际跟踪',
          description: '跟踪关键变化',
          prompt: `请跟踪 ${label} 的最新边际变化（业绩、行业、估值），整理到 tracking.md。`,
        },
        {
          title: '同业对比',
          description: '同业横向比较',
          prompt: `请为 ${label} 选 4 家可比公司，对比关键财务和估值指标。`,
        },
      ],
    };
  }, [baseZeroStates, sessionTarget]);

  // MCP Tools handler - must be defined after currentChatId
  const handleOpenMcpTools = useCallback(() => {
    if (currentChatId) {
      handleEditAgent(currentChatId, 'mcp');
    }
  }, [currentChatId, handleEditAgent]);

  // Skills handler - open editor and navigate to Skills tab
  const handleOpenSkills = useCallback(() => {
    if (currentChatId) {
      handleEditAgent(currentChatId, 'skills');
    }
  }, [currentChatId, handleEditAgent]);

  // System Prompt handler - open editor and navigate to System Prompt tab
  const handleSystemPromptClick = useCallback(() => {
    if (currentChatId) {
      handleEditAgent(currentChatId, 'prompt');
    }
  }, [currentChatId, handleEditAgent]);

  // Delete action now triggers via event, handled by AppLayout's confirmation dialog

  // Handle fork chat session - using new backend IPC API
  const handleForkChatSession = useCallback(
    async (sessionId: string) => {
      if (!currentChatId) {
        showError('No current agent chat available');
        return;
      }

      try {
        // Call backend forkChatSession API
        // Backend will:
        // 1. Generate new targetChatSessionId
        // 2. Copy ChatSession data (files and index) via chatSessionManager
        // 3. Switch to new ChatSession (auto-create AgentChat instance and notify frontend)
        if (!window.electronAPI?.agentChat?.forkChatSession) {
          showError('Fork API not available');
          return;
        }

        const result = await window.electronAPI.agentChat.forkChatSession(
          currentChatId,
          sessionId,
        );

        if (!result.success) {
          showError(`Failed to fork session: ${result.error}`);
          return;
        }

        console.log('[ChatView] ✅ Fork ChatSession completed:', {
          chatId: currentChatId,
          sourceChatSessionId: sessionId,
          newChatSessionId: result.chatSessionId,
        });

        showSuccess('Session forked successfully, switched to new session');
      } catch (error) {
        showError(
          `Failed to fork session: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
        );
      }
    },
    [currentChatId, showSuccess, showError],
  );

  // Handle minimal mode toggle
  const handleToggleMinimalMode = useCallback(async () => {
    try {
      if (!isMinimalMode) {
        // Entering minimal mode

        // Store current window size and constraints
        if (window.electronAPI?.window?.getSize) {
          const currentSize = await window.electronAPI.window.getSize();
          setOriginalWindowSize(currentSize);
        }

        // Set minimal mode constraints
        // Minimal mode: min width 400, min height 600; max width 800, max height unlimited
        if (window.electronAPI?.window?.setMinSize) {
          await window.electronAPI.window.setMinSize(400, 600);
        }
        if (window.electronAPI?.window?.setMaxSize) {
          await window.electronAPI.window.setMaxSize(800, 0); // 0 means no height limit
        }

        // Set minimal mode default size: width 600, height 800
        if (window.electronAPI?.window?.setSize) {
          await window.electronAPI.window.setSize(600, 800);
        }

        setMinimalMode(true);
      } else {
        // Exiting minimal mode

        // Restore normal mode constraints
        // Normal mode: keep existing settings minWidth: 800, minHeight: 600, no max limits
        if (window.electronAPI?.window?.setMinSize) {
          await window.electronAPI.window.setMinSize(800, 600);
        }
        if (window.electronAPI?.window?.setMaxSize) {
          await window.electronAPI.window.setMaxSize(0, 0); // 0 means no limit
        }

        // Restore original size or default
        if (window.electronAPI?.window?.setSize) {
          if (originalWindowSize) {
            await window.electronAPI.window.setSize(
              originalWindowSize.width,
              originalWindowSize.height,
            );
          } else {
            // Fallback to default size if original size is not available
            await window.electronAPI.window.setSize(1200, 800);
          }
        }

        setMinimalMode(false);
        setOriginalWindowSize(null);
      }
    } catch (error) {
      showError('Failed to resize window');
    }
  }, [isMinimalMode, originalWindowSize, showError, setMinimalMode]);

  // Handle workspace explorer toggle
  const handleToggleWorkspaceExplorer = useCallback(() => {
    setIsWorkspaceExplorerVisible((prev) => !prev);
  }, []);

  // Handle session selection
  const handleSessionSelect = useCallback(
    async (sessionId: string) => {
      try {
        // 🔥 Fix: No longer validate or fetch session data upfront
        // Directly call backend to switch, let backend handle all validation and data loading

        // Step 1: Backend switches first
        if (
          window.electronAPI?.agentChat?.switchToChatSession &&
          currentChatId
        ) {
          console.log('[ChatView] 🔄 Backend switching to ChatSession:', {
            currentChatId,
            sessionId,
          });

          // Backend switch will:
          // 1. Validate session existence
          // 2. Update currentInstance and currentChatSessionId
          // 3. Proactively push initial Chat Status to frontend
          await window.electronAPI.agentChat.switchToChatSession(
            currentChatId,
            sessionId,
          );

          console.log('[ChatView] ✅ Backend switched successfully');

          // Step 2: Frontend switches
          // AgentPage's syncWithAgentChatManager auto-triggers via currentChatSessionId change
          // It will fetch Display Messages from backend and update UI
          // chatStatus auto-updates via backend-pushed IPC events
        } else {
          showError('Unable to switch chat session: IPC method not available');
        }
      } catch (error) {
        showError('Failed to switch chat session');
      }
    },
    [showError, currentChatId],
  );

  // Handle workspace explorer close
  const handleWorkspaceExplorerClose = useCallback(() => {
    setIsWorkspaceExplorerVisible(false);
  }, []);

  // Context Menu handlers
  const handleContextMenuTrigger = useCallback(
    async (query: string, inputRect: DOMRect, triggerType?: ContextMenuTriggerType) => {
      setShowContextMenu(true);
      setCurrentTriggerType(triggerType || ContextMenuTriggerType.Workspace);

      // Calculate menu position: aligned with ChatInput, 2px above it
      const position = {
        top: inputRect.top - 2, // 2px above ChatInput
        left: inputRect.left,
        width: inputRect.width,
      };
      setMenuPosition(position);

      // Debounced search
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }

      searchTimeoutRef.current = setTimeout(async () => {
        try {
          // 🆕 Determine search logic based on trigger type
          if (triggerType === ContextMenuTriggerType.Skill) {
            // # trigger: search Skills
            const skills = profileDataManager.getCurrentAgentSkills();
            let options: ContextOption[];
            
            if (skills.length === 0) {
              // No available Skills
              options = [{
                type: ContextMenuOptionType.NoResults,
                fileName: 'No skills available for this agent',
                description: 'Add skills in Agent Settings',
              }];
            } else {
              // Filter skills by query
              options = filterSkillsByQuery(skills, query);
              
              if (options.length === 0 && query.trim().length > 0) {
                // 🆕 No matching results after filtering, show hint message
                options = [{
                  type: ContextMenuOptionType.NoResults,
                  fileName: `No skills matching "${query}"`,
                  description: `${skills.length} skills available`,
                }];
              } else if (options.length === 0) {
                // No search term, show all skills
                options = skills.map((skill: { name: string; description?: string }) => ({
                  type: ContextMenuOptionType.Skill,
                  fileName: skill.name,
                  description: skill.description || '',
                  value: skill.name,
                }));
              }
            }
            
            setContextMenuOptions(options);
            setSelectedMenuIndex(0);
          } else {
            // @ trigger: search Knowledge Base and Chat Session Files
            const { profileDataManager } = await import('../../lib/userData');
            const currentChatConfig: any = profileDataManager.getCurrentChat?.();
            const knowledgeBasePath = currentChatConfig?.agent?.knowledgeBase;
            const workspacePath = currentChatConfig?.agent?.workspace;
            
            // Calculate chat session files path
            let chatSessionFilesPath = '';
            if (workspacePath && typeof workspacePath === 'string' && workspacePath.trim().length > 0) {
              const chatSessionId = agentChatSessionCacheManager.getCurrentChatSessionId?.();
              if (chatSessionId) {
                const match = chatSessionId.match(/^chatSession_(\d{4})(\d{2})/);
                if (match) {
                  const yearMonth = `${match[1]}${match[2]}`;
                  chatSessionFilesPath = `${workspacePath}/${yearMonth}/${chatSessionId}`;
                }
              }
            }

            const hasKnowledgeBase = knowledgeBasePath && typeof knowledgeBasePath === 'string' && knowledgeBasePath.trim().length > 0;
            const hasChatSession = chatSessionFilesPath.length > 0;

            if (query.trim().length > 0) {
              // 🆕 Has search term: search Knowledge Base and Chat Session Files simultaneously
              const searchPromises: Promise<{results: any[], source: MentionSourceType}>[] = [];
              
              if (hasKnowledgeBase) {
                searchPromises.push(
                  searchWorkspaceFiles({
                    folder: knowledgeBasePath,
                    pattern: query,
                    maxResults: 10,
                    fuzzy: true,
                    searchTarget: 'files',
                  }).then(res => ({ results: res.results, source: MentionSourceType.KnowledgeBase }))
                );
              }
              
              if (hasChatSession) {
                searchPromises.push(
                  searchWorkspaceFiles({
                    folder: chatSessionFilesPath,
                    pattern: query,
                    maxResults: 10,
                    fuzzy: true,
                    searchTarget: 'files',
                  }).then(res => ({ results: res.results, source: MentionSourceType.ChatSession }))
                );
              }

              let options: ContextOption[] = [];

              if (searchPromises.length > 0) {
                const searchResults = await Promise.all(searchPromises);
                
                for (const { results, source } of searchResults) {
                  for (const r of results) {
                    const pathParts = r.path.split(/[\\/]/);
                    const fileName = pathParts[pathParts.length - 1];
                    const mentionPrefix = source === MentionSourceType.KnowledgeBase ? '@knowledge-base:' : '@chat-session:';
                    const optionType = source === MentionSourceType.KnowledgeBase 
                      ? ContextMenuOptionType.KnowledgeBase 
                      : ContextMenuOptionType.ChatSession;
                    
                    options.push({
                      type: optionType,
                      relativePath: `${mentionPrefix}/${r.path}`,
                      fileName: fileName,
                      description: `${source === MentionSourceType.KnowledgeBase ? '[Knowledge] ' : '[Session] '}${r.path}`,
                      value: `${mentionPrefix}/${r.path}`,
                    });
                  }
                }
              }

              if (options.length === 0) {
                options = [{
                  type: ContextMenuOptionType.NoResults,
                  fileName: `No files matching "${query}"`,
                  description: 'Try a different search term',
                }];
              }

              setContextMenuOptions(options);
              setSelectedMenuIndex(0);
            } else {
              // No search term (just typed @), show default options
              const options = getDefaultMenuOptions();
              setContextMenuOptions(options);
              setSelectedMenuIndex(0);
            }
          }
        } catch (error) {
          // Search failed, also show default options
          if (triggerType === ContextMenuTriggerType.Skill) {
            setContextMenuOptions([{
              type: ContextMenuOptionType.NoResults,
              fileName: 'Failed to load skills',
              description: '',
            }]);
          } else {
            setContextMenuOptions(getDefaultMenuOptions());
          }
          setSelectedMenuIndex(0);
        }
      }, 200);
    },
    [],
  );

  const handleContextMenuClose = useCallback(() => {
    setShowContextMenu(false);
    setContextMenuOptions([]);
    setSelectedMenuIndex(0);
    setCurrentTriggerType(null);
  }, []);

  const handleContextMenuSelect = useCallback(
    async (option: ContextOption) => {
      // 🆕 If a NoResults type option is selected, do nothing (just informational)
      if (option.type === ContextMenuOptionType.NoResults) {
        // Close menu
        handleContextMenuClose();
        return;
      }
      
      // If default option (no value), expand corresponding source file list
      if (!option.value && !option.relativePath) {
        if (option.type === ContextMenuOptionType.KnowledgeBase) {
          // 🆕 Add Knowledge File: list all files in Knowledge Base directory
          try {
            const { profileDataManager } = await import('../../lib/userData');
            const currentChatConfig: any = profileDataManager.getCurrentChat?.();
            const knowledgeBasePath = currentChatConfig?.agent?.knowledgeBase;

            if (!knowledgeBasePath || typeof knowledgeBasePath !== 'string' || knowledgeBasePath.trim().length === 0) {
              setContextMenuOptions([{
                type: ContextMenuOptionType.NoResults,
                fileName: 'Knowledge Base path not set',
                description: 'Please configure Knowledge Base in Agent Settings first',
              }]);
              setSelectedMenuIndex(0);
              return;
            }

            const searchResult = await searchWorkspaceFiles({
              folder: knowledgeBasePath,
              pattern: undefined,
              maxResults: 100,
              fuzzy: false,
              searchTarget: 'files',
            });
            const results = searchResult.results;

            if (results.length === 0) {
              setContextMenuOptions([{
                type: ContextMenuOptionType.NoResults,
                fileName: 'No files found',
                description: 'No files found in Knowledge Base',
              }]);
              setSelectedMenuIndex(0);
              return;
            }

            const fileOptions: ContextOption[] = results.map((r) => {
              const pathParts = r.path.split(/[\\/]/);
              const fileName = pathParts[pathParts.length - 1];
              return {
                type: ContextMenuOptionType.KnowledgeBase,
                relativePath: `@knowledge-base:/${r.path}`,
                fileName: fileName,
                description: `[Knowledge] ${r.path}`,
                value: `@knowledge-base:/${r.path}`,
              };
            });

            setContextMenuOptions(fileOptions);
            setSelectedMenuIndex(0);
          } catch (error) {
            setContextMenuOptions([{
              type: ContextMenuOptionType.NoResults,
              fileName: 'Failed to load Knowledge Base files',
              description: 'An error occurred while loading files',
            }]);
            setSelectedMenuIndex(0);
          }
        } else if (option.type === ContextMenuOptionType.ChatSession) {
          // 🆕 Add Chat Session File: list all files in current Chat Session directory
          try {
            const { profileDataManager } = await import('../../lib/userData');
            const currentChatConfig: any = profileDataManager.getCurrentChat?.();
            const workspacePath = currentChatConfig?.agent?.workspace;

            if (!workspacePath || typeof workspacePath !== 'string' || workspacePath.trim().length === 0) {
              setContextMenuOptions([{
                type: ContextMenuOptionType.NoResults,
                fileName: 'Workspace path not set',
                description: 'Please select a workspace in Workspace Explorer first',
              }]);
              setSelectedMenuIndex(0);
              return;
            }

            // Calculate chat session files path
            const chatSessionId = agentChatSessionCacheManager.getCurrentChatSessionId?.();
            if (!chatSessionId) {
              setContextMenuOptions([{
                type: ContextMenuOptionType.NoResults,
                fileName: 'No active chat session',
                description: 'Please start a chat session first',
              }]);
              setSelectedMenuIndex(0);
              return;
            }

            const match = chatSessionId.match(/^chatSession_(\d{4})(\d{2})/);
            if (!match) {
              setContextMenuOptions([{
                type: ContextMenuOptionType.NoResults,
                fileName: 'Invalid chat session ID',
                description: 'Unable to determine chat session files path',
              }]);
              setSelectedMenuIndex(0);
              return;
            }

            const yearMonth = `${match[1]}${match[2]}`;
            const chatSessionFilesPath = `${workspacePath}/${yearMonth}/${chatSessionId}`;

            const searchResult = await searchWorkspaceFiles({
              folder: chatSessionFilesPath,
              pattern: undefined,
              maxResults: 100,
              fuzzy: false,
              searchTarget: 'files',
            });
            const results = searchResult.results;

            if (results.length === 0) {
              setContextMenuOptions([{
                type: ContextMenuOptionType.NoResults,
                fileName: 'No files found',
                description: 'No files found in current chat session',
              }]);
              setSelectedMenuIndex(0);
              return;
            }

            const fileOptions: ContextOption[] = results.map((r) => {
              const pathParts = r.path.split(/[\\/]/);
              const fileName = pathParts[pathParts.length - 1];
              return {
                type: ContextMenuOptionType.ChatSession,
                relativePath: `@chat-session:/${r.path}`,
                fileName: fileName,
                description: `[Session] ${r.path}`,
                value: `@chat-session:/${r.path}`,
              };
            });

            setContextMenuOptions(fileOptions);
            setSelectedMenuIndex(0);
          } catch (error) {
            setContextMenuOptions([{
              type: ContextMenuOptionType.NoResults,
              fileName: 'Failed to load Chat Session files',
              description: 'An error occurred while loading files',
            }]);
            setSelectedMenuIndex(0);
          }
        }
      } else {
        // Option with actual value, trigger corresponding event based on type for ChatInput to handle insertion
        if (option.type === ContextMenuOptionType.Skill) {
          // 🆕 Skill option: trigger skill mention event
          window.dispatchEvent(
            new CustomEvent('context:skillMentionSelect', {
              detail: { skillName: option.value },
            }),
          );
        } else {
          // KnowledgeBase/ChatSession/File/Folder option: trigger mention event
          window.dispatchEvent(
            new CustomEvent('context:mentionSelect', {
              detail: { option },
            }),
          );
        }
        // Close menu
        handleContextMenuClose();
      }
    },
    [handleContextMenuClose],
  );

  const handleContextMenuNavigate = useCallback(
    (direction: 'up' | 'down') => {
      const len = contextMenuOptions.length;
      if (len === 0) return;
      setSelectedMenuIndex((prev) => {
        if (direction === 'up') {
          return (prev - 1 + len) % len;
        } else {
          return (prev + 1) % len;
        }
      });
    },
    [contextMenuOptions.length],
  );

  const handleContextMenuHover = useCallback((index: number) => {
    setSelectedMenuIndex(index);
  }, []);

  // Listen for keyboard selection events
  useEffect(() => {
    const handleKeyboardSelectEvent = (e: CustomEvent) => {
      const { option } = e.detail;
      handleContextMenuSelect(option);
    };

    window.addEventListener(
      'context:keyboardSelect',
      handleKeyboardSelectEvent as EventListener,
    );
    return () => {
      window.removeEventListener(
        'context:keyboardSelect',
        handleKeyboardSelectEvent as EventListener,
      );
    };
  }, [handleContextMenuSelect]);

  // 🔥 New: listen for chatSession:fork event
  useEffect(() => {
    const handleForkChatSessionEvent = (e: CustomEvent) => {
      const { sessionId } = e.detail;
      if (sessionId) {
        handleForkChatSession(sessionId);
      }
    };

    window.addEventListener(
      'chatSession:fork',
      handleForkChatSessionEvent as EventListener,
    );
    return () => {
      window.removeEventListener(
        'chatSession:fork',
        handleForkChatSessionEvent as EventListener,
      );
    };
  }, [handleForkChatSession]);

  // 🔥 New: listen for workspace:openExplorer event (for auto-opening Workspace after FRE completion)
  useEffect(() => {
    const handleOpenWorkspaceExplorer = () => {
      console.log('[ChatView] 📂 Opening Workspace Explorer via event');
      setIsWorkspaceExplorerVisible(true);
    };

    window.addEventListener(
      'workspace:openExplorer',
      handleOpenWorkspaceExplorer as EventListener,
    );
    return () => {
      window.removeEventListener(
        'workspace:openExplorer',
        handleOpenWorkspaceExplorer as EventListener,
      );
    };
  }, []);

  // 🔥 Removed: No longer need to directly listen to IPC events, since AgentChatSessionCacheManager handles them
  // Batch approval requests are now obtained via useCurrentChatSessionCache()

  // 🔥 Modified: Listen for Chat Status events - add chatSessionId filtering
  useEffect(() => {
    const handleChatStatusChanged = (data: any) => {
      const { chatId, chatSessionId, chatStatus, agentName, timestamp } = data;

      // 🔥 Second layer of protection: check if chatSessionId matches current active session
      const getCurrentChatSessionId = async () => {
        try {
          const { agentChatSessionCacheManager } = await import(
            '../../lib/chat/agentChatSessionCacheManager'
          );
          return agentChatSessionCacheManager.getCurrentChatSessionId();
        } catch (error) {
          console.error(
            '[ChatView] Failed to get current chatSessionId:',
            error,
          );
          return null;
        }
      };

      getCurrentChatSessionId().then((currentSessionId) => {
        if (!currentSessionId || chatSessionId !== currentSessionId) {
          console.debug(
            '[ChatView] 🚫 Skipping chat status change - chatSessionId mismatch',
            {
              eventSessionId: chatSessionId,
              currentSessionId,
              chatStatus,
              currentChatId,
            },
          );
          return;
        }

        // chatSessionId matches, process status change
        console.log('[ChatView] ✅ Processing chat status change', {
          chatId,
          chatSessionId,
          chatStatus,
          agentName,
        });

        // Set Chat Status state
        setChatStatus({
          chatId,
          chatStatus,
          agentName,
        });

        // 🔥 Fix: Don't auto-reset to idle when receiving received_response
        // Let backend fully control state transitions, only send idle when conversation truly ends
        // Remove auto-reset logic to avoid interfering with post-tool-execution state flow
      });
    };

    // Listen for Chat Status change events from main process
    if (window.electronAPI?.agentChat?.onChatStatusChanged) {
      const unsubscribe = window.electronAPI.agentChat.onChatStatusChanged(
        handleChatStatusChanged,
      );

      return () => {
        unsubscribe();
      };
    } else {
    }
  }, [currentChatId]);

  // 🔥 Fix: Listen for currentChatId and currentChatSessionId changes, proactively fetch Chat Status
  useEffect(() => {
    // When Agent or Session switches, proactively fetch Chat Status from backend
    if (currentChatId && currentChatSessionId) {
      console.log('[ChatView] 🔄 Fetching Chat Status after switch:', {
        currentChatId,
        currentChatSessionId,
      });

      // Proactively call backend to get Chat Status
      const fetchChatStatus = async () => {
        try {
          if (window.electronAPI?.agentChat?.getChatStatusInfo) {
            const result =
              await window.electronAPI.agentChat.getChatStatusInfo();
            if (result.success && result.data) {
              console.log(
                '[ChatView] ✅ Got Chat Status from backend:',
                result.data,
              );
              setChatStatus({
                chatId: result.data.chatId,
                chatStatus: result.data.chatStatus as any,
                agentName: result.data.agentName,
              });
            }
          }
        } catch (error) {
          console.error('[ChatView] ❌ Failed to fetch Chat Status:', error);
        }
      };

      fetchChatStatus();
    } else if (currentChatId) {
      // If only chatId without sessionId, reset state
      console.log(
        '[ChatView] 🔄 Agent changed but no session yet, resetting chatStatus',
      );
      setChatStatus(null);
    }
  }, [currentChatId, currentChatSessionId]);

  // 🔥 Modified: Handle individual approval request responses - no longer manually manage state
  const handleApprove = useCallback(
    async (requestId: string) => {
      if (!batchRequestId) return;

      // Find the corresponding request from the request list
      const request = batchApprovalRequests.find(
        (r) => r.requestId === requestId,
      );
      if (!request) {
        return;
      }

      try {
        // 🔥 Modified: Send approval response to main process (no longer needs path parameter)
        await window.electronAPI.agentChat.sendBatchApprovalResponse({
          batchRequestId,
          requestId: request.requestId,
          toolCallId: request.toolCallId,
          approved: true,
        });

        // 🔥 No longer manually update state - backend updates AgentChatSessionCacheManager via IPC
        // When backend finishes processing approval, it updates cache.pendingApprovalRequests
        // useCurrentChatSessionCache() automatically gets the latest state
      } catch (error) {
        console.error('[ChatView] Failed to approve request:', error);
      }
    },
    [batchRequestId, batchApprovalRequests],
  );

  const handleReject = useCallback(
    async (requestId: string) => {
      if (!batchRequestId) return;

      // Find the corresponding request from the request list
      const request = batchApprovalRequests.find(
        (r) => r.requestId === requestId,
      );
      if (!request) {
        return;
      }

      try {
        // 🔥 Modified: Send reject response to main process (no longer needs path parameter)
        await window.electronAPI.agentChat.sendBatchApprovalResponse({
          batchRequestId,
          requestId: request.requestId,
          toolCallId: request.toolCallId,
          approved: false,
        });

        // 🔥 No longer manually update state - backend updates AgentChatSessionCacheManager via IPC
      } catch (error) {
        console.error('[ChatView] Failed to reject request:', error);
      }
    },
    [batchRequestId, batchApprovalRequests],
  );

  // 🔥 Modified: Handle timeout auto-reject of unanswered requests - no longer manually manage state
  const handleTimeoutAutoReject = useCallback(
    async (requestIds: string[]) => {
      if (!batchRequestId) return;

      // Send reject response to backend for each unanswered request
      for (const requestId of requestIds) {
        const request = batchApprovalRequests.find(
          (r) => r.requestId === requestId,
        );
        if (!request) {
          continue;
        }

        try {
          // 🔥 Modified: Send reject response to main process (no longer needs path parameter)
          await window.electronAPI.agentChat.sendBatchApprovalResponse({
            batchRequestId,
            requestId: request.requestId,
            toolCallId: request.toolCallId,
            approved: false,
          });
        } catch (error) {
          console.error('[ChatView] Failed to auto-reject request:', error);
        }
      }

      // 🔥 No longer manually clear state - backend updates AgentChatSessionCacheManager via IPC
    },
    [batchRequestId, batchApprovalRequests],
  );

  // 🔥 New: Handle ErrorBar's Retry button click
  const handleRetry = useCallback(
    async (chatSessionId: string) => {
      console.log('[ChatView] 🔄 Retrying chat...', { chatSessionId });
      
      // Clear error message first, so ErrorBar disappears
      agentChatSessionCacheManager.clearErrorMessage(chatSessionId);
      
      try {
        // Call backend retry
        const result = await window.electronAPI.agentChat.retryChat(chatSessionId);
        
        // 🔥 Check the success field of the return result
        if (!result.success) {
          console.error('[ChatView] ❌ Retry failed:', result.error);
          // If retry failed, set error message again
          agentChatSessionCacheManager.setErrorMessage(chatSessionId, result.error || 'Retry failed');
          return;
        }
        
        console.log('[ChatView] ✅ Retry completed successfully');
      } catch (error) {
        console.error('[ChatView] ❌ Retry failed with exception:', error);
        // If retry fails, re-set the error message
        const retryErrorMessage = error instanceof Error ? error.message : String(error);
        agentChatSessionCacheManager.setErrorMessage(chatSessionId, retryErrorMessage);
      }
    },
    [],
  );

  return (
    <div className={`chat-view ${isMinimalMode ? 'minimal-mode' : ''}${mode === 'compact' ? ' chat-view--compact' : ''}`}>
      <div className="chat-view-layout">
        {/* Chat Area */}
        <div className="chat-area">
          {mode !== 'compact' && (
            <ChatViewHeader
              agentChat={null}
              onToggleMinimalMode={handleToggleMinimalMode}
              onToggleWorkspaceExplorer={handleToggleWorkspaceExplorer}
              isWorkspaceExplorerVisible={isWorkspaceExplorerVisible}
              onOpenMcpTools={handleOpenMcpTools}
              onOpenSkills={handleOpenSkills}
              currentChatSessionId={currentChatSessionId}
            />
          )}
          <ChatViewContent
            messages={messages}
            allMessages={allMessages}
            streamingMessageId={streamingMessageId}
            onSystemPromptClick={handleSystemPromptClick}
            onSendMessage={onSendMessage}
            onCancelChat={onCancelChat}
            onOpenMcpTools={handleOpenMcpTools}
            onContextMenuTrigger={handleContextMenuTrigger}
            onContextMenuClose={handleContextMenuClose}
            contextMenuState={{
              isOpen: showContextMenu,
              options: contextMenuOptions,
              selectedIndex: selectedMenuIndex,
            }}
            onContextMenuNavigate={handleContextMenuNavigate}
            batchApprovalRequests={batchApprovalRequests}
            onApproveRequest={handleApprove}
            onRejectRequest={handleReject}
            onTimeoutAutoReject={handleTimeoutAutoReject}
            errorMessage={errorMessage}
            chatSessionId={currentSessionId}
            onRetry={handleRetry}
            chatStatus={chatStatus}
            zeroStates={zeroStates}
            agentName={currentAgent?.name}
            workspacePath={workspacePath}
            isWorkspaceExplorerVisible={isWorkspaceExplorerVisible}
            onWorkspaceExplorerClose={handleWorkspaceExplorerClose}
            onWorkspaceMenuToggle={onWorkspaceMenuToggle}
            workspaceMenuState={workspaceMenuState}
            onEditAgentMenuToggle={onEditAgentMenuToggle}
            onAttachMenuToggle={onAttachMenuToggle}
            onFileTreeNodeMenuToggle={onFileTreeNodeMenuToggle}
          />
        </div>
      </div>

      {/* Context Menu - rendered at the ChatView level */}
      {showContextMenu && (
        <ContextMenu
          options={contextMenuOptions}
          selectedIndex={selectedMenuIndex}
          onSelect={handleContextMenuSelect}
          onClose={handleContextMenuClose}
          onHover={handleContextMenuHover}
          position={menuPosition}
        />
      )}

      {/* Compact-mode local Edit Agent / Attach menus (used when embedded
          outside AppLayout, e.g. in the Research workspace). */}
      {mode === 'compact' && compactEditAgentMenu.isOpen && compactEditAgentMenu.position && (
        <EditAgentMenuDropdown
          editAgentMenuRef={compactEditAgentMenuRef}
          position={compactEditAgentMenu.position}
          onClose={handleCompactEditAgentClose}
        />
      )}
      {mode === 'compact' && compactAttachMenu.isOpen && compactAttachMenu.position && (
        <AttachMenuDropdown
          attachMenuRef={compactAttachMenuRef}
          position={compactAttachMenu.position}
          onClose={handleCompactAttachClose}
        />
      )}
    </div>
  );
});

ChatView.displayName = 'ChatView';

export default ChatView;
