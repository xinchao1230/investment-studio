/** @vitest-environment happy-dom */
import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { ResearchChatPane } from '../ResearchChatPane';

const authMocks = vi.hoisted(() => ({
  useAuthContext: vi.fn<() => { user: { login: string; name: string } | null }>(
    () => ({ user: null }),
  ),
}));

vi.mock('../../chat/ChatView', () => ({ default: () => <div data-testid="chat-view" /> }));
vi.mock('../../auth/AuthProvider', () => ({
  useAuthContext: authMocks.useAuthContext,
}));
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

beforeEach(() => {
  vi.clearAllMocks();
  authMocks.useAuthContext.mockReturnValue({ user: null });
});

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

describe('ResearchChatPane header — active title', () => {
  it('shows the generic greeting when the active chat is untitled', () => {
    render(
      <ResearchChatPane
        {...baseProps}
        chats={[{ chatSession_id: 's-new', title: 'New Chat', last_updated: Date.now() }]}
        activeChatSessionId="s-new"
      />,
    );

    expect(screen.getByText('Hello, how can I help?')).toBeInTheDocument();
  });

  it('personalizes the untitled greeting for a GitHub user display name', () => {
    authMocks.useAuthContext.mockReturnValue({
      user: { login: 'MichaelFei87', name: 'Michael Fei' },
    });

    render(
      <ResearchChatPane
        {...baseProps}
        chats={[{ chatSession_id: 's-new', title: 'New Chat', last_updated: Date.now() }]}
        activeChatSessionId="s-new"
      />,
    );

    expect(screen.getByText('Hey Michael, how can I help?')).toBeInTheDocument();
  });

  it('shows the active chat title when it has one', () => {
    render(
      <ResearchChatPane
        {...baseProps}
        chats={[{ chatSession_id: 's1', title: '赛轮轮胎半年股份翻倍情景分析', last_updated: Date.now() }]}
        activeChatSessionId="s1"
      />,
    );

    expect(screen.getByText('赛轮轮胎半年股份翻倍情景分析')).toBeInTheDocument();
  });

  it('uses the resolved active title when the live chat is outside the visible list', () => {
    render(
      <ResearchChatPane
        {...baseProps}
        chats={[]}
        activeChatSessionId="target-bound-session"
        activeChatTitle="SH赛轮轮胎半年股份翻倍情景分析"
      />,
    );

    expect(screen.getByText('SH赛轮轮胎半年股份翻倍情景分析')).toBeInTheDocument();
  });
});

describe('ResearchChatPane header — history popover', () => {
  const chats = [{ chatSession_id: 's1', title: 'Hi', last_updated: Date.now() }];

  it('history button toggles the popover open/closed', () => {
    render(
      <ResearchChatPane
        {...baseProps}
        chats={chats}
        activeChatSessionId="s1"
      />,
    );
    expect(screen.queryByRole('listbox', { name: /chat history/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /chat history/i }));
    expect(screen.getByRole('listbox', { name: /chat history/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /chat history/i }));
    expect(screen.queryByRole('listbox', { name: /chat history/i })).toBeNull();
  });

  it('selecting a row closes the popover', () => {
    const onSelectChat = vi.fn();
    render(
      <ResearchChatPane
        {...baseProps}
        chats={chats}
        activeChatSessionId={null}
        onSelectChat={onSelectChat}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /chat history/i }));
    fireEvent.click(screen.getByText('Hi'));
    expect(onSelectChat).toHaveBeenCalledWith('s1');
    expect(screen.queryByRole('listbox', { name: /chat history/i })).toBeNull();
  });

  it('does not render history icon in collapsed mode', () => {
    render(
      <ResearchChatPane
        {...baseProps}
        chats={chats}
        activeChatSessionId={null}
        collapsed
        onToggleCollapsed={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /chat history/i })).toBeNull();
  });

  it('closes the popover when targetCode changes', () => {
    const { rerender } = render(
      <ResearchChatPane {...baseProps} chats={chats} activeChatSessionId="s1" targetCode="AAA" />,
    );
    fireEvent.click(screen.getByRole('button', { name: /chat history/i }));
    expect(screen.getByRole('listbox', { name: /chat history/i })).toBeInTheDocument();
    rerender(
      <ResearchChatPane {...baseProps} chats={chats} activeChatSessionId="s1" targetCode="BBB" />,
    );
    expect(screen.queryByRole('listbox', { name: /chat history/i })).toBeNull();
  });
});
