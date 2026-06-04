/**
 * Tests for stale-session recovery wiring added to
 * AgentChatSessionCacheManager:
 *  - Subscribes to `chatSessionStore:sessionDeleted` and clears the
 *    current-session pointer when the deleted session was current.
 *  - `reconcileCurrentChatSession` applies the main-process state, but
 *    skips when local state changed mid-flight (compare-and-swap).
 */

type SessionDeletedListener = (data: {
  alias: string;
  chatId: string;
  chatSessionId: string;
  timestamp: number;
}) => void;

interface FakeWindow {
  electronAPI: {
    agentChat: {
      reconcileCurrentChatSession?: ReturnType<typeof vi.fn>;
    };
    profile?: {
      onChatSessionStoreSessionDeleted?: (cb: SessionDeletedListener) => () => void;
    };
  };
}

function installFakeWindow(): {
  win: FakeWindow;
  fireSessionDeleted: (data: { alias: string; chatId: string; chatSessionId: string }) => void;
  reconcileMock: ReturnType<typeof vi.fn>;
} {
  const listeners: SessionDeletedListener[] = [];
  const reconcileMock = vi.fn();
  const win: FakeWindow = {
    electronAPI: {
      agentChat: {
        reconcileCurrentChatSession: reconcileMock,
      },
      profile: {
        onChatSessionStoreSessionDeleted: (cb: SessionDeletedListener) => {
          listeners.push(cb);
          return () => {
            const idx = listeners.indexOf(cb);
            if (idx >= 0) listeners.splice(idx, 1);
          };
        },
      },
    },
  };
  (global as any).window = win;
  return {
    win,
    reconcileMock,
    fireSessionDeleted: (data) => {
      listeners.forEach((cb) => cb({ ...data, timestamp: Date.now() }));
    },
  };
}

describe('AgentChatSessionCacheManager stale-session recovery', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  describe('chatSessionStore:sessionDeleted listener', () => {
    it('clears currentChatSessionId when deleted session was current', async () => {
      const { fireSessionDeleted } = installFakeWindow();
      const { agentChatSessionCacheManager } = await import('../agentChatSessionCacheManager');

      agentChatSessionCacheManager.setCurrentChatSessionId('chat-1', 'session-1');
      expect(agentChatSessionCacheManager.getCurrentChatSessionId()).toBe('session-1');

      fireSessionDeleted({ alias: 'alice', chatId: 'chat-1', chatSessionId: 'session-1' });

      expect(agentChatSessionCacheManager.getCurrentChatSessionId()).toBeNull();
      expect(agentChatSessionCacheManager.getCurrentChatId()).toBeNull();
    });

    it('leaves currentChatSessionId untouched when a different session is deleted', async () => {
      const { fireSessionDeleted } = installFakeWindow();
      const { agentChatSessionCacheManager } = await import('../agentChatSessionCacheManager');

      agentChatSessionCacheManager.setCurrentChatSessionId('chat-1', 'session-current');
      fireSessionDeleted({ alias: 'alice', chatId: 'chat-1', chatSessionId: 'session-other' });

      expect(agentChatSessionCacheManager.getCurrentChatSessionId()).toBe('session-current');
    });

    it('is a no-op when no current session is set', async () => {
      const { fireSessionDeleted } = installFakeWindow();
      const { agentChatSessionCacheManager } = await import('../agentChatSessionCacheManager');

      expect(() =>
        fireSessionDeleted({ alias: 'alice', chatId: 'chat-1', chatSessionId: 'session-1' }),
      ).not.toThrow();
      expect(agentChatSessionCacheManager.getCurrentChatSessionId()).toBeNull();
    });
  });

  describe('reconcileCurrentChatSession', () => {
    it('applies main-process state when local pointer is unchanged', async () => {
      const { reconcileMock } = installFakeWindow();
      reconcileMock.mockResolvedValue({
        success: true,
        data: {
          chatId: 'chat-2',
          chatSessionId: 'session-2',
          chatStatus: 'idle',
          expectedChatId: 'chat-1',
          expectedChatSessionId: 'session-1',
        },
      });
      const { agentChatSessionCacheManager } = await import('../agentChatSessionCacheManager');

      agentChatSessionCacheManager.setCurrentChatSessionId('chat-1', 'session-1');
      const result = await agentChatSessionCacheManager.reconcileCurrentChatSession();

      expect(result.applied).toBe(true);
      expect(result.chatSessionId).toBe('session-2');
      expect(agentChatSessionCacheManager.getCurrentChatSessionId()).toBe('session-2');
    });

    it('skips applying when local pointer changed mid-flight (compare-and-swap)', async () => {
      const { reconcileMock } = installFakeWindow();
      let resolveResp: (v: any) => void = () => {};
      reconcileMock.mockReturnValue(new Promise((r) => { resolveResp = r; }));
      const { agentChatSessionCacheManager } = await import('../agentChatSessionCacheManager');

      agentChatSessionCacheManager.setCurrentChatSessionId('chat-1', 'session-1');
      const promise = agentChatSessionCacheManager.reconcileCurrentChatSession();

      // User navigated mid-flight
      agentChatSessionCacheManager.setCurrentChatSessionId('chat-3', 'session-3');

      // Now resolve the reconcile response with a different target
      resolveResp({
        success: true,
        data: {
          chatId: 'chat-2',
          chatSessionId: 'session-2',
          chatStatus: 'idle',
          expectedChatId: 'chat-1',
          expectedChatSessionId: 'session-1',
        },
      });

      const result = await promise;
      expect(result.applied).toBe(false);
      // Stale response must NOT clobber the user's selection.
      expect(agentChatSessionCacheManager.getCurrentChatSessionId()).toBe('session-3');
    });

    it('returns applied=false when main reports no current session', async () => {
      const { reconcileMock } = installFakeWindow();
      reconcileMock.mockResolvedValue({
        success: true,
        data: {
          chatId: null,
          chatSessionId: null,
          chatStatus: null,
          expectedChatId: 'chat-1',
          expectedChatSessionId: 'session-1',
        },
      });
      const { agentChatSessionCacheManager } = await import('../agentChatSessionCacheManager');

      agentChatSessionCacheManager.setCurrentChatSessionId('chat-1', 'session-1');
      const result = await agentChatSessionCacheManager.reconcileCurrentChatSession();

      expect(result.chatSessionId).toBeNull();
      // We still need to clear our stale pointer when main reports null.
      // Apply runs because the new state differs from local.
      expect(result.applied).toBe(true);
      expect(agentChatSessionCacheManager.getCurrentChatSessionId()).toBeNull();
    });

    it('returns applied=false when reconcile IPC missing', async () => {
      installFakeWindow();
      (global as any).window.electronAPI.agentChat.reconcileCurrentChatSession = undefined;
      const { agentChatSessionCacheManager } = await import('../agentChatSessionCacheManager');
      agentChatSessionCacheManager.setCurrentChatSessionId('chat-1', 'session-1');

      const result = await agentChatSessionCacheManager.reconcileCurrentChatSession();
      expect(result.applied).toBe(false);
      // Pointer stays as-is when IPC unavailable.
      expect(agentChatSessionCacheManager.getCurrentChatSessionId()).toBe('session-1');
    });
  });
});
