# Research Page · PaiWork-Style Redesign · Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bring `ResearchPage` close to PaiWork's three-pane layout & light refined visuals, add a chat/workspace mode switch in `LeftNavigation`, and embed the existing chat as the right pane in compact mode — all without touching the global glass/dark theme.

**Architecture:** Keep `ResearchPage` as the host. Upgrade three children (`TargetListSidebar`, `ContentTabs`, and a new `ResearchChatPane` that wraps `ChatView`). Add a research-scoped CSS theme via `[data-theme="research"]`. Add a top mode switch group in `LeftNavigation`. Read-only Markdown only; no editing this iteration.

**Tech Stack:** React 18, TypeScript, TailwindCSS, react-markdown (existing), lucide-react (existing), react-router-dom (existing).

**Design doc:** [docs/plans/2026-05-14-research-paiwork-redesign-design.md](2026-05-14-research-paiwork-redesign-design.md)

---

## Conventions

- Touch only files listed in each task. No drive-by refactors.
- After each task: build (`npm run build:renderer`) must succeed; commit with the exact message in the step.
- Use `data-theme="research"` as the only theme switch — never modify global Tailwind theme.
- This project has no automated UI tests for these components. Verification = build + manual visual check after the final integration task.

---

## Task 1 — Add research-scoped theme CSS

**Files:**
- Create: `src/renderer/components/research/research-theme.css`

**Step 1: Create the file with scoped tokens**

```css
/* Research workspace — light refined theme.
   Scoped strictly under [data-theme="research"] to avoid leaking into the
   rest of the app. */

[data-theme="research"] {
  --rw-bg: #ffffff;
  --rw-bg-soft: #fafafa;
  --rw-bg-chat-header: #f7f8fa;
  --rw-border: #eeeeee;
  --rw-text: #1f2328;
  --rw-text-2: #57606a;
  --rw-text-3: #8c959f;
  --rw-accent: #6d4cff; /* keep aligned with brand purple */
  --rw-accent-soft: #efeaff;

  --rw-status-good-bg: #e6f4ea;
  --rw-status-good-fg: #1e8e3e;
  --rw-status-warn-bg: #fef7e0;
  --rw-status-warn-fg: #b06000;
  --rw-status-bad-bg:  #fce8e6;
  --rw-status-bad-fg:  #c5221f;

  background: var(--rw-bg);
  color: var(--rw-text);
  font-size: 13.5px;
  line-height: 1.55;
}

[data-theme="research"] .rw-pane-left {
  background: var(--rw-bg-soft);
  border-right: 1px solid var(--rw-border);
}
[data-theme="research"] .rw-pane-right {
  border-left: 1px solid var(--rw-border);
  background: var(--rw-bg);
}
[data-theme="research"] .rw-divider {
  border-bottom: 1px solid var(--rw-border);
}
[data-theme="research"] .rw-tab-active-bar {
  box-shadow: inset 0 2px 0 0 var(--rw-accent);
}
[data-theme="research"] .rw-status-pill {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 11px;
  line-height: 16px;
  font-weight: 500;
}
[data-theme="research"] .rw-status-good { background: var(--rw-status-good-bg); color: var(--rw-status-good-fg); }
[data-theme="research"] .rw-status-warn { background: var(--rw-status-warn-bg); color: var(--rw-status-warn-fg); }
[data-theme="research"] .rw-status-bad  { background: var(--rw-status-bad-bg);  color: var(--rw-status-bad-fg); }

[data-theme="research"] .rw-doc-body {
  font-size: 14px;
  color: var(--rw-text);
  max-width: 800px;
  margin: 0 auto;
  padding: 24px 40px 64px;
}
[data-theme="research"] .rw-tree-row {
  font-size: 12.5px;
  color: var(--rw-text-2);
  height: 26px;
  display: flex;
  align-items: center;
  padding: 0 8px;
  cursor: pointer;
  user-select: none;
}
[data-theme="research"] .rw-tree-row:hover { background: rgba(0,0,0,0.03); }
[data-theme="research"] .rw-tree-row.is-active { background: var(--rw-accent-soft); color: var(--rw-text); }
[data-theme="research"] .rw-tree-row.is-disabled { color: var(--rw-text-3); cursor: default; }
```

**Step 2: Build**

Run: `npm run build:renderer`
Expected: success (CSS-only file, no JS impact yet).

**Step 3: Commit**

