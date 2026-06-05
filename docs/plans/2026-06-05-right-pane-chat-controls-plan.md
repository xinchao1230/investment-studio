# Right-Pane Chat Controls Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `+ New chat` and `Chat history` controls to the research workspace right-pane chat header so the user can create and switch chats without leaving the chat pane.

**Architecture:** Renderer-only. `ResearchPage` (data owner) gains two dispatcher handlers and a `contextualChatList` memo that pick between `useTargetChats` and `useStellaChats` based on `selectedCode`. `ResearchChatPane` gets two new header icons; the history icon opens a new lightweight `ChatHistoryPopover` (absolute-positioned, click-outside / Esc to close) listing the contextual chats with inline rename + delete.

**Tech Stack:** React 18, TypeScript 5, lucide-react icons, vitest + Testing Library, existing `useTargetChats` / `useStellaChats` hooks, existing `agentChatSessionCacheManager.setCurrentChatSessionId` as the chat-switch funnel.

**Design doc:** [docs/plans/2026-06-05-right-pane-chat-controls-design.md](2026-06-05-right-pane-chat-controls-design.md)

---

## Task 1: Add `contextualChatList` derivation + 2 handlers in ResearchPage

**Files:**
- Modify: `src/renderer/components/research/ResearchPage.tsx` (add after the existing `handleNewChat` block around L775)

**Step 1: Read current state to confirm hook surface**

Run:
```pwsh
Select-String -Path src/renderer/components/research/useTargetChats.ts -Pattern "createChatForTarget|selectChatForTarget|chatsByCode" -SimpleMatch | Select-Object -First 8
Select-String -Path src/renderer/components/research/useStellaChats.ts  -Pattern "createChat|selectChat|chats" -SimpleMatch | Select-Object -First 8
```
Expected: confirm signatures match the design (`createChatForTarget(code, target)`, `selectChatForTarget(code, target, sessionId?)`, `stella.createChat()`, `stella.selectChat(sessionId)`, `targetChats.chatsByCode[code]`, `stella.chats`).

**Step 2: Add the derivation + handlers**

Insert after `handleNewChat` (search for `const handleNewChat = useCallback`) and before `handleDeleteChat`:

```ts
// Right-pane (compact chat) dispatchers. Pick between target-bound and
// Stella chat surfaces based on the current sidebar selection so the
// "+ New chat" / history popover in ResearchChatPane stay context-aware.
const handleNewChatFromPane = useCallback(async () => {
  const code = selectedCodeRef.current;
  if (code) {
    const target = targetsRef.current.find((t) => t.stock_code === code);
    await targetChats.createChatForTarget(code, target);
  } else {
    await stella.createChat();
  }
  void allChats.refresh();
}, [targetChats, stella, allChats]);

const handleSelectChatFromPane = useCallback(
  async (chatSessionId: string) => {
    const code = selectedCodeRef.current;
    if (code) {
      const target = targetsRef.current.find((t) => t.stock_code === code);
      await targetChats.selectChatForTarget(code, target, chatSessionId);
    } else {
      await stella.selectChat(chatSessionId);
    }
  },
  [targetChats, stella],
);

const contextualChatList = useMemo(() => {
  if (selectedCode) {
    return targetChats.chatsByCode[selectedCode] ?? [];
  }
  return stella.chats;
}, [selectedCode, targetChats.chatsByCode, stella.chats]);
```

**Step 3: Verify TypeScript compiles**

Run:
```pwsh
npx tsc -p tsconfig.renderer.json --noEmit 2>&1 | Select-Object -Last 5
"renderer_tsc=$LASTEXITCODE"
```
Expected: `renderer_tsc=0`.

**Step 4: Commit**

```pwsh
git add src/renderer/components/research/ResearchPage.tsx
git commit -m "feat(research): add right-pane chat dispatchers + contextual list"
```

---

## Task 2: Extend ResearchChatPane props (no UI yet) + render `+ New chat` icon

**Files:**
- Modify: `src/renderer/components/research/ResearchChatPane.tsx`
- Modify: `src/renderer/components/research/ResearchPage.tsx` (pass new props at the `<ResearchChatPane …>` site around L1597)

**Step 1: Write the failing test**

