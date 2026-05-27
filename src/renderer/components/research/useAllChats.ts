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

  // Mirror useStellaChats / useTargetChats: incrementally patch in place
  // when main process pushes session updates (title generation, rename,
  // target rebinding, etc.). On structural changes (create/delete) we
  // fall back to a full re-list.
  useEffect(() => {
    const api: any = (window as any).electronAPI;
    const off = api?.profile?.onChatSessionUpdated?.((data: { chatId?: string; sessions: any[] }) => {
      const incoming = data?.sessions;
      if (!Array.isArray(incoming)) return;
      // Ignore notifications for other chat configs — without this guard
      // a sibling chat's empty-state event would wipe our list.
      const activeChatId = chatIdRef.current;
      if (activeChatId && data?.chatId && data.chatId !== activeChatId) return;

      setChats((prev) => {
        // Build fresh map of incoming sessions for the active chat.
        // The payload is the full session list for this chat config,
        // so we can swap to it wholesale rather than patching — but
        // we preserve our stable ascending sort by chatSession_id
        // (oldest first, mirroring the backend's listAll ordering).
        const sorted = [...incoming].sort((a: any, b: any) =>
          String(a.chatSession_id || '').localeCompare(String(b.chatSession_id || '')),
        );

        // No previous list (first event after mount race) — just adopt.
        if (!prev) return sorted as ResearchChatSessionMeta[];

        // Cheap no-op check: same length + same ids in order + same
        // titles + same last_updated + same targetCode → bail early
        // to avoid re-rendering the sidebar mid-stream.
        if (prev.length === sorted.length) {
          let identical = true;
          for (let i = 0; i < prev.length; i += 1) {
            const a = prev[i];
            const b = sorted[i] as any;
            if (
              a.chatSession_id !== b.chatSession_id ||
              a.title !== b.title ||
              a.last_updated !== b.last_updated ||
              (a.targetCode ?? null) !== (b.targetCode ?? null)
            ) {
              identical = false;
              break;
            }
          }
          if (identical) return prev;
        }
        return sorted as ResearchChatSessionMeta[];
      });
    });
    return () => { try { off?.(); } catch { /* ignore */ } };
  }, []);

  return { chats, refresh };
}