```bash
git add src/renderer/components/research/research-theme.css
git commit -m "feat(research): add scoped light theme tokens"
```

---

## Task 2 — Extend `usePortfolio.getTargetFiles` to return rich entries

**Files:**
- Modify: `src/renderer/components/research/usePortfolio.ts`

**Step 1: Add a `TargetFile` type and adjust the signature**

Add at top:
```ts
export interface TargetFile {
  /** Path relative to the target directory, using '/' separators. */
  relPath: string;
  /** Absolute path returned by the backend (passthrough). */
  absPath: string;
  /** Last modified time in ms since epoch (0 if unknown). */
  mtime: number;
}
```

Change `getTargetFiles` return to `Promise<TargetFile[]>`. Adapt the parser to accept either:
- legacy `string[]` of absolute paths → map to `{ relPath: basename, absPath, mtime: 0 }`
- new `Array<{ relPath, absPath, mtime }>` → passthrough

Use `path` module (already polyfilled in renderer per webpack config) to derive relPath when only abs is returned: `relPath = absPath.split(/[\\/]/).slice(-1)[0]`. Keep it dependency-free.

Update the `PortfolioHook` interface accordingly.

**Step 2: Update the only existing caller (`ResearchPage.tsx`) to compile**

In `ResearchPage.handleSelectTarget`, change:
- `files.find((f) => f.endsWith('key-drivers.md'))` → `files.find((f) => f.relPath.endsWith('key-drivers.md'))`
- pass `keyDrivers.absPath` as `filePath` and `keyDrivers.relPath` as `label` (basename slice).

This is a temporary shim; Task 5 will rewrite this logic.

**Step 3: Build**

Run: `npm run build:renderer`
Expected: success.

**Step 4: Commit**

```bash
git add src/renderer/components/research/usePortfolio.ts src/renderer/components/research/ResearchPage.tsx
git commit -m "refactor(research): typed TargetFile entries from usePortfolio"
```

---

## Task 3 — Mode switch in `LeftNavigation`

**Files:**
- Modify: `src/renderer/components/layout/LeftNavigation.tsx`
- Modify: `src/renderer/styles/LeftNavigation.css` (only if needed for the new group spacing)

**Step 1: Add a top mode-switch group**

Inside the `<nav>`, before `<NavigationSection ... />`, render:

```tsx
import { MessageSquare, LayoutDashboard } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';

// inside component:
const location = useLocation();
const navigate = useNavigate();
const isResearch = location.pathname.startsWith('/research');
const isChat = location.pathname.startsWith('/agent');

<div className="left-nav-mode-switch">
  <button
    type="button"
    className={`mode-btn ${isChat ? 'active' : ''}`}
    title="Chat"
    onClick={() => navigate('/agent')}
  >
    <MessageSquare size={18} />
  </button>
  <button
    type="button"
    className={`mode-btn ${isResearch ? 'active' : ''}`}
    title="Workspace"
    onClick={() => navigate('/research')}
  >
    <LayoutDashboard size={18} />
  </button>
</div>
```

**Step 2: Add minimal CSS** in `LeftNavigation.css`:

```css
.left-nav-mode-switch {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 6px;
  border-bottom: 1px solid rgba(255,255,255,0.08);
}
.left-nav-mode-switch .mode-btn {
  display: flex; align-items: center; justify-content: center;
  width: 32px; height: 32px;
  border-radius: 8px;
  color: rgba(255,255,255,0.6);
  background: transparent;
  border: none; cursor: pointer;
  transition: background .15s, color .15s;
}
.left-nav-mode-switch .mode-btn:hover { background: rgba(255,255,255,0.08); color: #fff; }
.left-nav-mode-switch .mode-btn.active { background: rgba(109,76,255,0.18); color: #fff; }
.left-navigation.collapsed .left-nav-mode-switch { padding: 8px 4px; }
```

(Adjust selectors to match the actual existing class names if `.left-navigation.collapsed` differs.)

**Step 3: Build & smoke**

Run: `npm run build:renderer`
Expected: success. No type errors.

**Step 4: Commit**

```bash
git add src/renderer/components/layout/LeftNavigation.tsx src/renderer/styles/LeftNavigation.css
git commit -m "feat(layout): chat/workspace mode switch in LeftNavigation"
```

---

## Task 4 — Workspace tree (`TargetListSidebar` upgrade)

**Files:**
- Modify: `src/renderer/components/research/TargetListSidebar.tsx`

**Step 1: Replace API with tree-aware version**

