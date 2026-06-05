# Research Target Directory Schema — Design

<!-- Last verified: 2026-06-05 -->

## Problem

A research target's directory has **three inconsistent schemas** today:

| Source | Schema | Where |
|---|---|---|
| Sidebar (UI, always rendered as virtual folders) | `纪要 / 专家交流 / 公司交流 / 研报 / 模型 / 公告 / 其它` (Chinese) | [TargetListSidebar.tsx L139-L156](../../src/renderer/components/research/TargetListSidebar.tsx#L139-L156) |
| `portfolio_init_target` tool description (shown to LLM) | `inputs/ earnings/ research/ models/` (English, claims to create all 4) | [portfolioTools.ts L101](../../src/main/lib/mcpRuntime/builtinTools/portfolioTools.ts#L101) |
| `portfolio_init_target` actual `mkdir` behaviour | `inputs/ earnings/ models/` (does NOT create `research/`, comment says it confuses the LLM) | [portfolioTools.ts L380-L388](../../src/main/lib/mcpRuntime/builtinTools/portfolioTools.ts#L380-L388) |
| Prompt context injected per chat (`agentChatPromptService`) | `inputs/ earnings/ models/` + an ad-hoc bullet recommending `research/` | [agentChatPromptService.ts L234-L251](../../src/main/lib/chat/agentChatPromptService.ts#L234-L251) |
| Stella system prompt + stock-analyze skill output path | `研报/stock-analyze/{YYYY-MM-DD}/report.md` (Chinese) | [profile.ts L869](../../src/main/lib/userDataADO/types/profile.ts#L869) |

Symptoms:

- Sidebar shows 7 "fake" folders that don't exist on disk; they look real, but `portfolio_init_target` never creates them.
- LLM flips between `研报/` and `research/` depending on which context it last read, producing reports under both paths and confusing the sidebar.
- New users see a busy, empty scaffold instead of "what's actually here".

## Goal

One canonical schema, expressed in **prompts** (not in code, not in UI scaffolding). Sidebar mirrors disk reality. `portfolio_init_target` pre-creates only what the system itself needs.

## Decisions

| Question | Decision |
|---|---|
| Schema language | English |
| Sidebar virtual folders | Remove |
| Pre-created root template files | Keep all 4 (`profile.yaml`, `key-drivers.md`, `notes.md`, `tracking.md`) |
| Pre-created subfolders | Only `inputs/` (chat-attachment landing zone) |
| Schema source of truth | Prompt context injected by `agentChatPromptService.ts` + `portfolio_init_target` tool description |
| Migration of existing targets | None — user will clear userdata |

## Canonical Schema

```
{targetDir}/
├── profile.yaml          [pre-created] Target metadata (stock_code, name, industry, ...)
├── key-drivers.md        [pre-created] Investment thesis + key tracking variables
├── notes.md              [pre-created] Free-form research notes
├── tracking.md           [pre-created] Marginal-change table
├── inputs/               [pre-created] User-uploaded attachments (system-maintained)
├── earnings/             [on-demand]  Financial CSVs + earnings reviews
├── research/             [on-demand]  Industry / comparable / stock-analyze reports
├── models/               [on-demand]  Valuation model scripts (fetch_*.py, analyze_*.py)
├── meetings/             [on-demand]  Meeting notes, expert calls, management interactions
└── filings/              [on-demand]  Prospectuses, annual reports, regulatory disclosures
```

"Misc" / 其它 == target root itself. No separate `other/` directory.

Hard rule injected into the prompt: **do not `mkdir` empty directories**. A subdirectory exists iff at least one file has been written to it.

## Changes

### Code

| File | Change | Risk |
|---|---|---|
| [`portfolioTools.ts`](../../src/main/lib/mcpRuntime/builtinTools/portfolioTools.ts) `executeInitTarget` | Drop `mkdir earnings/` and `mkdir models/`. Keep only `mkdir inputs/` + the 4 template files. | Low |
| [`portfolioTools.ts`](../../src/main/lib/mcpRuntime/builtinTools/portfolioTools.ts) `getInitTargetDefinition().description` | Rewrite to list the 6 canonical subdirectories with one-line purposes + "create on demand". | Low |
| [`agentChatPromptService.ts`](../../src/main/lib/chat/agentChatPromptService.ts#L234-L251) | Replace the scattered `inputs/ earnings/ models/` bullets and the standalone `research/` recommendation with a single schema table identical to the one above. Add the "do not pre-create empty dirs" rule. | Medium (changes LLM behaviour) |
| [`TargetListSidebar.tsx`](../../src/renderer/components/research/TargetListSidebar.tsx#L139-L173) | Delete `SUBCATEGORIES`, `SUBCATEGORY_LABELS`, `subcategoryLabel()`. Folder list becomes the union of disk-derived categories + `optimisticFolders`. Wherever `subcategoryLabel(cat)` was called, render `cat` as-is. | Medium (visible UI change) |
| [`profile.ts`](../../src/main/lib/userDataADO/types/profile.ts#L869) Stella system prompt | `研报/stock-analyze/{YYYY-MM-DD}/report.md` → `research/stock-analyze/{YYYY-MM-DD}/report.md`. Sample paths under `腾讯控股/earnings/...` are already English; leave them. | Medium |
| `skills/**/SKILL.md`, `resources/examples/skills/**` | Global search for `研报\|纪要\|专家交流\|公司交流\|模型\|公告` and replace with the English equivalents. Each occurrence reviewed individually. | Medium (need to audit each skill) |
| [`portfolioTools.test.ts`](../../src/main/lib/mcpRuntime/builtinTools/__tests__/portfolioTools.test.ts) | Assert only `inputs/` and the 4 template files. Remove assertions for `earnings/` and `models/`. | Low |
| Any `TargetListSidebar` tests referencing `SUBCATEGORIES` | Update / remove. | Low |

### Out of scope

- [`agentChatToolPostProcessor.ts`](../../src/main/lib/chat/agentChatToolPostProcessor.ts) — only handles chat-session binding; not affected.
- Migration scripts for existing on-disk Chinese folders — user accepts a clean userdata reset.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| LLM keeps writing to `研报/` after the prompt change (because the model has strong priors from the previous schema) | Schema is now stated in **two** prompt locations (tool description + per-chat target context). Stella's system prompt also corrected. Spot-check first 2-3 stock-analyze runs after the change. |
| Existing targets show as "extras" (raw on-disk Chinese folder names) under sidebar | Accepted — user is clearing userdata. No code path needed. |
| Skills outside the repo (user-installed) hardcode `研报/` | Out of repo scope; user will discover during use and update. |
| Empty-dir hard rule violated by some legacy code path | Audit during implementation; only one current site (`portfolio_init_target`) plus any skill that runs `os.makedirs` unconditionally. |

## Verification

1. `npx tsc -p tsconfig.main.json --noEmit` and `npx tsc -p tsconfig.renderer.json --noEmit` — both exit 0.
2. `npx vitest run src/main/lib/mcpRuntime/builtinTools/__tests__/portfolioTools.test.ts` + any sidebar tests — pass.
3. `grep -r "研报\|纪要\|专家交流\|公司交流\|模型\|公告" skills/ src/ resources/` — only legacy changelog / postmortem entries remain.
4. Manual: clear userdata → start app → create a new target → only the 4 template files visible, no empty folders. Run earnings-reviewer → `earnings/` appears. Run stock-analyze → `research/stock-analyze/2026-06-05/report.md` appears.

## Non-goals

- Changing per-chat-session or per-sub-agent deliverables directory layout (those live under `chat_workspaces/`, separate concern).
- Internationalising the schema (English is the canonical form; no display-time relabelling).
- Auto-migrating existing data.
