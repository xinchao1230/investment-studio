# Chat history popover: in-context create entries — design

<!-- Last verified: 2026-06-06 -->

## Problem

PR #63 made the right-pane `New chat` and history popover mode-driven: in
Workbench mode both operate on the currently selected target; in Stella mode
both operate on the global chat list. Side effect: there is no longer any way
to create a **global** chat from Workbench mode without first switching the
left-sidebar tab to Stella.

Switching modes just to start a tangential global question (e.g. "what's the
general framework for evaluating SaaS gross margin trends?" while looking at a
specific target) is friction. We want a direct entry point.

## Decision

Add two create entries to the **top of the chat history popover** (rendered
only in Workbench mode):

1. `+ New chat for <TargetName>` — visible only when a target is selected
2. `+ New global chat` — always visible in Workbench mode

Stella mode popover is unchanged: it already lists global chats and the right
pane's `New chat` button already creates a global chat, so additional entries
would be redundant.

## Behavior

| Entry | Mode | `selectedCode` | Action |
|---|---|---|---|
| `+ New chat for <Target>` | Workbench | set | `targetChats.createChatForTarget(selectedCode)` → close popover |
| `+ New chat for <Target>` | Workbench | unset | row not rendered |
| `+ New global chat` | Workbench | any | `setActiveMode('stella')` → `stella.createChat()` → close popover |
| (neither entry) | Stella | any | popover unchanged from current behavior |

Creating a global chat **auto-switches the left-sidebar mode tab to Stella**.
Without the auto-switch the new chat would be invisible to the user
(Workbench's history list shows target chats only). "Create implies see"
is non-negotiable for this interaction.

`TargetName` resolves from `targets.find(t => t.code === selectedCode)?.name`,
falling back to `selectedCode`, falling back to hiding the target row.

## Component changes

Only two component files plus theme CSS:

### `ChatHistoryPopover.tsx`

New props (all optional, so Stella code path stays untouched):

```ts
interface ChatHistoryPopoverProps {
  // ...existing
  showCreateActions?: boolean;
  selectedTargetName?: string | null;
  onCreateTargetChat?: () => void;
  onCreateGlobalChat?: () => void;
}
```

Render order inside the popover:

1. Create section (if `showCreateActions`)
   - `<button class="rw-history-create-row">` for target (conditional on
     `selectedTargetName`)
   - `<button class="rw-history-create-row">` for global
2. 1px divider (`.rw-history-create-divider`)
3. Existing chat list

Both buttons call their handler then `onClose()`.

The existing empty-state copy "No chats yet. Click + to start one." becomes
"No chats yet." when `showCreateActions` is true (the + is now adjacent above,
so the pointer is redundant).

### `ResearchPage.tsx`

Wires the four new props onto `<ResearchChatPane>`:

```ts
showCreateActionsInHistory={activeMode === 'workbench'}
selectedTargetName={selectedTarget?.name ?? selectedTarget?.code ?? null}
onCreateTargetChatFromHistory={() => {
  const code = selectedCodeRef.current;
  if (code) void targetChats.createChatForTarget(code);
}}
onCreateGlobalChatFromHistory={() => {
  setActiveMode('stella');
  void stella.createChat();
}}
```

### `ResearchChatPane.tsx`

Pure transparent passthrough of the four new props down to
`ChatHistoryPopover`. No business logic added.

### `research-theme.css`

Four new rules at the bottom of the file:

```css
[data-theme="research"] .rw-history-create-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  font-size: 13px;
  color: var(--rw-text);
  font-weight: 500;
  cursor: pointer;
  background: transparent;
  border: 0;
  text-align: left;
}
[data-theme="research"] .rw-history-create-row:hover {
  background: var(--rw-accent-soft);
}
[data-theme="research"] .rw-history-create-row svg {
  color: var(--rw-text-2);
  flex-shrink: 0;
}
[data-theme="research"] .rw-history-create-divider {
  height: 1px;
  background: var(--rw-border);
  margin: 4px 0;
}
```

Row height aligns with existing chat rows (`px-3 py-2`, ~36px). Hover uses the
same `--rw-accent-soft` blue fill as the left sidebar's active state so the
"this is actionable" affordance is consistent.

## Data flow

```
ChatHistoryPopover (click "+ New global chat")
  → props.onCreateGlobalChat()
  → ResearchPage handler { setActiveMode('stella'); void stella.createChat(); }
  → ChatHistoryPopover.onClose() (popover unmounts)
  → React batches the two state updates into one render
  → right pane re-renders with the new global chat as activeChatSessionId
```

Net user-visible sequence: click → popover disappears → left tab switches to
Stella → new global chat is open in right pane. One frame.

## Tradeoffs accepted

- **Visual redundancy with right-pane `New chat` button (in Workbench mode):**
  The right-pane button creates a target chat; the popover entry
  `+ New chat for <Target>` does the same. This is intentional — the popover
  needs symmetry between target and global entries so users don't have to
  remember which surface does which. Cost is one extra clickable row;
  benefit is users never need to think about "which button creates what".

- **Workbench → create global → auto-switch to Stella is a mode change the
  user did not explicitly request.** Acceptable because (a) the alternative
  is creating an invisible chat, and (b) the button copy `New global chat`
  makes the cross-mode intent explicit.

## Testing

New cases in `ChatHistoryPopover.test.tsx`:

| Case | Setup | Assertion |
|---|---|---|
| Workbench + target | `showCreateActions, selectedTargetName="Tencent"` | both create rows render; target row has "Tencent" |
| Workbench + no target | `showCreateActions, selectedTargetName=null` | only global row renders |
| Stella default | omit `showCreateActions` | no create rows; existing behavior unchanged |
| Click target create | click `+ New chat for Tencent` | `onCreateTargetChat` × 1, `onClose` × 1, `onCreateGlobalChat` × 0 |
| Click global create | click `+ New global chat` | `onCreateGlobalChat` × 1, `onClose` × 1 |
| Long target name | `selectedTargetName="Bytedance Holdings Limited"` | label `<span>` has `truncate` class |

No new tests in `ResearchPage` — the handlers are thin glue, covered by
existing mode-switch and `createChat` hook tests.

## Out of scope

- Reordering / pinning chats in the popover
- Search/filter inside the popover
- Creating chats for a target *other than* `selectedCode` from this popover
  (use the left sidebar's tree to switch targets first)
- Changing Stella popover at all