New props:

```ts
interface TargetListSidebarProps {
  targets: Target[];
  selectedCode: string | null;
  expandedCodes: Set<string>;
  filesByCode: Record<string, TargetFile[] | undefined>; // undefined = not loaded yet
  activeFileAbsPath: string | null;
  onSelectTarget: (code: string) => void;     // also triggers loading files
  onToggleExpand: (code: string) => void;
  onOpenFile: (file: TargetFile) => void;
  onAddTarget: () => void;
}
```

**Step 2: Render structure**

For each target, render:
1. Target row with chevron (▾/▸) + name + small `stock_code` muted text.
2. If expanded and files loaded:
   - Loose root files first (relPath without `/`).
   - Then the seven sub-categories (`SUBCATEGORIES = ['纪要','专家交流','公司交流','研报','模型','公告','其它']`):
     - Each is an always-shown folder row (12.5px, folder icon).
     - If any file under that prefix → expandable row showing the files.
     - If none → row gets `is-disabled` class (gray, no expand chevron).

Keep depth indentation at 12px per level.

Use `rw-tree-row` / `is-active` / `is-disabled` classes from Task 1. Use `lucide-react` `ChevronRight`, `ChevronDown`, `Folder`, `FileText`, `FileCode` for icons.

**Step 3: Wrap container**

Replace the outer `<div className="w-56 border-r border-gray-200 ...">` with `<div className="rw-pane-left w-56 flex flex-col h-full">`. Drop `bg-white` (theme handles it).

The header (`Targets` + `+`) stays; restyle to use `rw-divider` for the bottom border and `text-[12.5px] font-medium`.

**Step 4: Build**

Run: `npm run build:renderer`
Expected: success. (Caller still old — next task wires it up.)

**Step 5: Commit**

```bash
git add src/renderer/components/research/TargetListSidebar.tsx
git commit -m "feat(research): tree-aware TargetListSidebar with sub-categories"
```

---

## Task 5 — `ResearchPage` host wiring (tree state + theme + 3-pane)

**Files:**
- Modify: `src/renderer/components/research/ResearchPage.tsx`

**Step 1: Adopt the new sidebar API**

Add state:
```ts
const [expandedCodes, setExpandedCodes] = useState<Set<string>>(new Set());
const [filesByCode, setFilesByCode] = useState<Record<string, TargetFile[]>>({});
const [activeFileAbsPath, setActiveFileAbsPath] = useState<string | null>(null);
```

Implement:
- `handleSelectTarget(code)` → set selected, ensure expanded, lazy-load files into `filesByCode` if missing. **Do not** auto-open `key-drivers.md` anymore (PaiWork shows tabs only when user opens a file).
- `handleToggleExpand(code)` → toggle in `expandedCodes`; lazy-load files if first expansion.
- `handleOpenFile(file)` → ensure a tab exists (id = `file.absPath`), set as active, set `activeFileAbsPath`. Reuse existing `Tab` shape; defer reading file contents to Task 6.

**Step 2: Apply theme + 3-pane layout**

Replace root with:

```tsx
import './research-theme.css';

<div data-theme="research" className="flex h-full w-full">
  <TargetListSidebar ... />
  <ContentTabs ... />     {/* upgraded in Task 6 */}
  <ResearchChatPane activeFileAbsPath={activeFileAbsPath} /> {/* added in Task 7 */}
</div>
```

Until Tasks 6/7 land, keep the current `ContentTabs` and `SkillActionsPanel` so the page still renders. (Plan order minimizes broken intermediate states; this task only swaps the sidebar.)

**Step 3: Build & manual smoke**

Run: `npm run build:renderer && npm run build:main`
Manually open the app, navigate to `/research`, confirm:
- Tree expands per target.
- Sub-categories render even when missing (grayed).
- Clicking a file opens a tab (with placeholder content).

**Step 4: Commit**

```bash
git add src/renderer/components/research/ResearchPage.tsx
git commit -m "feat(research): wire tree state + research theme on ResearchPage"
```

---

## Task 6 — `ContentTabs` upgrade (compact tabs + doc header + Markdown)

**Files:**
- Modify: `src/renderer/components/research/ContentTabs.tsx`
- Modify: `src/renderer/components/research/ResearchPage.tsx` (pass mtime + load file content on open)

**Step 1: Add document loading**

