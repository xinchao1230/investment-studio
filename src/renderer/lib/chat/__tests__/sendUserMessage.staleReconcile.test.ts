/**
 * @vitest-environment happy-dom
 *
 * Regression test for the W3 finding: when sendUserMessage detects a stale
 * pointer and calls reconcileCurrentChatSession, an `applied=false` response
 * may mean the compare-and-swap was rejected because the local pointer
 * mutated mid-flight (typically via the chatSessionStore:sessionDeleted
 * listener firing concurrently). In that case the value captured before the
 * await is now stale — we must re-read getCurrentChatSessionId() to target
 * the live local pointer rather than ship the request to the dead session.
 */
import type { Message } from '@shared/types/chatTypes';

const cacheMock = vi.hoisted(() => {
  let current: string | null = 'session-1';
  const setCurrent = (v: string | null) => { current = v; };
  return {
    setCurrent,
    getCurrent: () => current,
    addUserMessage: vi.fn(),
    removeMessage: vi.fn(),
    setErrorMessage: vi.fn(),
    getCurrentChatSessionId: vi.fn(() => current),
    getUserMessageSendState: vi.fn(),
    hasChatSessionCache: vi.fn(),
    reconcileCurrentChatSession: vi.fn(),
    waitForSendReady: vi.fn().mockResolvedValue(true),
    subscribeToCurrentChatSessionId: vi.fn(() => () => {}),
  };
});

const ipcMock = vi.hoisted(() => ({
  streamMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../agentChatSessionCacheManager', () => ({
  agentChatSessionCacheManager: cacheMock,
}));

vi.mock('../agentChatIpc', () => ({
  agentChatIpc: ipcMock,
}));

vi.mock('../../utilities/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { sendUserMessage } from '../sendUserMessageOptimistically';

const userMessage: Message = {
  id: 'user_1',
  role: 'user',
  timestamp: 1000,
  content: [{ type: 'text', text: 'hi' }],
};

describe('sendUserMessage — post-reconcile stale pointer recovery', () => {
  beforeEach(() => {
    cacheMock.addUserMessage.mockReset();
    cacheMock.removeMessage.mockReset();
    cacheMock.setErrorMessage.mockReset();
    cacheMock.getUserMessageSendState.mockReset();
    cacheMock.hasChatSessionCache.mockReset();
    cacheMock.reconcileCurrentChatSession.mockReset();
    cacheMock.waitForSendReady.mockReset().mockResolvedValue(true);
    ipcMock.streamMessage.mockReset().mockResolvedValue(undefined);
    cacheMock.setCurrent('session-1');
  });

  it('uses the latest local pointer (not the reconcile response, not the pre-reconcile capture) when CAS is rejected mid-flight', async () => {
    // Step A: initial local view is session-1, but it's stale (canSend=false, no cache).
    cacheMock.getUserMessageSendState.mockImplementation((sid: string | null | undefined) => {
      if (sid === 'session-1') return { canSend: false, error: 'stale', chatStatus: null };
      // session-3 is the new live pointer; it can send.
      return { canSend: true, error: '', chatStatus: 'idle' };
    });
    cacheMock.hasChatSessionCache.mockImplementation((sid: string | null | undefined) => sid === 'session-3');

    // Step B: reconcile returns applied=false (compare-and-swap rejected because
    // we mutate the local pointer below) with a NON-NULL server value (session-2).
    // Pre-fix code would have stayed on the pre-reconcile capture 'session-1'.
    cacheMock.reconcileCurrentChatSession.mockImplementation(async () => {
      // Simulate sessionDeleted listener firing mid-IPC: local pointer moves to session-3.
      cacheMock.setCurrent('session-3');
      return { applied: false, chatId: 'chat-2', chatSessionId: 'session-2', chatStatus: 'idle' };
    });

    await sendUserMessage(userMessage);

    // The fix asserts: addUserMessage is called against the LIVE local pointer
    // (session-3) — neither the stale capture (session-1) nor the server's
    // unapplied suggestion (session-2).
    expect(cacheMock.addUserMessage).toHaveBeenCalledTimes(1);
    expect(cacheMock.addUserMessage).toHaveBeenCalledWith('session-3', userMessage);

    // And streamMessage runs (chatSessionId was non-null after re-read).
    expect(ipcMock.streamMessage).toHaveBeenCalledTimes(1);
  });

  it('still applies the server-supplied id when reconcile returns applied=true', async () => {
    cacheMock.getUserMessageSendState.mockImplementation((sid: string | null | undefined) => {
      if (sid === 'session-1') return { canSend: false, error: 'stale', chatStatus: null };
      return { canSend: true, error: '', chatStatus: 'idle' };
    });
    cacheMock.hasChatSessionCache.mockImplementation((sid: string | null | undefined) => sid === 'session-9');

    cacheMock.reconcileCurrentChatSession.mockImplementation(async () => {
      // Reconcile applies the new id authoritatively.
      cacheMock.setCurrent('session-9');
      return { applied: true, chatId: 'chat-9', chatSessionId: 'session-9', chatStatus: 'idle' };
    });

    await sendUserMessage(userMessage);

    expect(cacheMock.addUserMessage).toHaveBeenCalledWith('session-9', userMessage);
  });
});