Create or extend `src/renderer/components/research/__tests__/ResearchChatPane.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ResearchChatPane } from '../ResearchChatPane';

vi.mock('../../chat/ChatView', () => ({ default: () => <div data-testid="chat-view" /> }));
vi.mock('../../../lib/chat/agentChatSessionCacheManager', () => ({
  useMessages: () => [],
}));

describe('ResearchChatPane header — new chat button', () => {
  it('renders the new-chat icon and calls onNewChat when clicked', () => {
    const onNewChat = vi.fn();
    render(
      <ResearchChatPane
        activeFileAbsPath={null}
        chats={[]}
        activeChatSessionId={null}
        onNewChat={onNewChat}
        onSelectChat={vi.fn()}
        onRenameChat={vi.fn()}
        onDeleteChat={vi.fn()}
      />,
    );
    const btn = screen.getByRole('button', { name: /new chat/i });
    fireEvent.click(btn);
    expect(onNewChat).toHaveBeenCalledTimes(1);
  });

  it('does not render new-chat icon in collapsed mode', () => {
    render(
      <ResearchChatPane
        activeFileAbsPath={null}
        collapsed
        onToggleCollapsed={vi.fn()}
        chats={[]}
        activeChatSessionId={null}
        onNewChat={vi.fn()}
        onSelectChat={vi.fn()}
        onRenameChat={vi.fn()}
        onDeleteChat={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /new chat/i })).toBeNull();
  });
});
```

**Step 2: Run it to confirm it fails**

Run:
```pwsh
npx vitest run src/renderer/components/research/__tests__/ResearchChatPane.test.tsx --reporter=default 2>&1 | Select-Object -Last 15
```
Expected: FAIL — props `chats` / `onNewChat` / etc. not on `ResearchChatPaneProps`.

**Step 3: Extend props + add the button**

In `ResearchChatPane.tsx`, add to imports:
```ts
import { PanelRightClose, PanelRightOpen, MessageSquarePlus, ... } from 'lucide-react';
import type { ActiveChat } from './useTargetChats'; // or wherever ChatSummary type lives
```

Search for `interface ResearchChatPaneProps` and add to the existing interface:

```ts
/** Chats to show in the history popover (context-aware list from caller). */
chats: Array<{ chatSession_id: string; title?: string | null; updated_at?: number | string }>;
/** Currently-live chat session id (for active-row highlight). */
activeChatSessionId: string | null;
/** Start a new chat in the current context (target or Stella). */
onNewChat: () => void | Promise<void>;
/** Switch to a historical chat session. */
onSelectChat: (chatSessionId: string) => void | Promise<void>;
/** Rename a chat. `targetCode` is null for Stella chats. */
onRenameChat: (chatSessionId: string, targetCode: string | null, title: string) => void | Promise<void>;
/** Delete a chat. `targetCode` is null for Stella chats. */
onDeleteChat: (chatSessionId: string, targetCode: string | null) => void | Promise<void>;
```

(Use the exact type the existing `handleRenameAnyChat` / `handleDeleteAnyChat` in `ResearchPage.tsx` already expect — match the signatures verbatim.)

Inside the component, destructure the new props. In the header JSX (before `{onToggleCollapsed && (...)}`), add:

```tsx
<button
  type="button"
  className="rw-side-icon-btn flex-shrink-0"
  title="New chat"
  aria-label="New chat"
  onClick={() => { void onNewChat(); }}
>
  <MessageSquarePlus size={14} />
</button>
```

Adjust the existing collapse button container so the new icons are left-aligned and the collapse button keeps its `ml-auto`.

**Step 4: Wire up ResearchPage props at the `<ResearchChatPane>` call site**

```tsx
<ResearchChatPane
  /* existing props */
  chats={contextualChatList}
  activeChatSessionId={liveChatSessionId}
  onNewChat={handleNewChatFromPane}
  onSelectChat={handleSelectChatFromPane}
  onRenameChat={handleRenameAnyChat}
  onDeleteChat={handleDeleteAnyChat}
/>
```

**Step 5: Run tests, expect PASS**

Run:
```pwsh
npx vitest run src/renderer/components/research/__tests__/ResearchChatPane.test.tsx --reporter=default 2>&1 | Select-Object -Last 15
npx tsc -p tsconfig.renderer.json --noEmit 2>&1 | Select-Object -Last 5
"renderer_tsc=$LASTEXITCODE"
```
Expected: tests PASS; `renderer_tsc=0`.

**Step 6: Commit**