In `ResearchPage.handleOpenFile`, when creating a tab also kick off reading the file via the existing built-in tool used elsewhere. Search for the existing pattern in this folder before inventing one — use the same `window.electronAPI.builtinTools.execute('read_file', { path: absPath })` (or whichever tool name `usePortfolio` companion already uses for files). Store the result on the tab `content`. If the file is `.xlsx`, keep current spreadsheet branch.

Also stash mtime on the tab: extend `Tab` with `mtime?: number` (pulled from `TargetFile`).

**Step 2: Rewrite `ContentTabs` rendering**

- Outer: `<div className="flex-1 flex flex-col min-w-0 bg-[var(--rw-bg)]">`.
- **Tab strip**: `<div className="flex h-7 rw-divider overflow-x-auto">`; per-tab classes:
  - active: `rw-tab-active-bar bg-white text-[var(--rw-text)]`
  - inactive: `bg-[var(--rw-bg-soft)] text-[var(--rw-text-2)]`
  - 12.5px font, 12px horizontal padding, 8px gap before close `×`.
- Trailing `+` button (no-op, `disabled` for now).
- **Document header**: `<div className="flex items-center justify-between h-8 px-4 rw-divider text-[12.5px] text-[var(--rw-text-2)]">`
  - Left: `{basename}` + `· 最近更新 {formatTime(mtime)}` (use `Intl.DateTimeFormat`); show `—` if mtime is 0.
  - Right: icon buttons `Search`, `Download`, `MoreHorizontal` (lucide), each 24px square ghost; then a `保存` button styled as primary but `disabled` (no handler).
- **Body**: replace the `<pre>` Markdown text with `react-markdown` (already a dep) wrapped in `<div className="rw-doc-body prose prose-sm">`. For the spreadsheet branch keep `UniverSheet`. Apply a custom `td`/`th` renderer that detects status keywords (`边际改善|边际承压|边际恶化`) and replaces them with `<span class="rw-status-pill rw-status-good|warn|bad">…</span>`.

**Step 3: Empty state**

When `tabs.length === 0`, show centered text `从左侧选择文件以打开` with `text-[var(--rw-text-3)]`.

**Step 4: Build & smoke**

Run: `npm run build:renderer`
Open the app, expand a target, click `tracking.md` and `notes.md`. Verify:
- Tab strip is compact and active tab has top accent bar.
- Document header shows mtime.
- Status keywords in tracking.md render as colored pills.

**Step 5: Commit**

```bash
git add src/renderer/components/research/ContentTabs.tsx src/renderer/components/research/ResearchPage.tsx
git commit -m "feat(research): compact tabs + document header + Markdown body"
```

---

## Task 7 — Right pane: embed chat (`ResearchChatPane`)

**Files:**
- Create: `src/renderer/components/research/ResearchChatPane.tsx`
- Modify: `src/renderer/components/research/ResearchPage.tsx` (replace `SkillActionsPanel` with `ResearchChatPane`)

**Step 1: Create the wrapper**

```tsx
import React from 'react';
import ChatView from '../chat/ChatView';

interface ResearchChatPaneProps {
  activeFileAbsPath: string | null;
}

/**
 * Embeds the existing ChatView in the research workspace right pane.
 *
 * Visual compaction is delivered via scoped CSS overrides under
 * [data-theme="research"] .rw-pane-right (see research-theme.css).
 *
 * This iteration intentionally does NOT modify ChatView itself — that is
 * a follow-up task (compact mode prop). Today we constrain width and let
 * the existing component render inside the narrow pane.
 */
export const ResearchChatPane: React.FC<ResearchChatPaneProps> = ({ activeFileAbsPath: _activeFileAbsPath }) => {
  return (
    <aside className="rw-pane-right flex flex-col h-full" style={{ width: 380, flex: '0 0 380px' }}>
      <header className="flex items-center justify-between h-10 px-3 rw-divider" style={{ background: 'var(--rw-bg-chat-header)' }}>
        <span className="text-[13px] font-medium text-[var(--rw-text)]">PaiPai</span>
        {/* placeholder icon slots — wire up later */}
        <span className="text-[11px] text-[var(--rw-text-3)]">投研助手</span>
      </header>
      <div className="flex-1 min-h-0 overflow-hidden">
        <ChatView />
      </div>
    </aside>
  );
};
```

**Step 2: Wire into `ResearchPage`** — replace the `<SkillActionsPanel ... />` line with `<ResearchChatPane activeFileAbsPath={activeFileAbsPath} />`. Remove unused imports/handlers.

