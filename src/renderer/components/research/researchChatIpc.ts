/**
 * Research workspace: Target ↔ Chat binding IPC wrapper.
 *
 * Thin typed facade over `window.electronAPI.researchChat.*` so consumers
 * (sidebar, hooks) don't have to deal with `{ success, data, error }` envelopes.
 *
 * Backend: see `researchChat:*` handlers in `src/main/main.ts` and
 * `docs/research-target-chat-binding.md` for design context.
 */

export interface ResearchChatSessionMeta {
  chatSession_id: string;
  last_updated: string;
  title: string;
  /** `null` = global research scope, `string` = bound to that target code. */
  targetCode?: string | null;
  /** Cached target directory name (e.g. "海底捞_603993"). */
  targetDir?: string;
}

function api() {
  const a = (window as any).electronAPI?.researchChat;
  if (!a) {
    throw new Error('[researchChatIpc] electronAPI.researchChat is not available');
  }
  return a;
}

function unwrap<T>(res: { success: boolean; data?: T; error?: string }, action: string): T {
  if (!res?.success) {
    throw new Error(`[researchChatIpc] ${action} failed: ${res?.error ?? 'unknown error'}`);
  }
  return res.data as T;
}

/** List all chat sessions bound to the given target (null = global scope). */
export async function listByTarget(
  targetCode: string | null,
): Promise<{ chatId: string | null; sessions: ResearchChatSessionMeta[] }> {
  const res = await api().listByTarget(targetCode);
  const data = unwrap<{ chatId: string | null; sessions: ResearchChatSessionMeta[] }>(res, 'listByTarget');
  return data ?? { chatId: null, sessions: [] };
}

/**
 * List every chat session for the active chat config, regardless of
 * `targetCode`. Backend returns sorted by chatSession_id descending.
 * Used by the Ask tab's unified chat list.
 */
export async function listAll(): Promise<{
  chatId: string | null;
  sessions: ResearchChatSessionMeta[];
}> {
  const res = await api().listAll();
  const data = unwrap<{ chatId: string | null; sessions: ResearchChatSessionMeta[] }>(res, 'listAll');
  return data ?? { chatId: null, sessions: [] };
}

/** Create a new chat session bound to a target. Returns `{ chatId, chatSessionId }`. */
export async function createChat(
  targetCode: string | null,
  opts?: { title?: string; targetDir?: string },
): Promise<{ chatId: string; chatSessionId: string }> {
  const res = await api().create(targetCode, opts);
  return unwrap<{ chatId: string; chatSessionId: string }>(res, 'create');
}

/** Delete a chat session by id. */
export async function deleteChat(chatSessionId: string): Promise<void> {
  const res = await api().delete(chatSessionId);
  unwrap<void>(res, 'delete');
}

/** Rename a chat session (updates title in index + session file). */
export async function renameChat(chatSessionId: string, title: string): Promise<void> {
  const res = await api().rename(chatSessionId, title);
  unwrap<void>(res, 'rename');
}

/**
 * Release every chat session bound to the given target back to the
 * Stella pool (targetCode -> null). Used by deleteTarget so chats
 * survive the target removal as plain Stella history. Returns the
 * number of sessions unbound.
 */
export async function unbindTarget(targetCode: string): Promise<number> {
  const res = await api().unbindTarget(targetCode);
  const data = unwrap<{ unboundCount: number }>(res, 'unbindTarget');
  return data?.unboundCount ?? 0;
}

/** Record the most-recently-active chat session for a target. */
export async function setLastActive(targetCode: string | null, chatSessionId: string): Promise<void> {
  const res = await api().setLastActive(targetCode, chatSessionId);
  unwrap<void>(res, 'setLastActive');
}

/** Get the most-recently-active chat session id for a target, or null. */
export async function getLastActive(targetCode: string | null): Promise<string | null> {
  const res = await api().getLastActive(targetCode);
  return unwrap<string | null>(res, 'getLastActive') ?? null;
}

export const researchChatIpc = {
  listByTarget,
  listAll,
  create: createChat,
  delete: deleteChat,
  rename: renameChat,
  unbindTarget,
  setLastActive,
  getLastActive,
};
