// @ts-nocheck
const sharedMockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../unifiedLogger', () => ({
  createLogger: vi.fn(() => sharedMockLogger),
  createConsoleLogger: vi.fn(() => sharedMockLogger),
  getUnifiedLogger: vi.fn(() => sharedMockLogger),
  createHighPerformanceLogger: vi.fn(() => sharedMockLogger),
  createDebugLogger: vi.fn(() => sharedMockLogger),
  getRefactoredLogger: vi.fn(() => sharedMockLogger),
  getGlobalLogger: vi.fn(() => sharedMockLogger),
  initializeGlobalLogger: vi.fn(() => sharedMockLogger),
  resetGlobalLogger: vi.fn(),
  isGlobalLoggerInitialized: vi.fn(() => false),
  default: vi.fn(() => sharedMockLogger),
}));

// Mock registry
const mockRegistry = vi.hoisted(() => ({
  hasInstance: vi.fn(() => false),
  getInstance: vi.fn(() => null),
  getRuntimeMode: vi.fn(() => null),
  getInstanceCount: vi.fn(() => 0),
  listCachedSessionIds: vi.fn(() => []),
  removeInstance: vi.fn(),
  registerInstance: vi.fn(),
  getOrCreateCancellationSource: vi.fn(),
  getCancellationSource: vi.fn(() => null),
  clearCancellationSource: vi.fn(),
}));

vi.mock('../agentChatManagerRegistry', () => ({
  AgentChatManagerRegistry: vi.fn(function () { return mockRegistry; }),
}));

// Mock session coordinator
const mockSessionCoordinator = vi.hoisted(() => ({
  getCurrentChatSessionId: vi.fn(() => null),
  getCurrentInstance: vi.fn(() => null),
  clearCurrentSession: vi.fn(),
  activateSession: vi.fn(),
  clearPendingUnreadForCurrentSession: vi.fn(),
  clearPendingUnread: vi.fn(),
  handleStatusChange: vi.fn(),
  getNewChatSessionId: vi.fn(() => null),
  getOrCreateNewChatSessionId: vi.fn((chatId: string, gen: () => string) => gen()),
  exitNewChatSession: vi.fn(() => ({ success: true })),
  ensureChatSessionDirectory: vi.fn().mockResolvedValue(undefined),
  forkChatSessionDirectory: vi.fn().mockResolvedValue('/some/dir'),
  isMainWindowForeground: vi.fn(() => true),
  getMainWindowState: vi.fn(() => 'foreground'),
}));

vi.mock('../agentChatManagerSessionCoordinator', () => ({
  AgentChatManagerSessionCoordinator: vi.fn(function () { return mockSessionCoordinator; }),
}));

// Mock notification bridge
const mockNotificationBridge = vi.hoisted(() => ({
  getMainWindow: vi.fn(() => null),
  getMainWindowState: vi.fn(() => ({ visible: true, focused: true })),
  emitChatStatusChanged: vi.fn(),
  startListening: vi.fn(),
}));

vi.mock('../agentChatManagerNotificationBridge', () => ({
  AgentChatManagerNotificationBridge: vi.fn(function () { return mockNotificationBridge; }),
}));

// Mock renderer bridge
const mockRendererBridge = vi.hoisted(() => ({
  notifyCurrentChatSessionIdChanged: vi.fn(),
  notifyChatSessionCacheCreated: vi.fn(),
  notifyChatSessionCacheDestroyed: vi.fn(),
  attachEventSenderToMainWindow: vi.fn(),
  setupContextChangeListener: vi.fn(),
}));

vi.mock('../agentChatManagerRendererBridge', () => ({
  AgentChatManagerRendererBridge: vi.fn(function () { return mockRendererBridge; }),
}));

// Mock scheduled runner
const mockScheduledRunner = vi.hoisted(() => ({
  run: vi.fn().mockResolvedValue({ success: true, messagesCount: 0 }),
}));