**Step 3: Add minimal narrowing CSS** to `research-theme.css`:

```css
[data-theme="research"] .rw-pane-right :where(input, textarea) { font-size: 13px; }
[data-theme="research"] .rw-pane-right { min-width: 320px; }
```

(Deeper compaction — message bubble restyle, tool-call chips, attachment chip — is intentionally deferred to Task 8.)

**Step 4: Build & smoke**

Run: `npm run build:renderer`
Open `/research`, confirm chat renders in the right pane and remains functional (send a message, see streaming).

**Step 5: Commit**

```bash
git add src/renderer/components/research/ResearchChatPane.tsx src/renderer/components/research/ResearchPage.tsx src/renderer/components/research/research-theme.css
git commit -m "feat(research): embed ChatView as right pane"
```

---

## Task 8 — ChatView compact mode (visual)

**Files:**
- Modify: `src/renderer/components/chat/ChatView.tsx`
- Possibly: a small new `src/renderer/components/chat/CompactToolCallChip.tsx`

**Note:** `ChatView` is large. Keep this task strictly visual; do not refactor logic.

**Step 1: Add `mode` prop**

```tsx
export interface ChatViewProps { mode?: 'full' | 'compact'; }
const ChatView: React.FC<ChatViewProps> = memo(({ mode = 'full' }) => { ... });
```

**Step 2: Apply a single class on the root** so all compact tweaks live in CSS:

```tsx
<div className={`chat-view ${mode === 'compact' ? 'chat-view--compact' : ''}`}> ... </div>
```

**Step 3: Add compact CSS** to `research-theme.css` (keeps theme bundling localized):

```css
[data-theme="research"] .chat-view--compact { font-size: 13.5px; }
[data-theme="research"] .chat-view--compact .message-bubble--user {
  background: var(--rw-accent-soft);
  color: var(--rw-text);
  border-radius: 12px;
  max-width: 80%;
}
[data-theme="research"] .chat-view--compact .message-bubble--assistant {
  background: transparent; padding: 0;
}
[data-theme="research"] .chat-view--compact .tool-call {
  font-size: 12px; padding: 4px 8px; border-radius: 999px;
  background: var(--rw-bg-soft); border: 1px solid var(--rw-border);
}
[data-theme="research"] .chat-view--compact textarea { font-size: 13px; }
[data-theme="research"] .chat-view--compact .send-button { border-radius: 999px; }
```

(The exact class names above must match the real ones inside `ChatView`/`Message`/`ChatInput`. Before writing CSS, **search those files for stable class names** and adjust selectors. If a stable hook does not exist, add a single `data-role` attribute to the relevant element rather than restructuring JSX.)

**Step 4: Wire prop in `ResearchChatPane`**

`<ChatView mode="compact" />`

**Step 5: Build & smoke**

Run: `npm run build:renderer`
Open `/research`, send a message with tool calls, verify:
- User bubble is purple-soft, right-aligned.
- Assistant content has no bubble.
- Tool calls render as compact pills.
- `/agent` page (full mode) is visually unchanged.

**Step 6: Commit**

```bash
git add src/renderer/components/chat/ChatView.tsx src/renderer/components/research/ResearchChatPane.tsx src/renderer/components/research/research-theme.css
git commit -m "feat(chat): compact visual mode for embedded research pane"
```

---

## Task 9 — Final visual polish & verification

**Files:** any of the above as needed; this task is for fit-and-finish only.

**Step 1: Manual checklist**

- `/agent` page renders identically to before this PR (no theme leakage).
- `/research` shows three panes; resizing the window keeps min-widths sane.
- Workspace tree: expand/collapse, missing sub-categories grayed, selected file highlighted.
- Document tabs: open multiple, close, switch active; mtime visible; status pills render.
- Chat compact: send a message, tool call chip, attachment chip area is visible (even if non-functional).
- `LeftNavigation` mode buttons reflect current route (`/agent` vs `/research`).

**Step 2: Build full**

Run: `npm run build`
Expected: success.

**Step 3: Final commit (only if any tweaks were made)**

```bash
git add -A
git commit -m "polish(research): visual fit-and-finish for PaiWork-style layout"
```

---

## Out of scope reminders (do NOT do in this plan)

- No top global search bar.
- No points/credits widget.
- No in-place document editing (Save button stays disabled).
- No PaiPai/PaiWork header switcher inside the research page.
- No global theme migration; do not edit Tailwind config.
- No new automated tests; manual verification only.
