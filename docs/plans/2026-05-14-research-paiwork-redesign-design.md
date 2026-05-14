# Research Page · PaiWork-Style Redesign

**Date**: 2026-05-14
**Status**: Approved (design phase)
**Scope**: `src/renderer/components/research/**`, `src/renderer/components/layout/LeftNavigation.tsx`, `src/renderer/components/chat/ChatView.tsx` (compact mode), routing.

## Goal

Bring the investment-research workspace (`ResearchPage`) visually and structurally close to the PaiWork product:

- Three-pane layout: workspace tree (left) · document tabs (center) · embedded chat (right).
- App-level mode switch between "Chat" (existing `AgentPage`) and "Workspace" (`ResearchPage`) at the top of `LeftNavigation`.
- Light, refined visual language scoped to the research page only — no impact on existing glass/dark theme elsewhere.

Out of scope (intentionally deferred):
- Top global search bar and points/credits widget.
- In-place document editing (read-only Markdown only; "Save" button is a placeholder).
- PaiPai/PaiWork header switcher inside the workspace.

## Non-Goals

- No backend / IPC schema changes beyond extending `usePortfolio.getTargetFiles` to return relative paths.
- No new chat engine, no `AgentChat` fork.
- No global theme migration.

---

## 1. Overall Layout

```
┌──┬──────────────┬──────────────────────────────────┬────────────────┐
│Lf│ Workspace    │ Tabs: file1 | file2 | +          │ PaiPai (chat)  │
│Nv│ ▾ Target A   │ Doc header: name · mtime · 🔍⬇⋯ 保存│ messages       │
│  │   ▸ 纪要      │ ─────────────────────────────────│                │
│💬│   ▸ 研报      │ Markdown body                    │ tool-call chips│
│📊│   key.md     │                                  │                │
│  │   notes.md   │                                  │ ───────────────│
│⚙│ ▸ Target B   │                                  │ [@tab.md] input│
└──┴──────────────┴──────────────────────────────────┴────────────────┘
   200-220px      flex                               360-400px
```

- Left nav: existing component, with mode switch at top.
- Workspace tree: 200-220px.
- Document area: flex, max content width ~800px centered.
- Chat: 360-400px (resizable in a later iteration).

## 2. Mode Switch (LeftNavigation)

- Add a top group above the existing nav items with two icon buttons:
  - `💬 Chat` → route `/agent`
  - `📊 Workspace` → route `/research`
- Visual: same icon style as existing nav; selected state uses a small main-color indicator (left bar or filled bg).
- Routes: add `/research` to `AppRoutes.tsx` (protected, same auth guard as `/agent`).
- Default landing: keep `/agent` for existing users.

## 3. Left Workspace Tree (`TargetListSidebar` upgrade)

- Each target is an expandable root node (▾/▸).
- Under each target:
  - Loose files at the target root (`key-drivers.md`, `notes.md`, `profile.yaml`, `tracking.md`) shown directly.
  - Then fixed sub-categories: **纪要 / 专家交流 / 公司交流 / 研报 / 模型 / 公告 / 其它**.
    - Mapped to same-named subfolders under the target dir.
    - Missing folder → grayed out, not expandable.
- Row: 24-26px height, 12.5px font, file-type icon prefix.
- Click file → open/activate tab in document area.
- Selected target row: light-gray bg.
- Add-target button stays at the bottom of the list.

Data:
- Extend `usePortfolio.getTargetFiles(code)` to return `{ relPath, absPath, mtime }[]` (relative to target dir).
- Frontend builds the tree from path segments; sub-categories are predefined constants.

## 4. Center Document Tabs (`ContentTabs` upgrade)

- **Tab strip** (28px tall):
  - Active tab: white bg + 2px main-color top bar.
  - Inactive: `#F5F5F5` bg, hover shows × close button.
  - Trailing `+` button (placeholder, no-op for now).
- **Document header** (32px tall, under tab strip):
  - Left: file basename · `最近更新 HH:MM` (formatted mtime).
  - Right icons (24px buttons): 🔍 search · ⬇ download · ⋯ more · `保存` button (disabled placeholder).
