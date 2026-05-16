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

import { useCallback, useEffect, useRef, useState } from 'react';
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
  /**
   * Delete a chat session and update local cache.
   * If the deleted session was the active one, falls back to the next
   * most-recent chat for the target — or auto-creates a fresh "New Chat"
   * when no chats remain — to prevent the right pane from showing stale
   * messages.
   */
  deleteChat: (code: string, chatSessionId: string, target?: Target) => Promise<void>;
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
          title: 'New Chat',
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

  const deleteChat = useCallback(async (code: string, chatSessionId: string, target?: Target) => {
    try {
      await researchChatIpc.delete(chatSessionId);
      const cur = chatsByCodeRef.current[code] ?? [];
      const remaining = cur.filter((c) => c.chatSession_id !== chatSessionId);
      setChatsByCode((prev) => ({ ...prev, [code]: remaining }));

      const wasActive = active?.chatSessionId === chatSessionId;
      if (!wasActive) return;

      // Active chat was deleted — fall back so the right pane doesn't
      // keep showing stale messages from the deleted session.
      if (remaining.length > 0) {
        // Pick the newest by creation time (chatSession_id lex desc).
        const next = [...remaining].sort((a, b) =>
          b.chatSession_id.localeCompare(a.chatSession_id),
        )[0];
        const { chatId } = await researchChatIpc.listByTarget(code);
        if (chatId) {
          await researchChatIpc.setLastActive(code, next.chatSession_id);
          setActive({ chatId, chatSessionId: next.chatSession_id });
          return;
        }
      }
      // Empty list → auto-create a fresh "New Chat" so the user lands in
      // a usable state instead of a ghost pane. Skip this when no target
      // was supplied (e.g. cascade-delete during target removal — there
      // is nothing left to attach a new chat to).
      if (target) {
        await createChatForTarget(code, target);
      } else {
        setActive((prev) => (prev?.chatSessionId === chatSessionId ? null : prev));
      }
    } catch (err) {
      console.error('[useTargetChats] deleteChat failed:', err);
    }
  }, [active, createChatForTarget]);

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

  // Refresh chat metadata (title, last_updated) when the main process
  // notifies us of a chatSession list change — most importantly the async
  // title generated after the first user message lands.
  useEffect(() => {
    const api: any = (window as any).electronAPI;
    const off = api?.profile?.onChatSessionUpdated?.((data: { sessions: any[] }) => {
      const incoming = data?.sessions;
      if (!Array.isArray(incoming)) return;
      // Build a map: chatSession_id -> latest meta (title, last_updated)
      const byId = new Map<string, { title?: string; last_updated?: string }>();
      for (const s of incoming) {
        if (s && typeof s.chatSession_id === 'string') {
          byId.set(s.chatSession_id, { title: s.title, last_updated: s.last_updated });
        }
      }
      setChatsByCode((prev) => {
        let mutated = false;
        const next: typeof prev = { ...prev };
        for (const [code, list] of Object.entries(prev)) {
          if (!list) continue;
          let listChanged = false;
          const updated = list.map((c) => {
            const fresh = byId.get(c.chatSession_id);
            if (!fresh) return c;
            const newTitle = fresh.title ?? c.title;
            const newLU = fresh.last_updated ?? c.last_updated;
            if (newTitle === c.title && newLU === c.last_updated) return c;
            listChanged = true;
            return { ...c, title: newTitle, last_updated: newLU };
          });
          if (listChanged) {
            next[code] = updated;
            mutated = true;
          }
        }
        return mutated ? next : prev;
      });
    });
    return () => { try { off?.(); } catch { /* ignore */ } };
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
