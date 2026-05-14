/**
 * Research workspace — Target ↔ Chat state management hook.
 *
 * Keeps per-target chat lists in memory, plus the currently-active chatSession.
 * When the user switches target, callers use `selectChatForTarget` which
 * auto-restores the most-recent chat (via `lastActiveChatByTarget`) or creates
 * a brand-new one if none exists.
 *
 * IPC: see `researchChatIpc.ts` and `docs/research-target-chat-binding.md`.
 *
 * NOTE: this hook only manages metadata. Telling the chat engine to actually
 * switch sessions (via `electronAPI.agentChat.switchToChatSession`) is the
 * caller's responsibility — see `ResearchPage.tsx`.
 */

import { useCallback, useRef, useState } from 'react';
import {
  researchChatIpc,
  ResearchChatSessionMeta,
} from './researchChatIpc';
import type { Target } from './TargetListSidebar';

export interface ActiveChat {
  /** Parent agent chat container id (shared by all research chats of the user). */
  chatId: string;
  /** chatSession_id of the active chat. */
  chatSessionId: string;
}

export interface UseTargetChatsApi {
  /** chats[code] → metadata list (undefined = not yet loaded). */
  chatsByCode: Record<string, ResearchChatSessionMeta[] | undefined>;
  /** Currently-active chat (null when no target selected or no chats available). */
  active: ActiveChat | null;
  /** Ensure chats for `code` are loaded. Returns the cached/fresh list. */
  loadChats: (code: string) => Promise<ResearchChatSessionMeta[]>;
  /**
   * Pick (or create) the chat to display for the given target.
   * - `preferredSessionId` (if present in the list) wins (used for explicit clicks).
   * - Otherwise: stored `lastActiveChatByTarget` → fallback to most-recent.
   * - If the target has no chats yet, a new one is created.
   * Persists last-active and updates `active`.
   */
  selectChatForTarget: (
    code: string,
    target: Target | undefined,
    preferredSessionId?: string,
  ) => Promise<ActiveChat | null>;
  /** Create a new chat for the target and select it. */
  createChatForTarget: (
    code: string,
    target: Target | undefined,
  ) => Promise<ActiveChat | null>;
  /** Delete a chat session and update local cache. */
  deleteChat: (code: string, chatSessionId: string) => Promise<void>;
  /** Rename a chat session and update local cache. */
  renameChat: (code: string, chatSessionId: string, title: string) => Promise<void>;
}

export function useTargetChats(): UseTargetChatsApi {
  const [chatsByCode, setChatsByCode] = useState<Record<string, ResearchChatSessionMeta[] | undefined>>({});
  const [active, setActive] = useState<ActiveChat | null>(null);

  const chatsByCodeRef = useRef(chatsByCode);
  chatsByCodeRef.current = chatsByCode;

  const loadChats = useCallback(async (code: string): Promise<ResearchChatSessionMeta[]> => {
    if (chatsByCodeRef.current[code]) return chatsByCodeRef.current[code]!;
    try {
      const { sessions } = await researchChatIpc.listByTarget(code);
      setChatsByCode((prev) => ({ ...prev, [code]: sessions }));
      return sessions;
    } catch (err) {
      console.error('[useTargetChats] loadChats failed:', err);
      setChatsByCode((prev) => ({ ...prev, [code]: [] }));
      return [];
    }
  }, []);

  const createChatForTarget = useCallback(
    async (code: string, target: Target | undefined): Promise<ActiveChat | null> => {
      try {
        const created = await researchChatIpc.create(code, {
          title: 'New chat',
          targetDir: target?.directory,
        });
        const { sessions } = await researchChatIpc.listByTarget(code);
        setChatsByCode((prev) => ({ ...prev, [code]: sessions }));
        await researchChatIpc.setLastActive(code, created.chatSessionId);
        const next: ActiveChat = { chatId: created.chatId, chatSessionId: created.chatSessionId };
        setActive(next);
        return next;
      } catch (err) {
        console.error('[useTargetChats] createChatForTarget failed:', err);
        return null;
      }
    },
    [],
  );

  const selectChatForTarget = useCallback(
    async (code: string, target: Target | undefined, preferredSessionId?: string): Promise<ActiveChat | null> => {
      try {
        const { chatId, sessions } = await researchChatIpc.listByTarget(code);
        setChatsByCode((prev) => ({ ...prev, [code]: sessions }));

        if (!chatId) {
          // No chat config at all — try create (which uses primary agent's chat).
          return await createChatForTarget(code, target);
        }

        let chosen: string | null = null;
        if (preferredSessionId && sessions.some((s) => s.chatSession_id === preferredSessionId)) {
          chosen = preferredSessionId;
        } else if (sessions.length > 0) {
          const lastActive = await researchChatIpc.getLastActive(code);
          chosen = (lastActive && sessions.some((s) => s.chatSession_id === lastActive))
            ? lastActive
            : sessions[0].chatSession_id;
        }

        if (!chosen) {
          return await createChatForTarget(code, target);
        }

        await researchChatIpc.setLastActive(code, chosen);
        const next: ActiveChat = { chatId, chatSessionId: chosen };
        setActive(next);
        return next;
      } catch (err) {
        console.error('[useTargetChats] selectChatForTarget failed:', err);
        return null;
      }
    },
    [createChatForTarget],
  );

  const deleteChat = useCallback(async (code: string, chatSessionId: string) => {
    try {
      await researchChatIpc.delete(chatSessionId);
      setChatsByCode((prev) => {
        const cur = prev[code];
        if (!cur) return prev;
        return { ...prev, [code]: cur.filter((c) => c.chatSession_id !== chatSessionId) };
      });
      setActive((prev) => (prev?.chatSessionId === chatSessionId ? null : prev));
    } catch (err) {
      console.error('[useTargetChats] deleteChat failed:', err);
    }
  }, []);

  const renameChat = useCallback(async (code: string, chatSessionId: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    try {
      await researchChatIpc.rename(chatSessionId, trimmed);
      setChatsByCode((prev) => {
        const cur = prev[code];
        if (!cur) return prev;
        return {
          ...prev,
          [code]: cur.map((c) =>
            c.chatSession_id === chatSessionId
              ? { ...c, title: trimmed, last_updated: new Date().toISOString() }
              : c,
          ),
        };
      });
    } catch (err) {
      console.error('[useTargetChats] renameChat failed:', err);
    }
  }, []);

  return {
    chatsByCode,
    active,
    loadChats,
    selectChatForTarget,
    createChatForTarget,
    deleteChat,
    renameChat,
  };
}
