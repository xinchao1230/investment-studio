/** @vitest-environment happy-dom */
import { render, screen, fireEvent } from '@testing-library/react';
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

describe('ChatHistoryPopover — interactions', () => {
  it('row click calls onSelectChat with the right id then onClose', () => {
    const onSelectChat = vi.fn();
    const onClose = vi.fn();
    render(<ChatHistoryPopover {...baseProps} onSelectChat={onSelectChat} onClose={onClose} />);
    fireEvent.click(screen.getByText('First chat'));
    expect(onSelectChat).toHaveBeenCalledWith('s1');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape key calls onClose', () => {
    const onClose = vi.fn();
    render(<ChatHistoryPopover {...baseProps} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('mousedown outside calls onClose', () => {
    const onClose = vi.fn();
    render(
      <div>
        <button data-testid="outside">outside</button>
        <ChatHistoryPopover {...baseProps} onClose={onClose} />
      </div>,
    );
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('mousedown inside the popover does NOT call onClose', () => {
    const onClose = vi.fn();
    render(<ChatHistoryPopover {...baseProps} onClose={onClose} />);
    fireEvent.mouseDown(screen.getByText('First chat'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('removes event listeners on unmount', () => {
    const onClose = vi.fn();
    const { unmount } = render(<ChatHistoryPopover {...baseProps} onClose={onClose} />);
    unmount();
    // After unmount, Esc should NOT fire onClose (listener removed)
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.mouseDown(document.body);
    expect(onClose).not.toHaveBeenCalled();
  });
});