```pwsh
git add src/renderer/components/research/ResearchChatPane.tsx src/renderer/components/research/ResearchPage.tsx src/renderer/components/research/__tests__/ResearchChatPane.test.tsx
git commit -m "feat(research): add new-chat icon to right-pane header"
```

---

## Task 3: Create `ChatHistoryPopover` scaffold (list + empty state + active highlight)

**Files:**
- Create: `src/renderer/components/research/ChatHistoryPopover.tsx`
- Create: `src/renderer/components/research/__tests__/ChatHistoryPopover.test.tsx`

**Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ChatHistoryPopover } from '../ChatHistoryPopover';

const props = {
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
    render(<ChatHistoryPopover {...props} />);
    expect(screen.getByText('First chat')).toBeInTheDocument();
    expect(screen.getByText('Second chat')).toBeInTheDocument();
  });

  it('marks the active chat row with aria-current="true"', () => {
    render(<ChatHistoryPopover {...props} />);
    const activeRow = screen.getByText('First chat').closest('[role="option"]');
    expect(activeRow?.getAttribute('aria-current')).toBe('true');
  });

  it('shows empty-state text when chats is []', () => {
    render(<ChatHistoryPopover {...props} chats={[]} />);
    expect(screen.getByText(/no chats yet/i)).toBeInTheDocument();
  });

  it('renders "Untitled chat" when title is empty', () => {
    render(
      <ChatHistoryPopover
        {...props}
        chats={[{ chatSession_id: 's3', title: '', updated_at: Date.now() }]}
        activeChatSessionId={null}
      />,
    );
    expect(screen.getByText(/untitled chat/i)).toBeInTheDocument();
  });
});
```

**Step 2: Run to confirm it fails**

Run:
```pwsh
npx vitest run src/renderer/components/research/__tests__/ChatHistoryPopover.test.tsx --reporter=default 2>&1 | Select-Object -Last 15
```
Expected: FAIL — file does not exist.

**Step 3: Create the component (minimal scaffold for rendering only)**

```tsx
import React, { useRef, useEffect } from 'react';

export interface ChatHistoryPopoverChat {
  chatSession_id: string;
  title?: string | null;
  updated_at?: number | string;
}

export interface ChatHistoryPopoverProps {
  chats: ChatHistoryPopoverChat[];
  activeChatSessionId: string | null;
  /** Currently-selected target code (null for Stella context). Passed back
   * to onRenameChat / onDeleteChat so the parent routes to the right hook. */
  targetCode: string | null;
  onSelectChat: (chatSessionId: string) => void | Promise<void>;
  onRenameChat: (chatSessionId: string, targetCode: string | null, title: string) => void | Promise<void>;
  onDeleteChat: (chatSessionId: string, targetCode: string | null) => void | Promise<void>;
  onClose: () => void;
}

