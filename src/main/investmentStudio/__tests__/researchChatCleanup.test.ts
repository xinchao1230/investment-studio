import { describe, expect, it } from 'vitest';

import type { ChatSessionFile } from '../../lib/userDataADO/chatSessionFileOps';
import {
  findReusableEmptyResearchChatSession,
  isDefaultEmptyResearchChatSession,
  type ResearchChatSessionMetadata,
} from '../researchChatCleanup';

type TestMessage = ChatSessionFile['chat_history'][number];

function metadata(overrides: Partial<ResearchChatSessionMetadata> = {}): ResearchChatSessionMetadata {
  return {
    chatSession_id: 'chatSession_20260608120000_test_abc',
    last_updated: '2026-06-08T12:00:00.000Z',
    title: 'New Chat',
    ...overrides,
  };
}

function file(overrides: Partial<ChatSessionFile> = {}): ChatSessionFile {
  return {
    chatSession_id: 'chatSession_20260608120000_test_abc',
    last_updated: '2026-06-08T12:00:00.000Z',
    title: 'New Chat',
    chat_history: [],
    context_history: [],
    ...overrides,
  };
}

describe('research chat empty-session cleanup', () => {
  it('treats default-title sessions with no chat or context messages as cleanup candidates', () => {
    expect(isDefaultEmptyResearchChatSession(metadata(), file())).toBe(true);
    expect(isDefaultEmptyResearchChatSession(metadata({ title: '' }), file({ title: '  ' }))).toBe(true);
  });

  it('preserves empty sessions that the user renamed', () => {
    expect(isDefaultEmptyResearchChatSession(metadata({ title: 'My thesis' }), file())).toBe(false);
    expect(isDefaultEmptyResearchChatSession(metadata(), file({ title: 'My thesis' }))).toBe(false);
  });

  it('preserves sessions with any persisted content', () => {
    const message = { id: 'm1' } as TestMessage;
    expect(isDefaultEmptyResearchChatSession(metadata(), file({ chat_history: [message] }))).toBe(false);
    expect(isDefaultEmptyResearchChatSession(metadata(), file({ context_history: [message] }))).toBe(false);
  });

  it('preserves protected non-local sessions even when they are empty', () => {
    expect(isDefaultEmptyResearchChatSession(metadata({ starred: true }), file())).toBe(false);
    expect(isDefaultEmptyResearchChatSession(metadata({ schedulerJobId: 'job-1' }), file())).toBe(false);
    expect(isDefaultEmptyResearchChatSession(metadata({ source: { type: 'remote', channel: 'remote' } }), file())).toBe(false);
  });

  it('finds the newest reusable empty session in the requested scope', () => {
    const sessions: ResearchChatSessionMetadata[] = [
      metadata({ chatSession_id: 'chatSession_20260608110000_test_old' }),
      metadata({ chatSession_id: 'chatSession_20260608130000_test_global', targetCode: null }),
      metadata({ chatSession_id: 'chatSession_20260608140000_test_target', targetCode: '601058.SH' }),
    ];
    const emptyIds = new Set(sessions.map((session) => session.chatSession_id));

    expect(findReusableEmptyResearchChatSession(sessions, null, emptyIds)?.chatSession_id)
      .toBe('chatSession_20260608130000_test_global');
    expect(findReusableEmptyResearchChatSession(sessions, '601058.SH', emptyIds)?.chatSession_id)
      .toBe('chatSession_20260608140000_test_target');
  });
});
