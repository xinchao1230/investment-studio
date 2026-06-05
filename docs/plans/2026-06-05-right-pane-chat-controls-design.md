# Right-Pane Chat Controls (New + History) — Design

**Date:** 2026-06-05
**Status:** approved, pre-implementation
**Scope:** renderer-only; research workspace right pane

## Problem

In the research workspace right pane (`ResearchChatPane` rendering `ChatView` in compact mode), the user has no in-pane way to:

1. Start a **new chat** — they must go to the left sidebar (per-target "+" button), or to the unified Ask list. When the portfolio is empty, there is no entry point at all and they are forced to keep typing in the auto-created session.
2. **Switch to a historical chat** — same trip to the left sidebar.

The pane currently has only a collapse button in its header.

## Decision

Add two icon buttons to the right pane header (left-aligned, before the existing collapse button on the right):

| Icon | Action |
|---|---|
| `MessageSquarePlus` | Create a new chat, scoped to the current target (or "Stella" when no target is selected) |
| `MessagesSquare` | Open a context-aware history popover listing chats for the current scope |

Both behave identically to the equivalent left-sidebar actions; they are pure UI surfaces over the existing `useTargetChats` / `useStellaChats` hooks.

## Non-Goals

- No new IPC, no main-process changes.
- No new dependencies (Radix Popover etc.) — reuse the existing lightweight absolute-positioned-panel + click-outside pattern used elsewhere in the research module.
- No keyboard shortcuts in v1 (avoid conflict with existing `Ctrl+/` collapse).
- No global unified Ask list inside the popover — context-aware only (target → target's chats, no target → Stella chats).
- No confirm dialog for delete (matches left sidebar behavior).

## Architecture

```
ResearchPage (owns selectedCode + targetChats + stella hooks)
│
├── handleNewChatFromPane()                     # NEW
│     if (selectedCode) targetChats.createChatForTarget(code, target)
│     else              stella.createChat()
│
├── handleSelectChatFromPane(chatSessionId)     # NEW
│     if (selectedCode) targetChats.selectChatForTarget(code, target, chatSessionId)
│     else              stella.selectChat(chatSessionId)
│
├── contextualChatList = useMemo(() =>          # NEW (derived)
│     selectedCode
│       ? targetChats.chatsByCode[selectedCode] ?? []
│       : stella.chats)
│
└── <ResearchChatPane                            # extended props
       chats={contextualChatList}
       activeChatSessionId={liveChatSessionId}
       onNewChat={handleNewChatFromPane}
       onSelectChat={handleSelectChatFromPane}
       onRenameChat={handleRenameAnyChat}        # already exists
       onDeleteChat={handleDeleteAnyChat}        # already exists
       …existing props…
    />
       │
       └── header: [+ icon] [history icon] …spacer… [collapse]
                                  ↑
                                  └── click → <ChatHistoryPopover />   # NEW component
                                              (absolute-positioned,
                                               click-outside / Esc to close)
```

**Boundary:** `ResearchPage` remains the sole owner of chat/target data; the right pane is a view + callbacks. The two new handlers are dispatchers — they pick between the existing `targetChats` and `stella` hooks based on `selectedCode`. The data layer is unchanged.

## Data Flow

### New chat (target-bound branch)

```
ResearchChatPane           ResearchPage           useTargetChats           researchChatIpc         main process
─────────────────          ────────────           ──────────────           ───────────────         ─────────────
[+] onClick ─onNewChat()─▶ handleNewChatFromPane
                            │
                            └─ targetChats.createChatForTarget(code, target)
                                                  │
                                                  ├─ researchChatIpc.create(code, {title}) ──▶ research:createChat
                                                  │                                                  │
                                                  │                                            chatSessionStore.createSession
                                                  │                                            agentChatManager.startNewChatFor
                                                  │                                            ◀── {chatId, chatSessionId}
                                                  │
                                                  ├─ setChats(prev → prepend new)
                                                  └─ setActive({chatId, chatSessionId})
                                                       └─ agentChatSessionCacheManager.setCurrentChatSessionId
                                                            (right pane ChatView re-renders)
                            ◀──┘
                            └─ void allChats.refresh()   (left sidebar Ask list sync)
```

### New chat (Stella branch)

Identical, but routes through `stella.createChat()` → `researchChatIpc.create(null, {title:'New Chat'})`.

### Switch historical chat

```
ChatHistoryPopover row ─onSelectChat(sid)─▶ handleSelectChatFromPane
                                              │
                                              └─ if selectedCode:
                                                     targetChats.selectChatForTarget(code, target, sid)
                                                       └─ agentChatIpc.switchToChatSession
                                                            → setCurrentChatSessionId
                                                  else stella.selectChat(sid)
```

### Invariants

1. `agentChatSessionCacheManager.setCurrentChatSessionId` is the single funnel for switching the live chat — every path passes through it.
2. The compact-mode `ChatView` requires no changes; it already subscribes to `CurrentSessionStatus`.
3. New paths do **not** need `ensureCompactChatSession` (only deletion paths do; covered by an earlier PR).
4. `allChats.refresh()` is called after both new and switch so the left sidebar Ask list re-renders.
5. Popover-open list is read from already-loaded state (`targetChats.chatsByCode` / `stella.chats`) — no fetch on open.

## UI

### Header layout

```
┌───────────────────────────────────────────────────────────────┐
│ [MessageSquarePlus] [MessagesSquare] ←spacer→     [Collapse] │  h-10, px-3
└───────────────────────────────────────────────────────────────┘
```

- Icons are 14px, reusing `.rw-side-icon-btn`.
- `title` attribute: `"New chat"` / `"Chat history"`.
- Collapsed strip: shows only `PanelRightOpen`. New/history are not duplicated in the strip — the user expands first, then operates.

### Popover

| Property | Value |
|---|---|
| Position | `absolute; top: 40px; left: 36px` (anchored under the history icon) |
| Width | `min(320px, paneWidth - 24px)` |
| Max height | `60vh`, scroll on overflow |
| z-index | 50 |
| Close triggers | click outside (`mousedown` capture), `Esc`, row click |

### Row

```
┌────────────────────────────────────────────┐
│ ● 贵州茅台 600519 深度分析       [✏] [🗑] │  ← hover reveals actions
│   2 hours ago · 14 messages                │
├────────────────────────────────────────────┤
│ ○ 新业务线讨论                  [✏] [🗑] │
│   yesterday · 3 messages                   │
└────────────────────────────────────────────┘
```

- Filled dot = active chat, hollow = others.
- Title falls back to `"Untitled chat"` when empty; single-line truncate.
- Subtitle = relative timestamp (+ message count if available in chat record).
- Rename: ✏ swaps the title row into an inline `<input>`; Enter commits via `onRenameChat`, Esc cancels.
- Delete: 🗑 directly invokes `onDeleteChat` (no confirm dialog, matching the sidebar).

### Empty / loading states

| Condition | Render |
|---|---|
| List length 0 | "No chats yet. Click + to start one." |
| List unloaded (rare; lists are normally hydrated when target is selected) | Small spinner; "+ New chat" still operable |
| Async failure | `useToast().showError(...)` |

### Edge cases

1. Click + or switch while a chat is streaming — non-blocking; old session keeps streaming in the background (already true today via `setCurrentChatSessionId`).
2. Delete the currently-active chat — covered by `handleDeleteAnyChat` and `ensureCompactChatSession` from a prior PR.
3. Switch target while popover is open — `useEffect` on `selectedCode` closes the popover to avoid showing the previous target's list.

## Error Handling

| Failure | Behavior |
|---|---|
| `createChat(...)` rejects | Hook returns `null`; pane shows `toast.error('Failed to create chat')`; popover stays closed |
| `selectChat...(...)` rejects | Toast; do not roll back active (keep old view) |
| `rename` / `delete` rejects | Reuses sidebar's existing toast paths |
| Click-outside listener leak | `useEffect` cleanup must `removeEventListener('mousedown', handler, true)` |
| Stale list after external mutation | `contextualChatList` is a derived memo over `chatsByCode` / `stella.chats`; React re-renders automatically |

## Testing

Vitest + Testing Library, matching existing research test patterns:

| File | Cases |
|---|---|
| `ResearchChatPane.test.tsx` (extend / create) | 6 |
| · header renders + / history icons | 1 |
| · clicking + calls `onNewChat` exactly once | 1 |
| · clicking history opens popover; close on Esc / outside / row click | 3 |
| · collapsed mode hides + / history icons | 1 |
| `ChatHistoryPopover.test.tsx` (new) | 7 |
| · renders list with active row highlighted | 1 |
| · empty list shows placeholder | 1 |
| · row click invokes `onSelectChat` and closes | 1 |
| · hover reveals rename / delete | 1 |
| · rename inline input: Enter commits, Esc cancels | 2 |
| · delete invokes `onDeleteChat` without confirm dialog | 1 |
| `ResearchPage.tsx` (extend) | 2 |
| · `contextualChatList` derives from `targetChats[code]` when target selected | 1 |
| · `contextualChatList` derives from `stella.chats` when none | 1 |

No e2e — existing Playwright suite does not cover the research subtree; keep parity.

## Files

| Path | Status | Approx. LoC |
|---|---|---|
| `src/renderer/components/research/ChatHistoryPopover.tsx` | new | ~120 |
| `src/renderer/components/research/__tests__/ChatHistoryPopover.test.tsx` | new | ~150 |
| `src/renderer/components/research/ResearchChatPane.tsx` | modify | +30 |
| `src/renderer/components/research/__tests__/ResearchChatPane.test.tsx` | modify or new | +80 |
| `src/renderer/components/research/ResearchPage.tsx` | modify | +25 |

No IPC / preload / main-process / shared-types changes.

## Risks

| Risk | Mitigation |
|---|---|
| Popover overflow on very narrow pane (< 280px) | Width is `min(320px, paneWidth - 24px)` |
| Duplicate mental model (left + right both create chats) | Accepted per user request; both call the same hook so chats are identical |
| Brief blank-view after deleting active chat | Already mitigated by `ensureCompactChatSession` (prior PR) |
| Concurrent rename/delete from sidebar + popover | Last write wins; both subscribe to `chatSession:updated`, eventually consistent |

## Out of Scope (Follow-Ups)

- Keyboard shortcuts (`Ctrl+Shift+N`, `Ctrl+Shift+H`)
- Search-in-popover when chat list grows large
- Visual indicator for chats with unread agent messages
- A right-pane-only "current chat title" breadcrumb