function formatRelative(ts?: number | string): string {
  if (!ts) return '';
  const n = typeof ts === 'string' ? new Date(ts).getTime() : ts;
  if (!Number.isFinite(n)) return '';
  const delta = Date.now() - n;
  const min = Math.round(delta / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(n).toLocaleDateString();
}

export const ChatHistoryPopover: React.FC<ChatHistoryPopoverProps> = ({
  chats,
  activeChatSessionId,
  onClose: _onClose,
}) => {
  const ref = useRef<HTMLDivElement>(null);

  // (close-on-outside + Esc are added in Task 4)
  useEffect(() => { /* no-op until Task 4 */ }, []);

  return (
    <div
      ref={ref}
      role="listbox"
      aria-label="Chat history"
      className="absolute z-50 rounded-md border shadow-lg"
      style={{
        top: 40,
        left: 36,
        width: 'min(320px, calc(100% - 24px))',
        maxHeight: '60vh',
        overflowY: 'auto',
        background: 'var(--rw-bg-popover, white)',
        borderColor: 'var(--rw-border, rgba(0,0,0,0.1))',
      }}
    >
      {chats.length === 0 ? (
        <div className="px-3 py-4 text-xs text-gray-500">
          No chats yet. Click + to start one.
        </div>
      ) : (
        chats.map((c) => {
          const isActive = c.chatSession_id === activeChatSessionId;
          return (
            <div
              key={c.chatSession_id}
              role="option"
              aria-selected={isActive}
              aria-current={isActive ? 'true' : 'false'}
              className="px-3 py-2 text-sm cursor-pointer hover:bg-gray-50"
            >
              <div className="truncate">
                {c.title?.trim() ? c.title : 'Untitled chat'}
              </div>
              <div className="text-xs text-gray-500">
                {formatRelative(c.updated_at)}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
};
```

**Step 4: Run tests to verify PASS**

Run:
```pwsh
npx vitest run src/renderer/components/research/__tests__/ChatHistoryPopover.test.tsx --reporter=default 2>&1 | Select-Object -Last 15
npx tsc -p tsconfig.renderer.json --noEmit 2>&1 | Select-Object -Last 5
"renderer_tsc=$LASTEXITCODE"
```
Expected: all 4 tests PASS; `renderer_tsc=0`.

**Step 5: Commit**

```pwsh
git add src/renderer/components/research/ChatHistoryPopover.tsx src/renderer/components/research/__tests__/ChatHistoryPopover.test.tsx
git commit -m "feat(research): add ChatHistoryPopover scaffold (list + empty state)"
```

---

## Task 4: Popover interactions — row click, click-outside, Esc

**Files:**
- Modify: `src/renderer/components/research/ChatHistoryPopover.tsx`
- Modify: `src/renderer/components/research/__tests__/ChatHistoryPopover.test.tsx`

**Step 1: Add failing tests**

Append to the test file:

```tsx
describe('ChatHistoryPopover — interactions', () => {
  it('row click calls onSelectChat with the right id and onClose', async () => {
    const onSelectChat = vi.fn();
    const onClose = vi.fn();
    render(<ChatHistoryPopover {...props} onSelectChat={onSelectChat} onClose={onClose} />);
    fireEvent.click(screen.getByText('First chat'));
    expect(onSelectChat).toHaveBeenCalledWith('s1');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Esc key calls onClose', () => {
    const onClose = vi.fn();
    render(<ChatHistoryPopover {...props} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('mousedown outside calls onClose', () => {
    const onClose = vi.fn();
    render(
      <>
        <button data-testid="outside">outside</button>
        <ChatHistoryPopover {...props} onClose={onClose} />
      </>,
    );
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

Don't forget to add the `fireEvent` import if not already present.

**Step 2: Run to confirm fail**

Run:
```pwsh
npx vitest run src/renderer/components/research/__tests__/ChatHistoryPopover.test.tsx --reporter=default 2>&1 | Select-Object -Last 15
```
Expected: 3 new tests FAIL.

**Step 3: Implement interactions**

Wire `onClick` on rows and add the close-on-outside / Esc effect:

```tsx
useEffect(() => {
  const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
  const handleMouse = (e: MouseEvent) => {
    if (!ref.current?.contains(e.target as Node)) onClose();
  };
  window.addEventListener('keydown', handleKey);
  window.addEventListener('mousedown', handleMouse, true);
  return () => {
    window.removeEventListener('keydown', handleKey);
    window.removeEventListener('mousedown', handleMouse, true);
  };
}, [onClose]);
```

And on the row `<div>`:

```tsx
onClick={() => { void onSelectChat(c.chatSession_id); onClose(); }}
```

**Step 4: Run tests, expect PASS**

Run:
```pwsh
npx vitest run src/renderer/components/research/__tests__/ChatHistoryPopover.test.tsx --reporter=default 2>&1 | Select-Object -Last 15
```
Expected: all 7 tests PASS.

**Step 5: Commit**

```pwsh
git add src/renderer/components/research/ChatHistoryPopover.tsx src/renderer/components/research/__tests__/ChatHistoryPopover.test.tsx
git commit -m "feat(research): wire popover row click + click-outside / Esc to close"
```

---

## Task 5: Popover row actions — rename inline input + delete

**Files:**
- Modify: `src/renderer/components/research/ChatHistoryPopover.tsx`
- Modify: `src/renderer/components/research/__tests__/ChatHistoryPopover.test.tsx`

**Step 1: Add failing tests**

```tsx
import { Pencil, Trash2 } from 'lucide-react'; // not strictly needed in test; just confirm icons via aria-label

describe('ChatHistoryPopover — row actions', () => {
  it('renders rename and delete buttons per row', () => {
    render(<ChatHistoryPopover {...props} />);
    expect(screen.getAllByRole('button', { name: /rename chat/i })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: /delete chat/i })).toHaveLength(2);
  });

  it('clicking rename swaps the title to an input pre-filled with the title', () => {
    render(<ChatHistoryPopover {...props} />);
    fireEvent.click(screen.getAllByRole('button', { name: /rename chat/i })[0]);
    const input = screen.getByDisplayValue('First chat');
    expect(input.tagName.toLowerCase()).toBe('input');
  });

  it('rename Enter calls onRenameChat with new title; Esc cancels', () => {
    const onRenameChat = vi.fn();
    render(<ChatHistoryPopover {...props} onRenameChat={onRenameChat} />);
    fireEvent.click(screen.getAllByRole('button', { name: /rename chat/i })[0]);
    const input = screen.getByDisplayValue('First chat') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Renamed' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRenameChat).toHaveBeenCalledWith('s1', null, 'Renamed');

    // Esc cancels — second row
    fireEvent.click(screen.getAllByRole('button', { name: /rename chat/i })[1]);
    const input2 = screen.getByDisplayValue('Second chat') as HTMLInputElement;
    fireEvent.change(input2, { target: { value: 'should not commit' } });
    fireEvent.keyDown(input2, { key: 'Escape' });
    expect(onRenameChat).toHaveBeenCalledTimes(1); // unchanged
  });

  it('delete invokes onDeleteChat without a confirm dialog', () => {
    const onDeleteChat = vi.fn();
    render(<ChatHistoryPopover {...props} onDeleteChat={onDeleteChat} />);
    fireEvent.click(screen.getAllByRole('button', { name: /delete chat/i })[0]);
    expect(onDeleteChat).toHaveBeenCalledWith('s1', null);
  });
});
```

**Step 2: Run, expect FAIL**

Run:
```pwsh
npx vitest run src/renderer/components/research/__tests__/ChatHistoryPopover.test.tsx --reporter=default 2>&1 | Select-Object -Last 20
```
Expected: 4 new tests FAIL.

**Step 3: Implement row actions**

Add `useState<{ id: string; value: string } | null>(null)` for `renamingRow`. In the row JSX, conditionally render either the title text + buttons or the input. Stop propagation on action button `onClick` so they don't also trigger row select.

Sketch (insert inside the `chats.map` callback, replacing the inner `<div>` content):

```tsx
const isRenaming = renamingRow?.id === c.chatSession_id;
return (
  <div key={...} role="option" aria-selected={isActive} aria-current={...}
    className="group flex items-start justify-between px-3 py-2 text-sm cursor-pointer hover:bg-gray-50"
    onClick={() => {
      if (isRenaming) return;
      void onSelectChat(c.chatSession_id);
      onClose();
    }}
  >
    <div className="min-w-0 flex-1">
      {isRenaming ? (
        <input
          autoFocus
          className="w-full px-1 py-0.5 text-sm border rounded"
          value={renamingRow!.value}
          onChange={(e) => setRenamingRow({ id: c.chatSession_id, value: e.target.value })}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const newTitle = renamingRow!.value.trim();
              if (newTitle) void onRenameChat(c.chatSession_id, targetCode, newTitle);
              setRenamingRow(null);
            } else if (e.key === 'Escape') {
              setRenamingRow(null);
            }
          }}
        />
      ) : (
        <>
          <div className="truncate">{c.title?.trim() ? c.title : 'Untitled chat'}</div>
          <div className="text-xs text-gray-500">{formatRelative(c.updated_at)}</div>
        </>
      )}
    </div>
    {!isRenaming && (
      <div className="ml-2 flex items-center gap-1 opacity-0 group-hover:opacity-100">
        <button
          type="button"
          className="rw-side-icon-btn"
          title="Rename chat"
          aria-label="Rename chat"
          onClick={(e) => {
            e.stopPropagation();
            setRenamingRow({ id: c.chatSession_id, value: c.title ?? '' });
          }}
        >
          <Pencil size={12} />
        </button>
        <button
          type="button"
          className="rw-side-icon-btn"
          title="Delete chat"
          aria-label="Delete chat"
          onClick={(e) => {
            e.stopPropagation();
            void onDeleteChat(c.chatSession_id, targetCode);
          }}
        >
          <Trash2 size={12} />
        </button>
      </div>
    )}
  </div>
);
```

Don't forget to import `Pencil, Trash2` from `lucide-react`.

**Step 4: Run tests, expect PASS**

Run:
```pwsh
npx vitest run src/renderer/components/research/__tests__/ChatHistoryPopover.test.tsx --reporter=default 2>&1 | Select-Object -Last 20
```
Expected: all 11 tests PASS.

**Step 5: Commit**

```pwsh
git add src/renderer/components/research/ChatHistoryPopover.tsx src/renderer/components/research/__tests__/ChatHistoryPopover.test.tsx
git commit -m "feat(research): popover row rename (inline input) + delete"
```

---

## Task 6: Mount the popover in ResearchChatPane (history icon)

**Files:**
- Modify: `src/renderer/components/research/ResearchChatPane.tsx`
- Modify: `src/renderer/components/research/__tests__/ResearchChatPane.test.tsx`

**Step 1: Add failing tests**

Append to `ResearchChatPane.test.tsx`:

```tsx
describe('ResearchChatPane header — history popover', () => {
  const chats = [{ chatSession_id: 's1', title: 'Hi', updated_at: Date.now() }];

  it('history button toggles the popover open/closed', () => {
    render(
      <ResearchChatPane
        activeFileAbsPath={null}
        chats={chats}
        activeChatSessionId="s1"
        onNewChat={vi.fn()}
        onSelectChat={vi.fn()}
        onRenameChat={vi.fn()}
        onDeleteChat={vi.fn()}
      />,
    );
    expect(screen.queryByRole('listbox', { name: /chat history/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /chat history/i }));
    expect(screen.getByRole('listbox', { name: /chat history/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /chat history/i }));
    expect(screen.queryByRole('listbox', { name: /chat history/i })).toBeNull();
  });

  it('selecting a row closes the popover', () => {
    render(
      <ResearchChatPane
        activeFileAbsPath={null}
        chats={chats}
        activeChatSessionId={null}
        onNewChat={vi.fn()}
        onSelectChat={vi.fn()}
        onRenameChat={vi.fn()}
        onDeleteChat={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /chat history/i }));
    fireEvent.click(screen.getByText('Hi'));
    expect(screen.queryByRole('listbox', { name: /chat history/i })).toBeNull();
  });
});
```

**Step 2: Run, expect FAIL**

Run:
```pwsh
npx vitest run src/renderer/components/research/__tests__/ResearchChatPane.test.tsx --reporter=default 2>&1 | Select-Object -Last 20
```
Expected: new tests FAIL.

**Step 3: Implement**

In `ResearchChatPane.tsx`:
1. Import: `MessagesSquare` from lucide; `ChatHistoryPopover, type ChatHistoryPopoverChat` from `./ChatHistoryPopover`.
2. Add `const [historyOpen, setHistoryOpen] = useState(false);`.
3. After the `+` button, add the history button:

```tsx
<button
  type="button"
  className="rw-side-icon-btn flex-shrink-0"
  title="Chat history"
  aria-label="Chat history"
  onClick={() => setHistoryOpen((v) => !v)}
>
  <MessagesSquare size={14} />
</button>
```

4. In the same `<aside>` (top-level), append after the `<header>` (still inside aside, before the chat body) so it overlays:

```tsx
{historyOpen && (
  <ChatHistoryPopover
    chats={chats}
    activeChatSessionId={activeChatSessionId}
    targetCode={targetCode ?? null}
    onSelectChat={onSelectChat}
    onRenameChat={onRenameChat}
    onDeleteChat={onDeleteChat}
    onClose={() => setHistoryOpen(false)}
  />
)}
```

5. Use `useEffect` to auto-close when `targetCode` changes:

```tsx
useEffect(() => { setHistoryOpen(false); }, [targetCode]);
```

**Step 4: Run tests, expect PASS**

Run:
```pwsh
npx vitest run src/renderer/components/research/__tests__/ResearchChatPane.test.tsx --reporter=default 2>&1 | Select-Object -Last 20
npx tsc -p tsconfig.renderer.json --noEmit 2>&1 | Select-Object -Last 5
"renderer_tsc=$LASTEXITCODE"
```
Expected: tests PASS; `renderer_tsc=0`.

**Step 5: Commit**

```pwsh
git add src/renderer/components/research/ResearchChatPane.tsx src/renderer/components/research/__tests__/ResearchChatPane.test.tsx
git commit -m "feat(research): mount ChatHistoryPopover behind new history icon"
```

---

## Task 7: Verify ResearchPage `contextualChatList` derivation under both contexts

**Files:**
- Modify: existing `src/renderer/components/research/__tests__/ResearchPage*.test.tsx` (whichever covers the chat-pane wiring; if no suitable file exists, add a focused `ResearchPage.chatContext.test.tsx`)

**Step 1: Write failing tests**

If no chat-context test exists, add a focused one (mock heavy dependencies). The tests should verify that `<ResearchChatPane>` receives:
- `chats` derived from `targetChats.chatsByCode[selectedCode]` when a target is selected
- `chats` derived from `stella.chats` when no target is selected

Sketch (adapt mocks to existing patterns in `ResearchPage*.test.tsx` files):

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../ResearchChatPane', () => ({
  ResearchChatPane: ({ chats }: any) => (
    <div data-testid="pane-chats">{JSON.stringify(chats.map((c: any) => c.chatSession_id))}</div>
  ),
}));
// ...other necessary mocks (usePortfolio, useStellaChats, useTargetChats, etc.)

it('passes target chats when a target is selected', () => {
  // arrange: mocks set selectedCode='AAA', targetChats.chatsByCode={ AAA: [{chatSession_id:'t1'}] }
  // render <ResearchPage />
  expect(screen.getByTestId('pane-chats').textContent).toContain('t1');
});

it('passes stella chats when no target is selected', () => {
  // arrange: selectedCode=null, stella.chats=[{chatSession_id:'st1'}]
  expect(screen.getByTestId('pane-chats').textContent).toContain('st1');
});
```

**Step 2: Run, expect FAIL (or already PASS if the derivation from Task 1 is correct and the test is set up right)**

Run:
```pwsh
npx vitest run src/renderer/components/research/__tests__/ResearchPage --reporter=default 2>&1 | Select-Object -Last 20
```

**Step 3: If failing, fix the test setup (the derivation itself was added in Task 1 and shouldn't need changes). If you do change `ResearchPage.tsx`, justify the change in the commit.**

**Step 4: Run again, expect PASS**

Run:
```pwsh
npx vitest run src/renderer/components/research/__tests__/ResearchPage --reporter=default 2>&1 | Select-Object -Last 20
```

**Step 5: Commit**

```pwsh
git add src/renderer/components/research/__tests__/
git commit -m "test(research): verify contextual chat list passed to right pane"
```

---

## Task 8: Full verification

**Step 1: Renderer typecheck**

```pwsh
npx tsc -p tsconfig.renderer.json --noEmit 2>&1 | Select-Object -Last 5
"renderer_tsc=$LASTEXITCODE"
```
Expected: `renderer_tsc=0`.

**Step 2: Main typecheck (unchanged but verify no incidental impact)**

```pwsh
npx tsc -p tsconfig.main.json --noEmit 2>&1 | Select-Object -Last 5
"main_tsc=$LASTEXITCODE"
```
Expected: `main_tsc=0`.

**Step 3: Run all renderer chat / research tests**

```pwsh
npx vitest run src/renderer/components/research src/renderer/lib/chat src/renderer/components/chat --reporter=dot 2>&1 | Select-Object -Last 10
```
Expected: all PASS.

**Step 4: Manual smoke (run dev, exercise the two new controls)**

Run (in a dev terminal you already have, or start one):
```pwsh
npm run dev
```
Then in the app:
1. With a target selected → click `+` in the right pane header → a new target-bound chat appears in the right pane and in the left sidebar under that target.
2. With no target selected → click `+` → a new Stella chat appears in the right pane and in the Ask list.
3. Click history icon → popover shows the contextual list, active row highlighted.
4. Click another row → right pane switches to that chat.
5. Hover a row → rename + delete buttons appear; rename inline, Esc cancels.
6. Delete the currently-active chat → right pane auto-bootstraps to a fresh primary-agent chat (via the prior `ensureCompactChatSession` fix).
7. Switch target → popover auto-closes if it was open.

**Step 5: If everything is green, no separate commit needed; finalize with a PR description draft for the user.**

---

## Plan complete

Plan complete and saved to [docs/plans/2026-06-05-right-pane-chat-controls-plan.md](2026-06-05-right-pane-chat-controls-plan.md). Two execution options:

**1. Subagent-Driven (this session)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Parallel Session (separate)** — Open a new session with executing-plans, batch execution with checkpoints.

Which approach?
