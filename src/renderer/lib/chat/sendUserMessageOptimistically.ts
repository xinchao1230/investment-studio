import { MessageHelper, type Message, type UserMessage } from '@shared/types/chatTypes';
import { agentChatSessionCacheManager } from './agentChatSessionCacheManager';
import { agentChatIpc } from './agentChatIpc';
import { logger } from '../utilities/logger';

type ChatSessionSendCache = {
  getUserMessageSendState: (chatSessionId: string | null | undefined) => {
    canSend: boolean;
    error: string;
    chatStatus: string | null;
  };
  addUserMessage: (chatSessionId: string, userMessage: Message) => void;
  removeMessage: (chatSessionId: string, messageId: string) => void;
  setErrorMessage: (chatSessionId: string, errorMessage: string) => void;
};

export async function sendUserMessageOptimistically<T>(options: {
  chatSessionId: string | null | undefined;
  userMessage: Message;
  cacheManager: ChatSessionSendCache;
  send: () => Promise<T>;
}): Promise<T> {
  const { chatSessionId, userMessage, cacheManager, send } = options;
  if (!userMessage.id) {
    throw new Error('Optimistic user messages must have a stable message id.');
  }
  const sendState = cacheManager.getUserMessageSendState(chatSessionId);

  if (!chatSessionId || !sendState.canSend) {
    if (chatSessionId) {
      cacheManager.setErrorMessage(chatSessionId, sendState.error);
    }
    throw new Error(sendState.error);
  }

  cacheManager.addUserMessage(chatSessionId, userMessage);

  try {
    return await send();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Only roll back the optimistic user message if it was never persisted by the backend.
    // Pre-persistence rejections are returned by agentChatManager.streamMessage before
    // addMessageToSession runs — they match known error patterns below.
    // Post-persistence failures (API errors after addMessageToSession) should keep the message
    // in the cache — it already exists on disk and will reappear on session switch anyway.
    const isPrePersistenceRejection =
      /chat status is/i.test(errorMessage) ||
      /No agent instance found/i.test(errorMessage);
    if (isPrePersistenceRejection) {
      cacheManager.removeMessage(chatSessionId, userMessage.id);
    }

    cacheManager.setErrorMessage(chatSessionId, errorMessage);
    throw error;
  }
}

export async function sendUserMessage(message: UserMessage) {
  try {
    logger.debug('[SendUserMessage] 📤 Sending message...');

    // Step 1: read our local view of the current session.
    let chatSessionId = agentChatSessionCacheManager.getCurrentChatSessionId();

    // Step 2: detect a stale pointer. If we think we have a session but no
    // cache entry exists for it (or chatStatus is null), the renderer's view
    // is likely out of sync with the main process — typically because a
    // deletion happened without the corresponding sessionDeleted event being
    // received before this send was attempted. Ask main for the
    // authoritative current session and apply it (compare-and-swap inside
    // reconcileCurrentChatSession).
    if (chatSessionId) {
      const sendState = agentChatSessionCacheManager.getUserMessageSendState(chatSessionId);
      const hasCache = agentChatSessionCacheManager.hasChatSessionCache(chatSessionId);
      if (!sendState.canSend && (!hasCache || sendState.chatStatus === null)) {
        logger.warn('[SendUserMessage] Stale current chat session detected; reconciling with main', {
          chatSessionId, chatStatus: sendState.chatStatus, hasCache,
        });
        const reconciled = await agentChatSessionCacheManager.reconcileCurrentChatSession();
        if (reconciled.applied && reconciled.chatSessionId) {
          chatSessionId = reconciled.chatSessionId;
        } else if (reconciled.chatSessionId === null) {
          // Main has no current session either — fall through to the
          // existing wait-then-fail path so ChatView's compact flow can
          // spawn a new session.
          chatSessionId = null;
        }
      }
    }

    // Step 3: after sign-out → sign-in or right after reconcile-to-null,
    // wait up to 8s for a current session to appear before giving up.
    if (!chatSessionId) {
      chatSessionId = await new Promise<string | null>((resolve) => {
        const timeout = setTimeout(() => { unsub(); resolve(null); }, 8000);
        const unsub = agentChatSessionCacheManager.subscribeToCurrentChatSessionId(() => {
          const sid = agentChatSessionCacheManager.getCurrentChatSessionId();
          if (sid) { clearTimeout(timeout); unsub(); resolve(sid); }
        });
        // Re-check in case it arrived between the read and subscribe
        const immediate = agentChatSessionCacheManager.getCurrentChatSessionId();
        if (immediate) { clearTimeout(timeout); unsub(); resolve(immediate); }
      });
      if (chatSessionId) {
        await agentChatSessionCacheManager.waitForSendReady(chatSessionId, 5000);
      }
    } else {
      // A reconcile may have just updated chatSessionId — wait briefly for
      // its cache to populate (chatStatus arrives via separate event).
      await agentChatSessionCacheManager.waitForSendReady(chatSessionId, 2000);
    }

    await sendUserMessageOptimistically({
      chatSessionId,
      userMessage: message,
      cacheManager: agentChatSessionCacheManager,
      send: () => agentChatIpc.streamMessage(message, {
        onAssistantMessage: (msg: any) => {
          logger.debug('[SendUserMessage] 📨 Assistant message:', msg.id);
        },
        onToolUse: (toolName: string) => {
          logger.debug('[SendUserMessage] 🔧 Tool used:', toolName);
        },
        onToolResult: (toolMessage: any) => {
          logger.debug('[SendUserMessage] 📦 Tool result received:', toolMessage.id);
        },
      }),
    });
    logger.debug('[SendUserMessage] ✅ Message sent successfully');
  } catch (error) {
    logger.error('[SendUserMessage] ❌ Error sending message:', error);
  }
}

export async function sendUserPrompt(prompt: string) {
  return sendUserMessage(MessageHelper.createTextMessage(prompt, 'user'));
}
