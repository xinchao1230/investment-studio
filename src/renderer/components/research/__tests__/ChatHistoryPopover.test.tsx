/** @vitest-environment happy-dom */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ChatHistoryPopover } from '../ChatHistoryPopover';

const baseProps = {
  chats: [
    { chatSession_id: 's1', title: 'First chat',  updated_at: Date.now() - 3_600_000 },
    { chatSession_id: 's2', title: 'Second chat', updated_at: Date.now() - 86_400_000 },
  ],
  activeChatSessionId: 's1',
  targetCode: null,
  onSelectChat: vi.fn(),
  onRenameChat: vi.fn(),
  onDeleteChat: vi.fn(),
  onClose: vi.fn(),
};

describe('ChatHistoryPopover — basic rendering', () => {
  it('renders one row per chat', () => {
    render(<ChatHistoryPopover {...baseProps} />);
    expect(screen.getByText('First chat')).toBeInTheDocument();
    expect(screen.getByText('Second chat')).toBeInTheDocument();
  });

  it('marks the active chat row with aria-current="true"', () => {
    render(<ChatHistoryPopover {...baseProps} />);
    const activeRow = screen.getByText('First chat').closest('[role="option"]');
    expect(activeRow?.getAttribute('aria-current')).toBe('true');
  });

  it('marks non-active rows with aria-current="false"', () => {
    render(<ChatHistoryPopover {...baseProps} />);
    const inactiveRow = screen.getByText('Second chat').closest('[role="option"]');
    expect(inactiveRow?.getAttribute('aria-current')).toBe('false');
  });

  it('shows empty-state text when chats is []', () => {
    render(<ChatHistoryPopover {...baseProps} chats={[]} />);
    expect(screen.getByText(/no chats yet/i)).toBeInTheDocument();
  });

  it('renders "Untitled chat" when title is empty', () => {
    render(
      <ChatHistoryPopover
        {...baseProps}
        chats={[{ chatSession_id: 's3', title: '', updated_at: Date.now() }]}
        activeChatSessionId={null}
      />,
    );
    expect(screen.getByText(/untitled chat/i)).toBeInTheDocument();
  });

  it('renders "Untitled chat" when title is null', () => {
    render(
      <ChatHistoryPopover
        {...baseProps}
        chats={[{ chatSession_id: 's4', title: null, updated_at: Date.now() }]}
        activeChatSessionId={null}
      />,
    );
    expect(screen.getByText(/untitled chat/i)).toBeInTheDocument();
  });
});
