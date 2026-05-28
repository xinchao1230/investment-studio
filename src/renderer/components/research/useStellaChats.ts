/**
 * Research workspace — global "Ask Stella" chat state.
 *
 * Variant of `useTargetChats` that holds a single flat list of chat sessions
 * scoped to `targetCode = null` (global research scope, see researchChatIpc).
 *
 * Like the target hook, this only manages metadata; the caller (ResearchPage)
 * is responsible for telling the chat engine to actually switch sessions via
 * `electronAPI.agentChat.switchToChatSession`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { researchChatIpc, ResearchChatSessionMeta } from './researchChatIpc';
import type { ActiveChat } from './useTargetChats';

export interface UseStellaChatsApi {
  chats: ResearchChatSessionMeta[] | undefined;
  active: ActiveChat | null;
  loadChats: () => Promise<ResearchChatSessionMeta[]>;
  selectChat: (preferredSessionId?: string) => Promise<ActiveChat | null>;
  createChat: () => Promise<ActiveChat | null>;
  deleteChat: (chatSessionId: string) => Promise<void>;
  renameChat: (chatSessionId: string, title: string) => Promise<void>;
}

export function useStellaChats(): UseStellaChatsApi {
  const [chats, setChats] = useState<ResearchChatSessionMeta[] | undefined>(undefined);
  const [active, setActive] = useState<ActiveChat | null>(null);

  const chatsRef = useRef(chats);
  chatsRef.current = chats;

  const loadChats = useCallback(async (): Promise<ResearchChatSessionMeta[]> => {
    if (chatsRef.current) return chatsRef.current;
    try {
      const { sessions } = await researchChatIpc.listByTarget(null);
      setChats(sessions);
      return sessions;
    } catch (err) {
      console.error('[useStellaChats] loadChats failed:', err);
      setChats([]);
      return [];
    }
  }, []);

  const createChat = useCallback(async (): Promise<ActiveChat | null> => {
    try {
      const created = await researchChatIpc.create(null, { title: '新对话' });
      const { sessions } = await researchChatIpc.listByTarget(null);
      setChats(sessions);
      await researchChatIpc.setLastActive(null, created.chatSessionId);
      const next: ActiveChat = {
        chatId: created.chatId,
        chatSessionId: created.chatSessionId,
      };
      setActive(next);
      return next;
    } catch (err) {
      console.error('[useStellaChats] createChat failed:', err);
      return null;
    }
  }, []);

  const selectChat = useCallback(
    async (preferredSessionId?: string): Promise<ActiveChat | null> => {
      try {
        const { chatId, sessions } = await researchChatIpc.listByTarget(null);
        setChats(sessions);

        if (!chatId) {
          return await createChat();
        }

        let chosen: string | null = null;
        if (preferredSessionId && sessions.some((s) => s.chatSession_id === preferredSessionId)) {
          chosen = preferredSessionId;
        } else if (sessions.length > 0) {
          const lastActive = await researchChatIpc.getLastActive(null);
          chosen = lastActive && sessions.some((s) => s.chatSession_id === lastActive)
            ? lastActive
            : sessions[0].chatSession_id;
        }

        if (!chosen) {
          return await createChat();
        }

        await researchChatIpc.setLastActive(null, chosen);
        const next: ActiveChat = { chatId, chatSessionId: chosen };
        setActive(next);
        return next;
      } catch (err) {
        console.error('[useStellaChats] selectChat failed:', err);
        return null;
      }
    },
    [createChat],
  );

  const deleteChat = useCallback(async (chatSessionId: string) => {
    try {
      await researchChatIpc.delete(chatSessionId);
      const remaining = (chatsRef.current ?? []).filter((c) => c.chatSession_id !== chatSessionId);
      setChats(remaining);
      const wasActive = active?.chatSessionId === chatSessionId;
      if (!wasActive) return;

      // Active chat was deleted — fall back so the right pane never keeps
      // showing stale messages from the deleted session.
      if (remaining.length > 0) {
        // Pick the newest by creation time (chatSession_id lex desc).
        const next = [...remaining].sort((a, b) =>
          b.chatSession_id.localeCompare(a.chatSession_id),
        )[0];
        const { chatId } = await researchChatIpc.listByTarget(null);
        if (chatId) {
          await researchChatIpc.setLastActive(null, next.chatSession_id);
          setActive({ chatId, chatSessionId: next.chatSession_id });
          return;
        }
      }
      // Empty list → auto-create a fresh "New Chat" so the user lands in
      // a usable state instead of a ghost pane.
      await createChat();
    } catch (err) {
      console.error('[useStellaChats] deleteChat failed:', err);
    }
  }, [active, createChat]);

  const renameChat = useCallback(async (chatSessionId: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    try {
      await researchChatIpc.rename(chatSessionId, trimmed);
      setChats((prev) =>
        prev
          ? prev.map((c) =>
              c.chatSession_id === chatSessionId
                ? { ...c, title: trimmed, last_updated: new Date().toISOString() }
                : c,
            )
          : prev,
      );
    } catch (err) {
      console.error('[useStellaChats] renameChat failed:', err);
    }
  }, []);

  // Mirror useTargetChats: refresh title/last_updated when main pushes updates
  // (e.g. async-generated title after first user message).
  useEffect(() => {
    const api: any = (window as any).electronAPI;
    const off = api?.profile?.onChatSessionUpdated?.((data: { sessions: any[] }) => {
      const incoming = data?.sessions;
      if (!Array.isArray(incoming)) return;
      const byId = new Map<string, { title?: string; last_updated?: string }>();
      for (const s of incoming) {
        if (s && typeof s.chatSession_id === 'string') {
          byId.set(s.chatSession_id, { title: s.title, last_updated: s.last_updated });
        }
      }
      setChats((prev) => {
        if (!prev) return prev;
        let mutated = false;
        const next = prev.map((c) => {
          const fresh = byId.get(c.chatSession_id);
          if (!fresh) return c;
          const newTitle = fresh.title ?? c.title;
          const newLU = fresh.last_updated ?? c.last_updated;
          if (newTitle === c.title && newLU === c.last_updated) return c;
          mutated = true;
          return { ...c, title: newTitle, last_updated: newLU };
        });
        return mutated ? next : prev;
      });
    });
    return () => { try { off?.(); } catch { /* ignore */ } };
  }, []);

  return { chats, active, loadChats, selectChat, createChat, deleteChat, renameChat };
}