vi.mock('../agentChatManagerScheduledRunner', () => ({
  AgentChatManagerScheduledRunner: vi.fn(function () { return mockScheduledRunner; }),
}));

// Mock profileCacheManager
const mockProfileCacheManager = vi.hoisted(() => ({
  getChatConfig: vi.fn(() => null),
  getCachedProfile: vi.fn(() => null),
  getChatSessionsAsync: vi.fn().mockResolvedValue([]),
  getChatSessionFile: vi.fn().mockResolvedValue(null),
  deleteChatSession: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../userDataADO/profileCacheManager', () => ({
  profileCacheManager: mockProfileCacheManager,
}));

// Mock chatSessionStore
const mockChatSessionStore = vi.hoisted(() => ({
  copySession: vi.fn().mockResolvedValue(true),
  patchMetadata: vi.fn().mockResolvedValue(null),
  getSession: vi.fn(() => null),
  saveSession: vi.fn().mockResolvedValue(null),
}));

vi.mock('../chatSessionStore', () => ({
  chatSessionStore: mockChatSessionStore,
}));

// Mock pathUtils
vi.mock('../../userDataADO/pathUtils', () => ({
  generateChatSessionId: vi.fn(() => `session-${Date.now()}`),
  isValidChatSessionId: vi.fn(() => true),
  extractMonthFromChatSessionId: vi.fn(() => '2026-01'),
}));

// Mock interactiveRequestManager
const mockInteractiveRequestManager = vi.hoisted(() => ({
  clearSession: vi.fn(),
  interruptSession: vi.fn(() => null),
}));

vi.mock('../interactiveRequestManager', () => ({
  interactiveRequestManager: mockInteractiveRequestManager,
}));

// Mock BuiltinToolsManager
vi.mock('../../mcpRuntime/builtinTools/builtinToolsManager', () => ({
  BuiltinToolsManager: {
    clearDeferredToolsContext: vi.fn(),
  },
}));

// Mock CancellationTokenSource
vi.mock('../../cancellation', () => ({
  CancellationTokenSource: vi.fn(() => ({
    token: { isCancellationRequested: false },
    cancel: vi.fn(),
  })),
  CancellationError: class CancellationError extends Error {},
}));

vi.mock('../subAgent/subAgentManager', () => ({
  SubAgentManager: {
    getInstance: vi.fn(() => ({
      cancelByParentSession: vi.fn().mockResolvedValue(0),
    })),
  },
}));

import { AgentChatManager } from '../agentChatManager';

function createFreshManager(): AgentChatManager {
  (AgentChatManager as any).instance = undefined;
  return AgentChatManager.getInstance();
}

function makeMockAgentChat(overrides: Record<string, any> = {}) {
  return {
    getChatId: vi.fn(() => 'chat-1'),
    getChatStatus: vi.fn(() => 'idle'),
    getDisplayMessages: vi.fn(() => []),
    getContextTokenUsage: vi.fn(() => ({})),
    getPendingInteractiveRequest: vi.fn(() => null),
    getAgentInfo: vi.fn().mockResolvedValue({ name: 'TestAgent' }),
    getChatHistory: vi.fn(() => []),
    updateSessionTitle: vi.fn(() => true),
    destroy: vi.fn(),
    cancelPush: vi.fn(),
    invalidateActiveExecution: vi.fn(),
    cancelActiveToolExecution: vi.fn().mockResolvedValue(undefined),
    forceIdleStatus: vi.fn(),
    ...overrides,
  };
}

