import type { ChatSession } from '../lib/userDataADO/types/profile';
import type { ChatSessionFile } from '../lib/userDataADO/chatSessionFileOps';

export const DEFAULT_RESEARCH_CHAT_TITLE = 'New Chat';

export type ResearchChatSessionMetadata = ChatSession & {
  targetCode?: string | null;
  targetDir?: string | null;
};

function isEmptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length === 0;
}

function isDefaultTitle(title: unknown): boolean {
  return typeof title !== 'string' || title.trim() === '' || title.trim() === DEFAULT_RESEARCH_CHAT_TITLE;
}

export function isDefaultEmptyResearchChatSession(
  metadata: Pick<ChatSession, 'title' | 'schedulerJobId' | 'source' | 'starred'> | null | undefined,
  file: Pick<ChatSessionFile, 'title' | 'chat_history' | 'context_history'> | null | undefined,
): boolean {
  if (!file) return false;
  if (metadata?.schedulerJobId) return false;
  if (metadata?.starred) return false;
  if (metadata?.source && metadata.source.type !== 'local') return false;
  if (!isEmptyArray(file.chat_history) || !isEmptyArray(file.context_history)) return false;
  return isDefaultTitle(metadata?.title) && isDefaultTitle(file.title);
}

export function findReusableEmptyResearchChatSession(
  sessions: ResearchChatSessionMetadata[],
  targetCode: string | null,
  emptySessionIds: Set<string>,
): ResearchChatSessionMetadata | null {
  const reusable = sessions
    .filter((session) => {
      const sessionTargetCode = session.targetCode === undefined ? null : session.targetCode;
      return sessionTargetCode === targetCode && emptySessionIds.has(session.chatSession_id);
    })
    .sort((a, b) => String(b.chatSession_id || '').localeCompare(String(a.chatSession_id || '')));

  return reusable[0] ?? null;
}
