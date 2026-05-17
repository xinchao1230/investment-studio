# Ask tab — unified chat list (preview mode)

**Date:** 2026-05-17
**Status:** Approved (A' click behavior), ready for implementation. Do not push until user validates.

## Problem

The current Ask tab only lists chats with `targetCode === null` (Stella-scoped).
Chats that get rebound to a target — either via the LLM-driven
`portfolio_init_target` flow or any future explicit binding — disappear from
the Ask list and become reachable only by:

1. Remembering which target owns the chat.
2. Clicking that target in the Workspace tree to expand it.
3. Picking the chat from the per-target list.

This breaks two real workflows:

- **A. Find a recent conversation** — user doesn't remember which target,
  so the chat is effectively lost.
- **B. Quick jump between recent activity** — switching between 2-3
  recently-active threads across different targets is hostile.

## Goal

Turn the Ask tab into a single chronological list of **every** chat in the
profile, regardless of target binding, while keeping the Workspace tab
unchanged.

## Design

### Sidebar layout (Ask tab body)

```
┌─────────────────────────────────────┐
│ Workspace │ Ask  [Q] [+] [⋯]        │  ← unchanged
├─────────────────────────────────────┤
│ ★ 对比茅台和五粮液            ⋯ 🗑  │
│ ★ [00700.HK] 看腾讯 Q3 财报   ⋯ 🗑  │
│ ★ 帮我建海底捞 target          ⋯ 🗑  │
│ ★ [603993] 边际跟踪洛阳钼业    ⋯ 🗑  │
│ ★ [私募基金A] 单位经济分析    ⋯ 🗑  │
└─────────────────────────────────────┘
```

**Row anatomy:**
- Optional target pill **before** the title, only when `targetCode !== null`.
- Pill text = `stock_code` if listed; `name` if unlisted (`stock_code === name`).
- Pill style: small rounded chip in `var(--rw-text-3)` color, reuses the
  same look as the existing `rw-stella-welcome-pill` ("未上市") with a
  brand-neutral hue.
- Existing rename / delete hover affordances kept.

**Ordering:** by `chatSession_id` descending (creation time descending).
Same as today's Stella list — avoids flicker during streaming since
`last_updated` would shift the row's position mid-conversation.

### Click behavior — **A' (preview mode)**

| Click target | Effect |
|---|---|
| Stella chat (targetCode = null) | `stella.selectChat(sessionId)` — current behavior, sidebar stays on Ask |
| Target-bound chat (targetCode != null) | Open that chat in the right pane **without leaving the Ask tab**. Workspace tab is NOT auto-activated. |

The user explicitly clicks the Workspace tab when they want to leave
"chat triage" mode and see the file tree.

**Concrete steps for target-bound click:**
1. Set `selectedCode = targetCode` so any target-aware UI (right pane
   header / breadcrumb) reflects the chat's owner.
2. Call `targetChats.selectChatForTarget(targetCode, target, sessionId)`
   so the agent engine + cache switch to the right session.
3. Do **NOT** call `setActiveMode('workspace')`. Sidebar keeps showing
   the Ask list with `is-active` highlight on the row.
4. Implicit: the right-pane breadcrumb shows the target name + chat
   title (already wired through `selectedCode + active chat`).

### Active-row highlighting

The Ask list highlights whichever session is currently driving the right
pane, regardless of its `targetCode`. Source: `useCurrentChatSessionId()`
(the agent-engine truth, already used elsewhere on this branch).

### Data flow

**New IPC:** `researchChat:listAll`
- Backend mirror of `researchChat:listByTarget` but without the
  `targetCode` filter. Returns all sessions for the active chat with
  their `targetCode` field intact.
- Sorted by `chatSession_id` descending in main process so renderer
  doesn't need to re-sort.

**New renderer hook:** `useAllChats`
- Mirrors `useStellaChats` shape but does not auto-create or have an
  `active` field (active session is derived from `useCurrentChatSessionId`).
- Subscribes to `profile.onChatSessionUpdated` (already pushed by
  `chatSessionManager.notifyFrontend`) to incrementally update titles
  / last_updated / targetCode in place. Falls back to re-listAll on
  unknown event shapes.

**Removal:** `useStellaChats` is **kept** internally because the Ask
list's Stella rows still need to drive `stella.selectChat()` for the
correct chat-engine switch on click. We pull both hooks side-by-side:
- `useAllChats` drives the visible list.
- `useStellaChats` / `useTargetChats` drive selection.

This minimizes the blast radius: existing selection / chat-engine
plumbing is untouched.

### Files

| File | Change |
|---|---|
| `src/main/investmentStudio/index.ts` | Add `researchChat:listAll` handler (~25 lines) |
| `src/main/preload.ts` | Expose `researchChat.listAll` on contextBridge + .d.ts (~6 lines) |
| `src/renderer/components/research/researchChatIpc.ts` | Add `listAll()` facade (~10 lines) |
| `src/renderer/components/research/useAllChats.ts` | New hook (~90 lines, modeled on useStellaChats) |
| `src/renderer/components/research/ResearchPage.tsx` | Wire `useAllChats`, add `handleSelectAnyChat(session)` dispatcher (~20 lines) |
| `src/renderer/components/research/TargetListSidebar.tsx` | Rewrite the Stella-mode body to render `allChats` with target pills (~70 lines) |
| `src/renderer/components/research/research-theme.css` | Add `.rw-chat-row-target-pill` styles (~15 lines) |

Total ~235 lines, all renderer + one tiny IPC handler. Zero data model
changes.

## Risks

- **Active highlight desync:** The agent engine's `currentChatSessionId`
  and the renderer's `useCurrentChatSessionId` already stay in sync via
  the `agentChat:onCurrentChatSessionIdChanged` event. Each rebound chat
  triggers a `chatSession:updated` push that reaches `useAllChats`.
  Edge case: a rename arrives while the user is mid-scroll; resolved by
  patch-in-place rather than full re-list.
- **Performance ceiling:** Naive list of ~500 chat rows in a flat
  `<div>` is fine on modern hardware. If a profile ever gets to ~2k,
  swap in `react-window` virtualization in the same row component.
- **Stella mode terminology drift:** "Ask" no longer means
  "Stella-scoped" — it means "everything". The `activeMode === 'stella'`
  identifier in code stays, but its semantic narrows to "Ask tab is
  selected (sidebar shows global list)". A follow-up rename
  (`activeMode === 'ask'`) is optional and out of scope.

## Out of scope

- Filter chips (Stella-only / target-only). Could come back as a
  toggle if users want it.
- Last-N quick-jump strip above the tree on Workspace tab. Once Ask
  covers global discovery this is redundant.
- Search-by-title within the chat list. Can be layered later using
  the same `useAllChats` data.
- Renaming `activeMode === 'stella'` constant.

## Verification (user)

1. Create chats in Stella (no target), in target X, in target Y.
2. Open Ask tab → see all of them, with pills `[X]` / `[Y]` and Stella
   ones bare.
3. Click a Stella chat → right pane switches, sidebar stays on Ask.
4. Click a target X chat → right pane switches to that chat, header
   shows X. Sidebar still on Ask. Workspace tree is NOT auto-shown.
5. Click Workspace tab → tree shows, with X auto-highlighted because
   `selectedCode` was set in step 4.
6. Rebind a Stella chat via `portfolio_init_target` LLM call → the
   row in Ask updates to gain a pill (still in place, not jumping).