describe('AgentChatManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset all mock defaults
    mockRegistry.hasInstance.mockReturnValue(false);
    mockRegistry.getInstance.mockReturnValue(null);
    mockRegistry.getRuntimeMode.mockReturnValue(null);
    mockRegistry.getInstanceCount.mockReturnValue(0);
    mockRegistry.listCachedSessionIds.mockReturnValue([]);
    mockRegistry.getCancellationSource.mockReturnValue(null);
    mockSessionCoordinator.getCurrentChatSessionId.mockReturnValue(null);
    mockSessionCoordinator.getCurrentInstance.mockReturnValue(null);
    mockSessionCoordinator.getNewChatSessionId.mockReturnValue(null);
    mockSessionCoordinator.getOrCreateNewChatSessionId.mockImplementation(
      (_chatId: string, gen: () => string) => gen()
    );
    mockSessionCoordinator.exitNewChatSession.mockReturnValue({ success: true });
    mockSessionCoordinator.forkChatSessionDirectory.mockResolvedValue('/some/dir');
    mockChatSessionStore.copySession.mockResolvedValue(true);
    mockProfileCacheManager.getChatConfig.mockReturnValue(null);
    mockProfileCacheManager.getCachedProfile.mockReturnValue(null);
    mockProfileCacheManager.getChatSessionsAsync.mockResolvedValue([]);
    mockProfileCacheManager.getChatSessionFile.mockResolvedValue(null);
    mockProfileCacheManager.deleteChatSession.mockResolvedValue(true);
    mockScheduledRunner.run.mockResolvedValue({ success: true, messagesCount: 0 });
  });

  describe('getInstance', () => {
    it('returns the same singleton instance', () => {
      const a = AgentChatManager.getInstance();
      const b = AgentChatManager.getInstance();
      expect(a).toBe(b);
    });
  });

  describe('initialize', () => {
    it('sets currentUserAlias and isInitialized', async () => {
      const manager = createFreshManager();
      await manager.initialize('alice');
      // No errors thrown — state is internal, verified via subsequent method calls
      expect(sharedMockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Initialized for user'),
        'initialize',
        expect.objectContaining({ alias: 'alice' })
      );
    });

    it('is idempotent for same alias', async () => {
      const manager = createFreshManager();
      await manager.initialize('alice');
      await manager.initialize('alice');
      // Should only log once
      const logCalls = sharedMockLogger.info.mock.calls.filter(
        ([msg]: string[]) => msg.includes('Initialized for user')
      );
      expect(logCalls).toHaveLength(1);
    });

    it('re-initializes for different alias', async () => {
      const manager = createFreshManager();
      await manager.initialize('alice');
      await manager.initialize('bob');
      const logCalls = sharedMockLogger.info.mock.calls.filter(
        ([msg]: string[]) => msg.includes('Initialized for user')
      );
      expect(logCalls).toHaveLength(2);
    });
  });

  describe('getCacheStats', () => {
    it('returns zero stats when no instances', () => {
      const manager = createFreshManager();
      const stats = manager.getCacheStats();
      expect(stats.totalInstances).toBe(0);
      expect(stats.currentChatSessionId).toBeNull();
      expect(stats.cachedChatSessionIds).toEqual([]);
    });

    it('reflects registry state', () => {
      const manager = createFreshManager();
      mockRegistry.getInstanceCount.mockReturnValue(3);
      mockRegistry.listCachedSessionIds.mockReturnValue(['s1', 's2', 's3']);
      mockSessionCoordinator.getCurrentChatSessionId.mockReturnValue('s1');

      const stats = manager.getCacheStats();
      expect(stats.totalInstances).toBe(3);
      expect(stats.currentChatSessionId).toBe('s1');
      expect(stats.cachedChatSessionIds).toEqual(['s1', 's2', 's3']);
    });
  });

  describe('getCurrentInstance', () => {
    it('returns null when no current instance', () => {
      const manager = createFreshManager();
      expect(manager.getCurrentInstance()).toBeNull();
    });

    it('returns the current instance from session coordinator', () => {
      const manager = createFreshManager();
      const mockInstance = makeMockAgentChat();
      mockSessionCoordinator.getCurrentInstance.mockReturnValue(mockInstance);
      expect(manager.getCurrentInstance()).toBe(mockInstance);
    });
  });

  describe('getInstanceByChatSessionId', () => {
    it('returns null when not found', () => {
      const manager = createFreshManager();
      mockRegistry.getInstance.mockReturnValue(null);
      expect(manager.getInstanceByChatSessionId('unknown')).toBeNull();
    });

    it('returns the instance when found', () => {
      const manager = createFreshManager();
      const mockInstance = makeMockAgentChat();
      mockRegistry.getInstance.mockReturnValue(mockInstance);
      expect(manager.getInstanceByChatSessionId('session-1')).toBe(mockInstance);
    });
  });

  describe('getRuntimeMode', () => {
    it('returns null when no instance', () => {
      const manager = createFreshManager();
      mockRegistry.getRuntimeMode.mockReturnValue(null);
      expect(manager.getRuntimeMode('session-1')).toBeNull();
    });

    it('returns the runtime mode from registry', () => {
      const manager = createFreshManager();
      mockRegistry.getRuntimeMode.mockReturnValue('interactive');
      expect(manager.getRuntimeMode('session-1')).toBe('interactive');
    });
  });

  describe('getChatHistory', () => {
    it('returns empty array when no current instance', () => {
      const manager = createFreshManager();
      mockSessionCoordinator.getCurrentInstance.mockReturnValue(null);
      expect(manager.getChatHistory()).toEqual([]);
    });

    it('returns history from current instance', () => {
      const manager = createFreshManager();
      const msgs = [{ id: 'msg-1', role: 'user' }] as any;
      const mockInstance = makeMockAgentChat({ getChatHistory: vi.fn(() => msgs) });
      mockSessionCoordinator.getCurrentInstance.mockReturnValue(mockInstance);
      expect(manager.getChatHistory()).toBe(msgs);
    });
  });

  describe('switchToChatSession', () => {
    it('clears current session and returns null when chatId is null', async () => {
      const manager = createFreshManager();
      mockSessionCoordinator.getCurrentChatSessionId.mockReturnValue('old-session');

      const result = await manager.switchToChatSession('', null);
      expect(result).toBeNull();
      expect(mockSessionCoordinator.clearCurrentSession).toHaveBeenCalledWith('old-session');
    });

    it('returns null when no user alias and no cached instance', async () => {
      const manager = createFreshManager();
      mockRegistry.hasInstance.mockReturnValue(false);
      // No alias set, no profile

      const result = await manager.switchToChatSession('chat-1', 'session-1');
      expect(result).toBeNull();
    });

    it('reuses existing interactive instance from session coordinator', async () => {
      const manager = createFreshManager();
      const mockInstance = makeMockAgentChat();
      mockSessionCoordinator.getCurrentChatSessionId.mockReturnValue('session-1');
      mockSessionCoordinator.getCurrentInstance.mockReturnValue(mockInstance);
      mockRegistry.getRuntimeMode.mockReturnValue('interactive');

      const result = await manager.switchToChatSession('chat-1', 'session-1');
      expect(result).toBe(mockInstance);
      expect(mockSessionCoordinator.activateSession).toHaveBeenCalledWith('session-1', mockInstance);
    });
  });

  describe('exitNewChatSessionFor', () => {
    it('calls session coordinator exitNewChatSession', () => {
      const manager = createFreshManager();
      mockSessionCoordinator.exitNewChatSession.mockReturnValue({ success: true });
      manager.exitNewChatSessionFor('chat-1', 'session-1');
      expect(mockSessionCoordinator.exitNewChatSession).toHaveBeenCalledWith('chat-1', 'session-1');
    });

    it('logs warning when chatSessionId mismatch', () => {
      const manager = createFreshManager();
      mockSessionCoordinator.exitNewChatSession.mockReturnValue({
        success: false,
        existingChatSessionId: 'other-session',
      });
      manager.exitNewChatSessionFor('chat-1', 'session-1');
      expect(sharedMockLogger.warn).toHaveBeenCalled();
    });
  });

  describe('forkChatSession', () => {
    it('returns error when no currentUserAlias', async () => {
      const manager = createFreshManager();
      // No initialize called
      const result = await manager.forkChatSession('chat-1', 'source-session');
      expect(result.success).toBe(false);
      expect(result.error).toContain('No current user alias');
    });

    it('returns error when chatId is empty', async () => {
      const manager = createFreshManager();
      await manager.initialize('alice');

      const result = await manager.forkChatSession('', 'source-session');
      expect(result.success).toBe(false);
    });

    it('returns error when copySession fails', async () => {
      const manager = createFreshManager();
      await manager.initialize('alice');
      mockChatSessionStore.copySession.mockResolvedValue(false);

      const result = await manager.forkChatSession('chat-1', 'source-session');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to copy');
    });

    it('returns error when forkChatSessionDirectory fails', async () => {
      const manager = createFreshManager();
      await manager.initialize('alice');
      mockChatSessionStore.copySession.mockResolvedValue(true);
      mockSessionCoordinator.forkChatSessionDirectory.mockResolvedValue(null);

      const result = await manager.forkChatSession('chat-1', 'source-session');
      expect(result.success).toBe(false);
      expect(result.error).toContain('workspace');
    });
  });

  describe('cancelChatSession', () => {
    it('returns error when no instance found', async () => {
      const manager = createFreshManager();
      mockRegistry.getInstance.mockReturnValue(null);

      const result = await manager.cancelChatSession('session-1');
      expect(result.success).toBe(false);
      expect(result.error).toContain('No active chat session instance found');
    });

    it('returns success immediately when already idle', async () => {
      const manager = createFreshManager();
      const mockInstance = makeMockAgentChat({ getChatStatus: vi.fn(() => 'idle') });
      mockRegistry.getInstance.mockReturnValue(mockInstance);

      const result = await manager.cancelChatSession('session-1');
      expect(result.success).toBe(true);
    });

    it('cancels active cancellation source when running', async () => {
      const manager = createFreshManager();
      const cancelFn = vi.fn();
      const mockSource = {
        token: { isCancellationRequested: false },
        cancel: cancelFn,
      };
      const mockInstance = makeMockAgentChat({ getChatStatus: vi.fn(() => 'running') });
      mockRegistry.getInstance.mockReturnValue(mockInstance);
      mockRegistry.getCancellationSource.mockReturnValue(mockSource);

      const result = await manager.cancelChatSession('session-1');
      expect(cancelFn).toHaveBeenCalledOnce();
      expect(result.success).toBe(true);
    });
  });

  describe('runScheduledJob', () => {
    it('returns error when no current user alias', async () => {
      const manager = createFreshManager();
      // No initialize

      const result = await manager.runScheduledJob({ id: 'job-1', agentId: 'a1', name: 'Test' } as any);
      expect(result.success).toBe(false);
      expect(result.error).toContain('No current user alias');
    });

    it('delegates to scheduledRunner.run', async () => {
      const manager = createFreshManager();
      await manager.initialize('alice');
      mockScheduledRunner.run.mockResolvedValue({ success: true, messagesCount: 5 });

      const result = await manager.runScheduledJob({ id: 'job-1', agentId: 'a1', name: 'Test' } as any);
      expect(result.success).toBe(true);
      expect(result.messagesCount).toBe(5);
      expect(mockScheduledRunner.run).toHaveBeenCalledOnce();
    });
  });

  describe('removeInstanceByChatSession', () => {
    it('is a no-op when instance not found', () => {
      const manager = createFreshManager();
      mockRegistry.getInstance.mockReturnValue(null);
      expect(() => manager.removeInstanceByChatSession('session-1')).not.toThrow();
    });

    it('destroys instance and removes from registry', () => {
      const manager = createFreshManager();
      const mockInstance = makeMockAgentChat();
      mockRegistry.getInstance.mockReturnValue(mockInstance);

      manager.removeInstanceByChatSession('session-1');
      expect(mockInstance.destroy).toHaveBeenCalledOnce();
      expect(mockRegistry.removeInstance).toHaveBeenCalledWith('session-1');
    });
  });

  describe('updateSessionTitle', () => {
    it('returns false when no instance', () => {
      const manager = createFreshManager();
      mockRegistry.getInstance.mockReturnValue(null);
      expect(manager.updateSessionTitle('session-1', 'New Title')).toBe(false);
    });

    it('returns false when instance updateSessionTitle returns false', () => {
      const manager = createFreshManager();
      const mockInstance = makeMockAgentChat({ updateSessionTitle: vi.fn(() => false) });
      mockRegistry.getInstance.mockReturnValue(mockInstance);
      expect(manager.updateSessionTitle('session-1', 'New Title')).toBe(false);
    });

    it('returns true and notifies when title updated successfully', () => {
      const manager = createFreshManager();
      const mockInstance = makeMockAgentChat({ updateSessionTitle: vi.fn(() => true) });
      mockRegistry.getInstance.mockReturnValue(mockInstance);
      mockSessionCoordinator.getCurrentChatSessionId.mockReturnValue('session-1');

      expect(manager.updateSessionTitle('session-1', 'New Title')).toBe(true);
    });
  });

  describe('deleteChatSession', () => {
    async function makeInitialized(): Promise<AgentChatManager> {
      const manager = createFreshManager();
      await manager.initialize('alice');
      return manager;
    }

    it('returns error when no current user', async () => {
      const manager = createFreshManager();
      const result = await manager.deleteChatSession('chat-1', 'session-1');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/No current user/i);
    });

    it('returns error when chatId or sessionId missing', async () => {
      const manager = await makeInitialized();
      expect((await manager.deleteChatSession('', 'session-1')).success).toBe(false);
      expect((await manager.deleteChatSession('chat-1', '')).success).toBe(false);
    });

    it('refuses to delete an active (non-idle) session', async () => {
      const manager = await makeInitialized();
      const activeInstance = makeMockAgentChat({ getChatStatus: vi.fn(() => 'sending_response') });
      mockRegistry.getInstance.mockReturnValue(activeInstance);

      const result = await manager.deleteChatSession('chat-1', 'session-1');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Cannot delete this chat while it is sending_response/);
      expect(mockProfileCacheManager.deleteChatSession).not.toHaveBeenCalled();
    });

    it('deletes a non-current idle session without switching', async () => {
      const manager = await makeInitialized();
      mockRegistry.getInstance.mockReturnValue(null);
      mockSessionCoordinator.getCurrentChatSessionId.mockReturnValue('other-session');
      const otherInstance = makeMockAgentChat({ getChatId: vi.fn(() => 'chat-1') });
      mockSessionCoordinator.getCurrentInstance.mockReturnValue(otherInstance);
      const switchSpy = vi.spyOn(manager, 'switchToChatSession');

      const result = await manager.deleteChatSession('chat-1', 'session-1');

      expect(result.success).toBe(true);
      expect(result.nextChatSessionId).toBeNull();
      expect(mockProfileCacheManager.deleteChatSession).toHaveBeenCalledWith('alice', 'chat-1', 'session-1');
      expect(switchSpy).not.toHaveBeenCalled();
    });

    it('switches to newest sibling before deleting the current session', async () => {
      const manager = await makeInitialized();
      const currentInstance = makeMockAgentChat({
        getChatId: vi.fn(() => 'chat-1'),
        getChatStatus: vi.fn(() => 'idle'),
      });
      mockSessionCoordinator.getCurrentInstance.mockReturnValue(currentInstance);
      mockSessionCoordinator.getCurrentChatSessionId.mockReturnValue('session-1');
      mockRegistry.getInstance.mockReturnValue(null);

      mockProfileCacheManager.getChatSessionsAsync.mockResolvedValue([
        { chatSession_id: 'session-1', title: 'Active', last_updated: '2024-01-03T00:00:00Z' },
        { chatSession_id: 'session-old', title: 'Old', last_updated: '2024-01-01T00:00:00Z' },
        { chatSession_id: 'session-new', title: 'New', last_updated: '2024-01-02T00:00:00Z' },
      ]);

      const switchSpy = vi.spyOn(manager, 'switchToChatSession').mockResolvedValue(null as any);

      const result = await manager.deleteChatSession('chat-1', 'session-1');

      expect(result.success).toBe(true);
      expect(result.nextChatSessionId).toBe('session-new');
      // Switch must happen BEFORE the underlying delete so the renderer's
      // currentChatSessionId moves coherently.
      const switchOrder = switchSpy.mock.invocationCallOrder[0];
      const deleteOrder = mockProfileCacheManager.deleteChatSession.mock.invocationCallOrder[0];
      expect(switchSpy).toHaveBeenCalledWith('chat-1', 'session-new');
      expect(switchOrder).toBeLessThan(deleteOrder);
    });

    it('switches to null when deleting the only session', async () => {
      const manager = await makeInitialized();
      const currentInstance = makeMockAgentChat({
        getChatId: vi.fn(() => 'chat-1'),
        getChatStatus: vi.fn(() => 'idle'),
      });
      mockSessionCoordinator.getCurrentInstance.mockReturnValue(currentInstance);
      mockSessionCoordinator.getCurrentChatSessionId.mockReturnValue('session-1');
      mockRegistry.getInstance.mockReturnValue(null);

      mockProfileCacheManager.getChatSessionsAsync.mockResolvedValue([
        { chatSession_id: 'session-1', title: 'Only', last_updated: '2024-01-01T00:00:00Z' },
      ]);
      const switchSpy = vi.spyOn(manager, 'switchToChatSession').mockResolvedValue(null as any);

      const result = await manager.deleteChatSession('chat-1', 'session-1');

      expect(result.success).toBe(true);
      expect(result.nextChatSessionId).toBeNull();
      expect(switchSpy).toHaveBeenCalledWith('chat-1', null);
    });

    it('does not switch when deleting a non-current session even if it is the same chatId', async () => {
      const manager = await makeInitialized();
      const currentInstance = makeMockAgentChat({
        getChatId: vi.fn(() => 'chat-1'),
        getChatStatus: vi.fn(() => 'idle'),
      });
      mockSessionCoordinator.getCurrentInstance.mockReturnValue(currentInstance);
      mockSessionCoordinator.getCurrentChatSessionId.mockReturnValue('session-current');
      mockRegistry.getInstance.mockReturnValue(null);

      const result = await manager.deleteChatSession('chat-1', 'session-other');

      expect(result.success).toBe(true);
      expect(mockProfileCacheManager.getChatSessionsAsync).not.toHaveBeenCalled();
    });

    it('returns error when underlying store delete fails', async () => {
      const manager = await makeInitialized();
      mockRegistry.getInstance.mockReturnValue(null);
      mockSessionCoordinator.getCurrentChatSessionId.mockReturnValue('other');
      mockProfileCacheManager.deleteChatSession.mockResolvedValue(false);

      const result = await manager.deleteChatSession('chat-1', 'session-1');

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Failed to delete/i);
    });
  });

  describe('reconcileCurrentChatSession', () => {
    it('returns null state when there is no current instance', () => {
      const manager = createFreshManager();
      mockSessionCoordinator.getCurrentInstance.mockReturnValue(null);
      mockSessionCoordinator.getCurrentChatSessionId.mockReturnValue(null);

      const state = manager.reconcileCurrentChatSession({
        expectedChatId: 'old-chat',
        expectedChatSessionId: 'old-session',
      });

      expect(state.chatId).toBeNull();
      expect(state.chatSessionId).toBeNull();
      expect(state.chatStatus).toBeNull();
      expect(state.expectedChatId).toBe('old-chat');
      expect(state.expectedChatSessionId).toBe('old-session');
    });

    it('returns authoritative state from the session coordinator', () => {
      const manager = createFreshManager();
      const instance = makeMockAgentChat({
        getChatId: vi.fn(() => 'chat-X'),
        getChatStatus: vi.fn(() => 'idle'),
      });
      mockSessionCoordinator.getCurrentInstance.mockReturnValue(instance);
      mockSessionCoordinator.getCurrentChatSessionId.mockReturnValue('session-X');

      const state = manager.reconcileCurrentChatSession();

      expect(state.chatId).toBe('chat-X');
      expect(state.chatSessionId).toBe('session-X');
      expect(state.chatStatus).toBe('idle');
      expect(state.expectedChatId).toBeNull();
      expect(state.expectedChatSessionId).toBeNull();
    });
  });

  describe('startNewChatForPrimaryAgent reuse-empty', () => {
    async function setupPrimaryAgent(): Promise<AgentChatManager> {
      const manager = createFreshManager();
      await manager.initialize('alice');
      mockProfileCacheManager.getCachedProfile.mockReturnValue({
        primaryAgent: 'PrimaryAgent',
        chats: [{ chat_id: 'chat-primary', agent: { name: 'PrimaryAgent' } }],
      });
      // Make switchToChatSession's create-instance path return an instance.
      mockRegistry.getInstance.mockReturnValue(makeMockAgentChat());
      return manager;
    }

    it('reuses an existing empty session for the primary agent', async () => {
      const manager = await setupPrimaryAgent();
      mockProfileCacheManager.getChatSessionsAsync.mockResolvedValue([
        { chatSession_id: 'empty-newest', title: 'Empty', last_updated: '2024-01-03T00:00:00Z' },
        { chatSession_id: 'used-older', title: 'Used', last_updated: '2024-01-02T00:00:00Z' },
      ]);
      mockProfileCacheManager.getChatSessionFile.mockImplementation(async (_alias, _chatId, sid) => ({
        chatSession_id: sid,
        last_updated: '2024-01-03T00:00:00Z',
        title: 'Whatever',
        chat_history: sid === 'empty-newest' ? [] : [{ id: 'm1' }],
        context_history: [],
      }));

      await manager.startNewChatForPrimaryAgent();

      // It should NOT generate a new session id (no call into startNewChatFor's
      // getOrCreateNewChatSessionId path).
      expect(mockSessionCoordinator.getOrCreateNewChatSessionId).not.toHaveBeenCalled();
    });

    it('falls back to creating a new session when no empty session exists', async () => {
      const manager = await setupPrimaryAgent();
      mockProfileCacheManager.getChatSessionsAsync.mockResolvedValue([
        { chatSession_id: 'used-1', title: 'Used', last_updated: '2024-01-03T00:00:00Z' },
      ]);
      mockProfileCacheManager.getChatSessionFile.mockResolvedValue({
        chatSession_id: 'used-1',
        last_updated: '2024-01-03T00:00:00Z',
        title: 'Used',
        chat_history: [{ id: 'm1' }],
        context_history: [],
      });

      await manager.startNewChatForPrimaryAgent();

      // No empty session → must go through the standard create path.
      expect(mockSessionCoordinator.getOrCreateNewChatSessionId).toHaveBeenCalled();
    });

    it('skips scheduler-spawned sessions even when chat_history is empty', async () => {
      const manager = await setupPrimaryAgent();
      mockProfileCacheManager.getChatSessionsAsync.mockResolvedValue([
        {
          chatSession_id: 'sched-empty',
          title: 'Scheduled',
          last_updated: '2024-01-03T00:00:00Z',
          schedulerJobId: 'job-1',
        },
      ]);
      mockProfileCacheManager.getChatSessionFile.mockResolvedValue({
        chatSession_id: 'sched-empty',
        last_updated: '2024-01-03T00:00:00Z',
        title: 'Scheduled',
        chat_history: [],
        context_history: [],
      });

      await manager.startNewChatForPrimaryAgent();

      // Scheduler session should be skipped; must fall through to create new.
      expect(mockSessionCoordinator.getOrCreateNewChatSessionId).toHaveBeenCalled();
    });
  });
});