- **Body**:
  - Markdown via existing `react-markdown` pipeline.
  - Padding 32-40px; max content width 800px centered.
  - Read-only.
- Tabs persist while switching targets; closing the last tab shows an empty state ("从左侧选择文件以打开").

## 5. Right Chat Panel (`ChatView` compact mode)

- Add prop `mode?: 'full' | 'compact'` to `ChatView` (default `'full'`, no change to `AgentPage`).
- `compact` adjustments:
  - **Header**: title `PaiPai`, right icons (new chat / history / close — placeholders OK).
  - **User message**: right-aligned bubble, brand-purple light bg, max-width 80%, timestamp below.
  - **Assistant message**: no bubble, left-aligned; collapsible `PaiPai 正在努力思考 ⌄` header.
  - **Tool calls**: render as compact chip rows (icon · label · short summary · ⌄ to expand). Wrap existing `toolCallViews` in a `CompactToolCallChip` container; expand-on-demand reuses the full views.
  - **Input**: bottom area, attachment chip row above textarea; rounded 10px; circular main-color send button.
- Default attachment: ResearchPage passes the active tab's file path → input pre-fills an attachment chip the user can remove.
- Chat session persists across target switches (single workspace-level session).
- All IPC, streaming, tool execution logic untouched.

## 6. Light Refined Theme (research-scoped)

- Root container: `<div data-theme="research">` on `ResearchPage`; all light-theme CSS scoped under `[data-theme="research"]`.
- Tokens:
  - bg: main `#FFFFFF`, left pane `#FAFAFA`, chat header `#F7F8FA`.
  - border: `#EEEEEE` 1px.
  - text: primary `#1F2328`, secondary `#57606A`, tertiary `#8C959F`.
  - brand purple: existing token, used only for user bubbles, active tab bar, primary buttons.
  - status badges (rendered when Markdown table cell text matches keyword):
    - 边际改善 → `bg #E6F4EA / fg #1E8E3E`
    - 边际承压 → `bg #FEF7E0 / fg #B06000`
    - 边际恶化 → `bg #FCE8E6 / fg #C5221F`
    - Pill: 2px 8px, 11px font, 999px radius.
- Type scale: left tree 12.5px / document body 14px / chat 13.5px; line-height 1.55.
- Shadows: avoid; use 1px borders for separation.
- Implementation: a single CSS file `src/renderer/components/research/research-theme.css` imported by `ResearchPage`.

## 7. Errors / Boundaries / Testing

- File missing or read fails → empty-state card in document area; no toast spam.
- Sub-category folder missing → grayed list item, not expandable.
- Chat IPC error → existing `ChatView` error UI.
- Switching targets does **not** destroy the chat session.
- Testing:
  - Manual: verify research-theme styles do not bleed into `/agent` or `/settings`.
  - Manual: tree expand/collapse, tab open/close, chat send with default attachment, status badges render in tracking.md tables.
  - No new automated tests this iteration; existing smoke remains.

## File Touch List

New:
- `src/renderer/components/research/research-theme.css`
- `src/renderer/components/research/CompactToolCallChip.tsx` (or inside chat dir)

Modified:
- `src/renderer/components/research/ResearchPage.tsx` — three-pane layout with `data-theme="research"`, embed `ChatView mode="compact"`, pass active file as attachment.
- `src/renderer/components/research/TargetListSidebar.tsx` — tree with expand/collapse + sub-categories.
- `src/renderer/components/research/ContentTabs.tsx` — compact tab strip + document header.
- `src/renderer/components/research/usePortfolio.ts` — extend `getTargetFiles` to return relPath/mtime.
- `src/renderer/components/layout/LeftNavigation.tsx` — top mode-switch group.
- `src/renderer/routes/AppRoutes.tsx` — add `/research` route.
- `src/renderer/components/chat/ChatView.tsx` — add `mode` prop and compact branches; touches Message / ChatInput as needed.

## Risks

- ChatView is large (~49KB); compact mode adds conditional branches. Mitigation: prefer separate small subcomponents for compact bits (header, chip), keep diffs localized.
- Theme leakage. Mitigation: strict `[data-theme="research"]` prefix; avoid global selectors.
- Tree perf if a target has thousands of files. Mitigation: defer; current data volume is small.
