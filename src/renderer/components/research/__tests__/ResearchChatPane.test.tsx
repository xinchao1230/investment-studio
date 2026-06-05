/** @vitest-environment happy-dom */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ResearchChatPane } from '../ResearchChatPane';

vi.mock('../../chat/ChatView', () => ({ default: () => <div data-testid="chat-view" /> }));
vi.mock('../../../lib/chat/agentChatSessionCacheManager', () => ({
  useMessages: () => [],
  agentChatSessionCacheManager: {
    getChatSessionCache: () => null,
    setCurrentChatSessionId: vi.fn(),
  },
}));

const baseProps = {
  activeFileAbsPath: null,
  chats: [],
  activeChatSessionId: null,
  onNewChat: vi.fn(),
  onSelectChat: vi.fn(),
  onRenameChat: vi.fn(),
  onDeleteChat: vi.fn(),
};

describe('ResearchChatPane header — new chat button', () => {
  it('renders the new-chat icon and calls onNewChat when clicked', () => {
    const onNewChat = vi.fn();
    render(<ResearchChatPane {...baseProps} onNewChat={onNewChat} />);
    const btn = screen.getByRole('button', { name: /new chat/i });
    fireEvent.click(btn);
    expect(onNewChat).toHaveBeenCalledTimes(1);
  });

  it('does not render new-chat icon in collapsed mode', () => {
    render(<ResearchChatPane {...baseProps} collapsed onToggleCollapsed={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /new chat/i })).toBeNull();
  });
});
