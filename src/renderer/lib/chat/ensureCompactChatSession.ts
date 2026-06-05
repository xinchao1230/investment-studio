import { agentChatSessionCacheManager } from './agentChatSessionCacheManager';
import { profileDataManager } from '../userData';
import { startNewChatFor } from './startNewChatFor';
import { getDefaultPrimaryAgentName } from '../../../main/lib/userDataADO/types/profile';
import { BRAND_NAME } from '../../../shared/constants/branding';
import { createLogger } from '../utilities/logger';

const logger = createLogger('[ensureCompactChatSession]');

/**
 * Ensure compact (embedded) chat panes have a current chat session. Used by
 * ChatView's compact-mode bootstrap and by flows that orphan the current
 * session (e.g. deleting a target whose chats were bound to it). Prefers a
 * main-process-authoritative IPC so it works correctly during sign-in
 * transitions when renderer-side profile cache may be stale.
 *
 * No-ops when a session already exists; callers that want to force a fresh
 * primary-agent session should null out the current pointer first via
 * `agentChatSessionCacheManager.setCurrentChatSessionId(null, null)`.
 */
export async function ensureCompactChatSession(): Promise<void> {
  if (agentChatSessionCacheManager.getCurrentChatSessionId()) return;
  try {
    if (window.electronAPI?.agentChat?.getCurrentChatSession) {
      const cur = await window.electronAPI.agentChat.getCurrentChatSession();
      if (cur?.success && cur.data?.chatId && cur.data?.chatSessionId) {
        agentChatSessionCacheManager.setCurrentChatSessionId(cur.data.chatId, cur.data.chatSessionId);
        return;
      }
    }

    const ipc = (window as any).electronAPI?.agentChat;
    if (ipc?.startNewChatForPrimaryAgent) {
      const result = await ipc.startNewChatForPrimaryAgent();
      if (result?.success && result.chatId && result.chatSessionId) {
        agentChatSessionCacheManager.setCurrentChatSessionId(result.chatId, result.chatSessionId);
        return;
      }
    }

    const profile = profileDataManager.getProfile() as any;
    if (!profile) return;
    const primaryAgentName: string = profile.primaryAgent || getDefaultPrimaryAgentName(BRAND_NAME);
    const chats: any[] = profile.chats || [];
    if (chats.length === 0) return;
    const primaryChat = chats.find((c: any) => c.agent?.name === primaryAgentName);
    const targetChatId = primaryChat?.chat_id || chats[0]?.chat_id;
    if (!targetChatId) return;
    const result = await startNewChatFor(targetChatId);
    if (result?.success && result.chatSessionId) {
      agentChatSessionCacheManager.setCurrentChatSessionId(targetChatId, result.chatSessionId);
    }
  } catch (err) {
    logger.error('ensureCompactChatSession failed:', err);
  }
}
