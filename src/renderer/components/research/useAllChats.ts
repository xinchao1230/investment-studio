/**
 * Research workspace — unified chat list (Ask tab).
 *
 * Loads every chat session for the active chat config, regardless of
 * `targetCode` binding. Used by the Ask tab in TargetListSidebar to
 * render a single chronological list that surfaces both global (Stella)
 * conversations and target-bound ones in the same place.
 *
 * Selection is intentionally NOT owned here — it stays in `useStellaChats`
 * (for targetCode = null rows) and `useTargetChats` (for bound rows) so
 * chat-engine switching and last-active tracking continue to work
 * unchanged. This hook only owns the visible list.
 *
 * IPC: see `researchChatIpc.ts` and `docs/research-target-chat-binding.md`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { researchChatIpc, ResearchChatSessionMeta } from './researchChatIpc';

export interface UseAllChatsApi {
  chats: ResearchChatSessionMeta[] | undefined;
  refresh: () => Promise<void>;
}

export function useAllChats(): UseAllChatsApi {
  const [chats, setChats] = useState<ResearchChatSessionMeta[] | undefined>(undefined);
  const loadingRef = useRef(false);
  // Track the research chatId so the push listener can ignore events
  // targeted at unrelated chat configs (other Copilot chat tabs, agent
  // bootstrap notifications, etc.) — those previously wiped this list.
  const chatIdRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const { chatId, sessions } = await researchChatIpc.listAll();
      chatIdRef.current = chatId;
      setChats(sessions);
    } catch (err) {
      console.error('[useAllChats] listAll failed:', err);
      setChats([]);
    } finally {
      loadingRef.current = false;
    }
  }, []);

  // Initial load on mount.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Re-fetch the full list whenever the chatSessionStore signals a
  // structural or metadata change. The previous implementation listened to
  // a `profile.onChatSessionUpdated` event that was never wired up in the
  // preload bridge, so incremental updates never arrived. Instead we now
  // subscribe to the three real IPC events (created / metadata-patched /
  // deleted) and do a cheap full re-list on each — the list is small enough
  // that a round-trip is imperceptible, and it avoids fragile incremental
  // patching that can desync from the backend.
  useEffect(() => {
    const api = (window as any).electronAPI?.profile;
    if (!api) return;

    const unsubs: Array<() => void> = [];

    const onEvent = (data: { chatId?: string }) => {
      // Ignore notifications for other chat configs.
      const activeChatId = chatIdRef.current;
      if (activeChatId && data?.chatId && data.chatId !== activeChatId) return;
      void refresh();
    };

    if (api.onChatSessionStoreSessionCreated) {
      unsubs.push(api.onChatSessionStoreSessionCreated(onEvent));
    }
    if (api.onChatSessionStoreMetadataPatched) {
      unsubs.push(api.onChatSessionStoreMetadataPatched(onEvent));
    }
    if (api.onChatSessionStoreSessionDeleted) {
      unsubs.push(api.onChatSessionStoreSessionDeleted(onEvent));
    }

    return () => { unsubs.forEach((fn) => { try { fn(); } catch { /* ignore */ } }); };
  }, [refresh]);

  return { chats, refresh };
}
