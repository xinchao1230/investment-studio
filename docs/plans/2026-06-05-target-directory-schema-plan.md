# Research Target Directory Schema — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the prompt-injected canonical schema the single source of truth for a research target's directory layout. Remove the sidebar's 7 always-rendered Chinese virtual folders. Stop `portfolio_init_target` from pre-creating subfolders other than `inputs/`. Migrate `研报/` → `research/` in Stella's prompt and the `stock-analyze` skill.

**Architecture:** Three surfaces participate today (sidebar virtual folders, `portfolio_init_target` mkdir behaviour + tool description, Stella system prompt). After this change, the per-chat prompt context (`agentChatPromptService.ts`) is the canonical schema source; the sidebar mirrors disk; `portfolio_init_target` only seeds `inputs/` and the 4 root template files; Stella + `stock-analyze` reference `research/` instead of `研报/`.

**Tech Stack:** TypeScript (Electron main + renderer), Vitest, React. No new dependencies.

**Design doc:** [docs/plans/2026-06-05-target-directory-schema-design.md](2026-06-05-target-directory-schema-design.md)

---

## Task 1: `portfolio_init_target` stops creating `earnings/` and `models/`

**Files:**
- Modify: `src/main/lib/mcpRuntime/builtinTools/portfolioTools.ts` (around L380-L388 — the `mkdirSync` block in `executeInitTarget`)
- Modify: `src/main/lib/mcpRuntime/builtinTools/__tests__/portfolioTools.test.ts` (L30-L36 and any sibling assertions about `earnings/` / `models/` existing)

**Step 1: Update the existing test to assert new contract**

In `portfolioTools.test.ts`, find the first `describe('executeInitTarget'` block. Replace the assertion that `earnings/` and `models/` exist with assertions that they do NOT exist, and that `inputs/` does exist. Keep the assertions for `profile.yaml`, `key-drivers.md`, `notes.md`, `tracking.md`, `inputs/` directory.

Example shape:

```ts
expect(fs.existsSync(path.join(targetDir, 'inputs'))).toBe(true);
expect(fs.existsSync(path.join(targetDir, 'earnings'))).toBe(false);
expect(fs.existsSync(path.join(targetDir, 'models'))).toBe(false);
expect(fs.existsSync(path.join(targetDir, 'research'))).toBe(false);
```

**Step 2: Run the failing test**

```pwsh
npx vitest run src/main/lib/mcpRuntime/builtinTools/__tests__/portfolioTools.test.ts
```

Expected: FAIL — the new "does NOT exist" assertions fail because `earnings/` and `models/` are still being created.

**Step 3: Remove the unwanted `mkdirSync` calls**

In `portfolioTools.ts` `executeInitTarget`, delete the two lines:

```ts
fs.mkdirSync(path.join(targetDir, 'earnings'), { recursive: true });
fs.mkdirSync(path.join(targetDir, 'models'), { recursive: true });
```

Also delete the multi-line comment block immediately above them about why `research/` isn't pre-created (that comment becomes redundant — none of the business subdirs are pre-created anymore). Keep the `mkdir inputs/` line.

**Step 4: Run the test to verify it passes**

```pwsh
npx vitest run src/main/lib/mcpRuntime/builtinTools/__tests__/portfolioTools.test.ts
```

Expected: PASS.

**Step 5: Commit**

```pwsh
git add src/main/lib/mcpRuntime/builtinTools/portfolioTools.ts src/main/lib/mcpRuntime/builtinTools/__tests__/portfolioTools.test.ts
git commit -m "feat(portfolio): pre-create only inputs/ on init_target" -m "Business subdirectories (earnings/, research/, models/, ...) are now created on demand by the agent, driven by the canonical schema injected via agentChatPromptService. portfolio_init_target only seeds inputs/ (needed for chat-attachment landing) plus the 4 root template files."
```

---

## Task 2: Rewrite `portfolio_init_target` tool description

**Files:**
- Modify: `src/main/lib/mcpRuntime/builtinTools/portfolioTools.ts` `getInitTargetDefinition()` description string (around L98-L105)

No test — tool descriptions are LLM-facing, not testable through code.

**Step 1: Replace the description string**

Current text says it creates `inputs/, earnings/, research/, models/`. Replace with text that:

- States what it actually creates: `profile.yaml`, `key-drivers.md`, `notes.md`, `tracking.md`, `inputs/`.
- Lists the canonical on-demand schema for the LLM to know where to write later: `earnings/`, `research/`, `models/`, `meetings/`, `filings/`.
- Notes "Create subdirectories on demand — do not call any mkdir tool to pre-create empty business directories."

Keep the existing notes about `stock_code` handling for unlisted companies.

**Step 2: Verify typecheck**

```pwsh
npx tsc -p tsconfig.main.json --noEmit
```

Expected: Exit 0.

**Step 3: Commit**

```pwsh
git add src/main/lib/mcpRuntime/builtinTools/portfolioTools.ts
git commit -m "docs(portfolio): rewrite init_target tool description for the new schema"
```

