/** @vitest-environment happy-dom */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ChatHistoryPopover } from '../ChatHistoryPopover';

const baseProps = {
  chats: [
    { chatSession_id: 's1', title: 'First chat',  last_updated: Date.now() - 3_600_000 },
    { chatSession_id: 's2', title: 'Second chat', last_updated: Date.now() - 86_400_000 },
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
        chats={[{ chatSession_id: 's3', title: '', last_updated: Date.now() }]}
        activeChatSessionId={null}
      />,
    );
    expect(screen.getByText(/untitled chat/i)).toBeInTheDocument();
  });

  it('renders "Untitled chat" when title is null', () => {
    render(
      <ChatHistoryPopover
        {...baseProps}
        chats={[{ chatSession_id: 's4', title: null, last_updated: Date.now() }]}
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

describe('ChatHistoryPopover — row actions', () => {
  it('renders rename and delete buttons per row', () => {
    render(<ChatHistoryPopover {...baseProps} />);
    expect(screen.getAllByRole('button', { name: /rename chat/i })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: /delete chat/i })).toHaveLength(2);
  });

  it('clicking rename swaps the row into an input pre-filled with the title', () => {
    render(<ChatHistoryPopover {...baseProps} />);
    fireEvent.click(screen.getAllByRole('button', { name: /rename chat/i })[0]);
    const input = screen.getByDisplayValue('First chat') as HTMLInputElement;
    expect(input.tagName.toLowerCase()).toBe('input');
  });

  it('rename Enter calls onRenameChat with trimmed value then exits edit mode', () => {
    const onRenameChat = vi.fn();
    render(<ChatHistoryPopover {...baseProps} onRenameChat={onRenameChat} />);
    fireEvent.click(screen.getAllByRole('button', { name: /rename chat/i })[0]);
    const input = screen.getByDisplayValue('First chat') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '  Renamed  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRenameChat).toHaveBeenCalledWith('s1', null, 'Renamed');
    // Edit exited: input is gone, title text returns
    expect(screen.queryByDisplayValue('Renamed')).toBeNull();
  });

  it('rename Enter does NOT call onRenameChat when trimmed value is empty', () => {
    const onRenameChat = vi.fn();
    render(<ChatHistoryPopover {...baseProps} onRenameChat={onRenameChat} />);
    fireEvent.click(screen.getAllByRole('button', { name: /rename chat/i })[0]);
    const input = screen.getByDisplayValue('First chat') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRenameChat).not.toHaveBeenCalled();
  });

  it('rename Escape cancels without calling onRenameChat', () => {
    const onRenameChat = vi.fn();
    render(<ChatHistoryPopover {...baseProps} onRenameChat={onRenameChat} />);
    fireEvent.click(screen.getAllByRole('button', { name: /rename chat/i })[0]);
    const input = screen.getByDisplayValue('First chat') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'should not commit' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onRenameChat).not.toHaveBeenCalled();
    expect(screen.queryByDisplayValue('should not commit')).toBeNull();
  });

  it('delete invokes onDeleteChat with no confirm dialog', () => {
    const onDeleteChat = vi.fn();
    render(<ChatHistoryPopover {...baseProps} onDeleteChat={onDeleteChat} />);
    fireEvent.click(screen.getAllByRole('button', { name: /delete chat/i })[0]);
    expect(onDeleteChat).toHaveBeenCalledWith('s1', null);
  });

  it('rename button click does NOT trigger row select+close', () => {
    const onSelectChat = vi.fn();
    const onClose = vi.fn();
    render(<ChatHistoryPopover {...baseProps} onSelectChat={onSelectChat} onClose={onClose} />);
    fireEvent.click(screen.getAllByRole('button', { name: /rename chat/i })[0]);
    expect(onSelectChat).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('delete button click does NOT trigger row select+close', () => {
    const onSelectChat = vi.fn();
    const onClose = vi.fn();
    render(<ChatHistoryPopover {...baseProps} onSelectChat={onSelectChat} onClose={onClose} />);
    fireEvent.click(screen.getAllByRole('button', { name: /delete chat/i })[0]);
    expect(onSelectChat).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('clicks inside the inline input do NOT trigger row select+close', () => {
    const onSelectChat = vi.fn();
    const onClose = vi.fn();
    render(<ChatHistoryPopover {...baseProps} onSelectChat={onSelectChat} onClose={onClose} />);
    fireEvent.click(screen.getAllByRole('button', { name: /rename chat/i })[0]);
    const input = screen.getByDisplayValue('First chat') as HTMLInputElement;
    fireEvent.click(input);
    expect(onSelectChat).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('ChatHistoryPopover — create entries (Workbench mode)', () => {
  it('renders both create rows when showCreateActions and selectedTargetName are set', () => {
    render(
      <ChatHistoryPopover
        {...baseProps}
        showCreateActions
        selectedTargetName="Tencent"
        onCreateTargetChat={vi.fn()}
        onCreateGlobalChat={vi.fn()}
      />,
    );
    expect(screen.getByText(/new chat for tencent/i)).toBeInTheDocument();
    expect(screen.getByText(/new global chat/i)).toBeInTheDocument();
  });

  it('omits the target create row when selectedTargetName is null', () => {
    render(
      <ChatHistoryPopover
        {...baseProps}
        showCreateActions
        selectedTargetName={null}
        onCreateTargetChat={vi.fn()}
        onCreateGlobalChat={vi.fn()}
      />,
    );
    expect(screen.queryByText(/new chat for/i)).toBeNull();
    expect(screen.getByText(/new global chat/i)).toBeInTheDocument();
  });

  it('omits the target create row when selectedTargetName is whitespace', () => {
    render(
      <ChatHistoryPopover
        {...baseProps}
        showCreateActions
        selectedTargetName="   "
        onCreateTargetChat={vi.fn()}
        onCreateGlobalChat={vi.fn()}
      />,
    );
    expect(screen.queryByText(/new chat for/i)).toBeNull();
  });

  it('renders no create rows by default (Stella mode parity)', () => {
    render(<ChatHistoryPopover {...baseProps} />);
    expect(screen.queryByText(/new chat for/i)).toBeNull();
    expect(screen.queryByText(/new global chat/i)).toBeNull();
  });

  it('clicking target create row calls handler then closes the popover', () => {
    const onCreateTargetChat = vi.fn();
    const onCreateGlobalChat = vi.fn();
    const onClose = vi.fn();
    render(
      <ChatHistoryPopover
        {...baseProps}
        showCreateActions
        selectedTargetName="Tencent"
        onCreateTargetChat={onCreateTargetChat}
        onCreateGlobalChat={onCreateGlobalChat}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByText(/new chat for tencent/i));
    expect(onCreateTargetChat).toHaveBeenCalledTimes(1);
    expect(onCreateGlobalChat).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clicking global create row calls handler then closes the popover', () => {
    const onCreateTargetChat = vi.fn();
    const onCreateGlobalChat = vi.fn();
    const onClose = vi.fn();
    render(
      <ChatHistoryPopover
        {...baseProps}
        showCreateActions
        selectedTargetName="Tencent"
        onCreateTargetChat={onCreateTargetChat}
        onCreateGlobalChat={onCreateGlobalChat}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByText(/new global chat/i));
    expect(onCreateGlobalChat).toHaveBeenCalledTimes(1);
    expect(onCreateTargetChat).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('long target name keeps the truncate class on the label span', () => {
    render(
      <ChatHistoryPopover
        {...baseProps}
        showCreateActions
        selectedTargetName="Bytedance Holdings Limited"
        onCreateTargetChat={vi.fn()}
        onCreateGlobalChat={vi.fn()}
      />,
    );
    const label = screen.getByText(/new chat for bytedance holdings limited/i);
    expect(label.className).toContain('truncate');
  });

  it('shows shortened empty-state copy when showCreateActions is true', () => {
    render(
      <ChatHistoryPopover
        {...baseProps}
        chats={[]}
        showCreateActions
        selectedTargetName="Tencent"
        onCreateTargetChat={vi.fn()}
        onCreateGlobalChat={vi.fn()}
      />,
    );
    expect(screen.getByText(/^no chats yet\.$/i)).toBeInTheDocument();
    expect(screen.queryByText(/click \+ to start one/i)).toBeNull();
  });
});