---

## Task 3: Inject canonical schema in per-chat target context prompt

**Files:**
- Modify: `src/main/lib/chat/agentChatPromptService.ts` (L234-L251 — the target-directory section inside `getAgentSpecificSystemPrompt`)

**Step 1: Replace the scattered bullets with one schema table**

Find the block that pushes lines like:

```ts
sections.push(`- \`inputs/\` — User-attached files ...`);
sections.push(`- \`earnings/\` — Financial CSV data ...`);
sections.push(`- \`models/\` — Valuation models and scripts.`);
sections.push(`- 估值锚：... 在 \`research/\` 下输出估值参考报告。`);
sections.push(`- \`profile.yaml\`, \`key-drivers.md\`, \`notes.md\`, \`tracking.md\` — pre-created templates; update in place.`);
```

Replace with one cohesive block that:

1. Lists the 4 pre-created root template files (purpose each).
2. Lists the canonical subdirectories table (Markdown table with columns: Subdirectory | Purpose | Who writes). Six rows: `inputs/`, `earnings/`, `research/`, `models/`, `meetings/`, `filings/`.
3. Adds one rule line: "Create subdirectories on demand — do NOT pre-create empty business directories."
4. Adds one path-format reminder: "All paths must be the complete absolute target path; never abbreviate with `...` or `~`."

Branch on `listed` (existing variable in scope) only where wording differs (e.g., unlisted target's `earnings/` row).

**Step 2: Verify typecheck**

```pwsh
npx tsc -p tsconfig.main.json --noEmit
```

Expected: Exit 0.

**Step 3: Run any prompt-service tests**

```pwsh
npx vitest run src/main/lib/chat/__tests__/agentChatPromptService.coverage.test.ts
```

Expected: PASS. If any snapshot mismatches occur, inspect the diff — should match the new schema text — and update with `-u` only after manual review confirms it's the intended change.

**Step 4: Commit**

```pwsh
git add src/main/lib/chat/agentChatPromptService.ts src/main/lib/chat/__tests__/agentChatPromptService.coverage.test.ts
git commit -m "feat(prompt): inject canonical target-directory schema as single source of truth"
```

---

## Task 4: Update Stella system prompt — `研报/` → `research/`

**Files:**
- Modify: `src/main/lib/userDataADO/types/profile.ts` (around L869 — the `DEFAULT_CHAT_AGENT_STELLA.system_prompt` long string)

**Step 1: Locate and replace**

Find the substring `研报/stock-analyze/{YYYY-MM-DD}/report.md` inside the system_prompt string and replace with `research/stock-analyze/{YYYY-MM-DD}/report.md`. Also scan the same string for any other `研报/`, `纪要/`, `专家交流/`, `公司交流/`, `模型/`, `公告/`, `其它/` directory-path references and update each individually.

Conceptual mentions of 研报 / 纪要 as nouns (e.g., "撰写研报", "晨会纪要") are NOT to be changed — only directory paths.

**Step 2: Verify typecheck**

```pwsh
npx tsc -p tsconfig.main.json --noEmit
```

Expected: Exit 0.

**Step 3: Run profile tests**

```pwsh
npx vitest run src/main/lib/userDataADO/__tests__
```

Expected: PASS.

**Step 4: Commit**

```pwsh
git add src/main/lib/userDataADO/types/profile.ts
git commit -m "fix(stella): migrate 研报/ path references to research/ in system prompt"
```

---

## Task 5: Migrate `stock-analyze` skill paths — `研报/` → `research/`

**Files:**
- Modify: `skills/stock-analyze/SKILL.md` (six occurrences at L56, L86, L98, L192, L208, L213, L215 — verify by reading first)

**Step 1: Read the file to confirm occurrences**

```pwsh
Select-String -Path skills\stock-analyze\SKILL.md -Pattern "研报/" -SimpleMatch
```

Expected: ~6 hits.

**Step 2: Replace each occurrence individually**

For each line with `{targetDir}/研报/stock-analyze/...`, replace `研报/stock-analyze` with `research/stock-analyze`. Keep surrounding text (`{targetDir}/...{date}/raw_data/` etc.) verbatim.

Do NOT touch:
- `skills/stock-analyze/prompts/*.md` — those use 研报 as a noun ("撰写研报的XX章节"), not a path.
- The skill description / title text that uses 研报 conceptually.
- Other skills (`key-drivers`, `morning-note`, `audit-xls`, `model-update`, `3-statement-model`) — verified by audit to contain no directory-path hardcodes.

**Step 3: Verify replacements**

```pwsh
Select-String -Path skills\stock-analyze\SKILL.md -Pattern "研报/" -SimpleMatch
```

Expected: 0 hits.

```pwsh
Select-String -Path skills\stock-analyze\SKILL.md -Pattern "research/stock-analyze" -SimpleMatch
```

Expected: 6 hits.

**Step 4: Commit**

```pwsh
git add skills/stock-analyze/SKILL.md
git commit -m "fix(skill/stock-analyze): migrate 研报/ output paths to research/"
```

---

## Task 6: Remove `SUBCATEGORIES` virtual folders from the sidebar

**Files:**
- Modify: `src/renderer/components/research/TargetListSidebar.tsx` (L139-L173 — constants + helper; plus L1169-L1173 — the `cats` computation; plus all call sites of `subcategoryLabel()`)

**Step 1: Locate every reference**

```pwsh
Select-String -Path src\renderer\components\research\TargetListSidebar.tsx -Pattern "SUBCATEGORIES|SUBCATEGORY_LABELS|subcategoryLabel"
```

Expected: hits at constant definition, helper definition, `cats` computation, and 2–3 JSX render sites.

**Step 2: Delete the constants and helper**

Remove the three declarations (`SUBCATEGORIES`, `SUBCATEGORY_LABELS`, `subcategoryLabel`) and the multi-line comment above them.

**Step 3: Rewrite the `cats` computation**

Replace:

```ts
const extras = Array.from(new Set(
  /* ... that filter against SUBCATEGORIES ... */
));
return [...SUBCATEGORIES, ...extras];
```

with a single computation that produces the union of disk-derived categories and `optimisticFolders[code]`, sorted alphabetically:

```ts
const diskCats = /* existing source */;
const optimistic = optimisticFolders[code] ?? [];
return Array.from(new Set([...diskCats, ...optimistic])).sort();
```

(Adapt to the actual variable names — confirm by reading the surrounding block first.)

**Step 4: Replace `subcategoryLabel(cat)` call sites**

Wherever the JSX rendered the label as `{subcategoryLabel(cat)}`, change to `{cat}` (folder name shown as-is — English schema is canonical, no display-time relabel).

**Step 5: Verify typecheck**

```pwsh
npx tsc -p tsconfig.renderer.json --noEmit
```

Expected: Exit 0.

**Step 6: Run renderer tests if any**

```pwsh
npx vitest run src/renderer/components/research
```

Expected: PASS (or "no test files found" — there are no SUBCATEGORIES tests today).

**Step 7: Commit**

```pwsh
git add src/renderer/components/research/TargetListSidebar.tsx
git commit -m "feat(sidebar): drop hard-coded SUBCATEGORIES virtual folders" -m "Sidebar now reflects on-disk reality only. The canonical target-directory schema is now expressed via prompt (see agentChatPromptService) rather than via UI scaffolding."
```

---

## Task 7: Full-project verification

**Files:** none modified.

**Step 1: TypeScript**

```pwsh
npx tsc -p tsconfig.main.json --noEmit
npx tsc -p tsconfig.renderer.json --noEmit
```

Expected: both exit 0.

**Step 2: Full Vitest run**

```pwsh
npm test
```

Expected: all suites pass. If a snapshot test for `agentChatPromptService` or `portfolioTools` fails because the prompt text changed, inspect the diff — should match the new schema text — and re-run with `-u` only after manual review.

**Step 3: Sweep for stragglers**

```pwsh
Select-String -Path src,skills -Recurse -Pattern "研报/|纪要/|专家交流/|公司交流/|模型/|公告/" -SimpleMatch -ErrorAction SilentlyContinue
```

Expected: zero hits in `src/` and `skills/`. (Hits inside `resources/mcp/research/.venv/` are third-party Python package internals — ignore.) Any other hit means a hardcoded path was missed.

**Step 4: Manual smoke (user-driven)**

1. Close the app.
2. Clear userdata: delete `%APPDATA%\investment-studio-app\profiles\default\portfolio\` (or whatever portfolio root resolves to).
3. Restart `npm run dev`.
4. Create a new target (e.g. `腾讯控股 / 00700.HK`).
5. Verify in the sidebar:
   - 4 files visible: `key-drivers.md`, `notes.md`, `profile.yaml`, `tracking.md`.
   - 1 folder visible: `inputs/` (or hidden if collapsed because empty — confirm both ways).
   - **No** `Meeting Notes`, `Expert Calls`, `Management Meetings`, `Research`, `Models`, `Filings & Announcements`, `Other` rows.
6. Run an earnings-reviewer agent — verify `earnings/` appears in the sidebar after first file is written.
7. Run `stock-analyze` skill — verify file lands at `<target>/research/stock-analyze/2026-06-05/report.md`, sidebar shows `research/` folder.

**Step 5: No commit needed for verification.** If everything green, the feature is complete.

---

## Remember

- DRY: don't duplicate the schema text across surfaces — `agentChatPromptService.ts` is canonical, tool description summarises it, Stella prompt references it.
- YAGNI: no migration code (user clears userdata), no display-time relabelling (English is canonical), no per-target schema overrides.
- TDD: Tasks 1 has a real failing test first. Tasks 2-6 are mostly string changes to prompts; rely on typecheck + integration smoke for verification.
- Commit each task separately so any single task can be reverted independently.
