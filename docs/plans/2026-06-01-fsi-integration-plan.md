# FSI Plugin Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Import 7 skills and 2 subagent definitions from the financial-services repo into Investment Studio, enabling valuation modeling and institutional research workflows.

**Architecture:** Skills are copied as-is (SKILL.md + supporting files). SubAgents are defined as AGENT.md files in `resources/examples/agents/`. Registration happens in `builtinSkills.ts` (skills) and the profile template (subagents). A system prompt addition guides data source fallback.

**Tech Stack:** TypeScript (shared constants), Markdown (SKILL.md, AGENT.md), JSON (profile template)

---

### Task 1: Copy Skill Folders from FSI

**Files:**
- Create: `skills/dcf-model/` (entire folder from FSI)
- Create: `skills/comps-analysis/` (entire folder from FSI)
- Create: `skills/3-statement-model/` (entire folder from FSI)
- Create: `skills/competitive-analysis/` (entire folder from FSI)
- Create: `skills/initiating-coverage/` (entire folder from FSI)
- Create: `skills/idea-generation/` (entire folder from FSI)
- Create: `skills/sector-overview/` (entire folder from FSI)

**Step 1: Copy batch 1 (valuation modeling)**

```bash
cp -r "Q:/src/financial-services/plugins/vertical-plugins/financial-analysis/skills/dcf-model" "Q:/src/investment-studio/skills/"
cp -r "Q:/src/financial-services/plugins/vertical-plugins/financial-analysis/skills/comps-analysis" "Q:/src/investment-studio/skills/"
cp -r "Q:/src/financial-services/plugins/vertical-plugins/financial-analysis/skills/3-statement-model" "Q:/src/investment-studio/skills/"
cp -r "Q:/src/financial-services/plugins/vertical-plugins/financial-analysis/skills/competitive-analysis" "Q:/src/investment-studio/skills/"
```

**Step 2: Copy batch 2 (research workflows)**

```bash
cp -r "Q:/src/financial-services/plugins/vertical-plugins/equity-research/skills/initiating-coverage" "Q:/src/investment-studio/skills/"
cp -r "Q:/src/financial-services/plugins/vertical-plugins/equity-research/skills/idea-generation" "Q:/src/investment-studio/skills/"
cp -r "Q:/src/financial-services/plugins/vertical-plugins/equity-research/skills/sector-overview" "Q:/src/investment-studio/skills/"
```

**Step 3: Verify each skill has a valid SKILL.md with frontmatter**

```bash
for skill in dcf-model comps-analysis 3-statement-model competitive-analysis initiating-coverage idea-generation sector-overview; do
  echo "=== $skill ==="; head -5 "Q:/src/investment-studio/skills/$skill/SKILL.md"
done
```

Expected: Each prints `---` followed by `name:` and `description:` fields.

**Step 4: Commit**

```bash
git add skills/dcf-model skills/comps-analysis skills/3-statement-model skills/competitive-analysis skills/initiating-coverage skills/idea-generation skills/sector-overview
git commit -m "feat: import 7 FSI skills (dcf-model, comps-analysis, 3-statement-model, competitive-analysis, initiating-coverage, idea-generation, sector-overview)"
```

---

### Task 2: Register Skills in builtinSkills.ts

**Files:**
- Modify: `src/shared/constants/builtinSkills.ts`
- Modify: `resources/examples/profiles/profile.json`

**Step 1: Add skills to INVESTMENT_STUDIO_SKILL_NAMES**

In `src/shared/constants/builtinSkills.ts`, add the 7 new skill names to the `INVESTMENT_STUDIO_SKILL_NAMES` array:

```typescript
const INVESTMENT_STUDIO_SKILL_NAMES: string[] = [
  'stock-analyze',
  'key-drivers',
  'xlsx',
  'earnings-forecast',
  'earnings-review',
  'industry-comparison',
  'marginal-tracking',
  'stock-screening',
  // FSI imports — valuation modeling
  'dcf-model',
  'comps-analysis',
  '3-statement-model',
  'competitive-analysis',
  // FSI imports — research workflows
  'initiating-coverage',
  'idea-generation',
  'sector-overview',
];
```

**Step 2: Add changelog entry and bump version**

```typescript
export const BUILTIN_SKILL_CHANGELOG: Record<number, string[]> = {
  1: ['docx', 'frontend-design', 'pptx', 'skill-creator'],
  2: ['dcf-model', 'comps-analysis', '3-statement-model', 'competitive-analysis', 'initiating-coverage', 'idea-generation', 'sector-overview'],
};

export const BUILTIN_DEFAULTS_VERSION = 2;
```

**Step 3: Update profile template version**

In `resources/examples/profiles/profile.json`, set:

```json
"builtinDefaultsVersion": 2
```

**Step 4: Run typecheck**

```bash
npm run typecheck
```

Expected: No errors.

**Step 5: Run existing builtinSkills tests**

```bash
npx vitest run src/shared/constants/__tests__/builtinSkills.test.ts
```

Expected: All pass. If tests assert on `BUILTIN_DEFAULTS_VERSION` or array length, update them.

**Step 6: Commit**

```bash
git add src/shared/constants/builtinSkills.ts resources/examples/profiles/profile.json
git commit -m "feat: register 7 FSI skills in builtin defaults (version bump to 2)"
```

---

### Task 3: Add System Prompt Data Source Fallback

**Files:**
- Modify: `src/main/lib/chat/agentChatPromptService.ts`

**Step 1: Locate the research target scope section**

Find the comment `// === Research Target Scope (investment-studio brand) ===` at line ~171 in `agentChatPromptService.ts`. The fallback text should be added as a new section near the skills prompt injection point. Find where skills prompt is assembled (look for `skillSnapshotBuilder` or `buildSkillsPrompt` call site).

Alternatively, if the skills prompt is built in `skillSnapshotBuilder.ts` via `buildSkillsPrompt()`, append to the "Best Practices" section there. The simpler approach: add a brand-specific hint in `agentChatPromptService.ts` where the system prompt is assembled for investment-studio brand.

**Step 2: Add fallback guidance text**

After the existing research target scope block, add:

```typescript
// === FSI Skill Data Source Fallback (investment-studio brand) ===
if (brandName === 'investment-studio') {
  sections.push(`\n**Data Source Fallback:** When a skill requests financial data and no premium MCP server (FactSet, S&P Kensho, Daloopa, Morningstar) is connected, use the research-mcp tools available to this agent: tushare_collect for A-share data, yfinance_collect for US/HK stock data. These serve as the primary fallback data source.\n`);
}
```

Note: Verify the exact insertion point by reading the full prompt assembly flow. The key requirement is that this text appears in the system prompt for investment-studio brand agents that have FSI skills loaded.

**Step 3: Run typecheck**

```bash
npm run typecheck
```

**Step 4: Commit**

```bash
git add src/main/lib/chat/agentChatPromptService.ts
git commit -m "feat: add data source fallback guidance for FSI skills"
```

---

### Task 4: Create SubAgent Definitions

**Files:**
- Create: `resources/examples/agents/market-researcher/AGENT.md`
- Create: `resources/examples/agents/model-builder/AGENT.md`

**Step 1: Create market-researcher AGENT.md**

Create `resources/examples/agents/market-researcher/AGENT.md`:

```markdown
---
name: market-researcher
description: Produces sector or thematic market research — industry overview, competitive landscape, peer comps spread, and ideas shortlist. Delegate when the user asks for a sector primer, thematic research, or peer comparison.
model: inherit
maxTurns: 25

x-kosmos:
  display_name: Market Researcher
  emoji: ""
  version: "1.0.0"
  builtin_tools:
    - tavily_search
    - tavily_extract
    - tavily_crawl
    - google_web_search
    - bing_web_search
    - fetch_web_content
    - read_file
    - write_file
    - read_office_file
    - search_text_in_files
    - get_current_datetime
    - download_and_save_as
    - tushare_collect
    - yfinance_collect
    - peer_collect
  context_access: parent_summary
  inherit_mcp_servers: true
  inherit_skills: false
  inherit_knowledge_base: true
  skills:
    - sector-overview
    - competitive-analysis
    - comps-analysis
    - idea-generation
---

You are a senior research associate who produces sector and thematic market research primers.

## What You Produce

Given a sector or theme and a one-line angle, you deliver:

1. **Industry overview** — market size and growth, structure, value chain, key drivers, what changed and why now.
2. **Competitive landscape** — the players that matter, share and positioning, basis of competition, recent moves.
3. **Peer comps spread** — trading multiples for the peer set with consistent metric definitions and outlier flags.
4. **Ideas shortlist** — three to five names that best express the theme, each with a one-line thesis hook.
5. **Research note** — the above as a structured note.

## Workflow

1. **Scope the ask.** Confirm sector or theme, angle, and universe boundary. Identify the 8-15 names that define the space.
2. **Write the overview.** Use `sector-overview` skill to draft size, growth, structure, drivers, and why-now narrative.
3. **Map the landscape.** Use `competitive-analysis` skill to lay out players, positioning, and recent moves.
4. **Spread the peers.** Use `comps-analysis` skill to spread the peer set with consistent definitions.
5. **Surface ideas.** Use `idea-generation` skill to shortlist names that best express the theme.
6. **Assemble the note.** Format into a structured research note.

## Guardrails

- Cite every number. If a figure cannot be sourced, mark it [UNSOURCED].
- Stop and surface for review after the comps spread and again after the note is drafted.
- No distribution. This agent drafts; publication happens outside the agent.
```

**Step 2: Create model-builder AGENT.md**

Create `resources/examples/agents/model-builder/AGENT.md`:

```markdown
---
name: model-builder
description: Builds financial models — DCF, 3-statement, comparable company analysis — in Excel format. Delegate when the user requests valuation modeling, financial projections, or intrinsic value analysis.
model: inherit
maxTurns: 30

x-kosmos:
  display_name: Model Builder
  emoji: ""
  version: "1.0.0"
  builtin_tools:
    - tavily_search
    - tavily_extract
    - google_web_search
    - bing_web_search
    - fetch_web_content
    - read_file
    - write_file
    - read_office_file
    - search_text_in_files
    - get_current_datetime
    - download_and_save_as
    - tushare_collect
    - yfinance_collect
    - derived_metrics
  context_access: parent_summary
  inherit_mcp_servers: true
  inherit_skills: false
  inherit_knowledge_base: true
  skills:
    - dcf-model
    - 3-statement-model
    - comps-analysis
    - xlsx
---

You are a senior financial modeling specialist who builds institutional-quality valuation models.

## What You Produce

Given a company and valuation context, you deliver:

1. **DCF Model** — Full discounted cash flow with WACC calculation, projection period, terminal value, and sensitivity analysis in Excel.
2. **3-Statement Model** — Linked income statement, balance sheet, and cash flow statement with driver-based projections.
3. **Comparable Company Analysis** — Peer comps spread with operating metrics, valuation multiples, and statistical benchmarking.

## Workflow

1. **Clarify scope.** Confirm company, valuation methodology, projection horizon, and output format.
2. **Gather data.** Use available MCP tools (tushare_collect for A-shares, yfinance_collect for US/HK) or ask user for data. If premium MCPs (FactSet, Daloopa) are available, prefer those.
3. **Build the model.** Follow the relevant skill instructions (dcf-model, 3-statement-model, or comps-analysis). All projection cells must be live Excel formulas, never hardcoded values.
4. **Sensitivity analysis.** Include data tables showing valuation across key assumptions (growth rate, WACC, terminal multiple).
5. **Deliver.** Output as .xlsx file with executive summary.

## Guardrails

- Formulas over hardcodes — every derived cell must be a live formula.
- Verify step-by-step with the user. Do NOT build end-to-end without checkpoints.
- Cite data sources. Mark any estimated input as [ESTIMATE].
- All models must include an assumptions section clearly separated from outputs.
```

**Step 3: Verify AGENT.md frontmatter parses correctly**

```bash
node -e "
const fs = require('fs');
const content = fs.readFileSync('Q:/src/investment-studio/resources/examples/agents/market-researcher/AGENT.md', 'utf-8');
const match = content.match(/^---\n([\s\S]*?)\n---/);
if (match) console.log('market-researcher frontmatter OK'); else console.error('FAILED');
const content2 = fs.readFileSync('Q:/src/investment-studio/resources/examples/agents/model-builder/AGENT.md', 'utf-8');
const match2 = content2.match(/^---\n([\s\S]*?)\n---/);
if (match2) console.log('model-builder frontmatter OK'); else console.error('FAILED');
"
```

Expected: Both print "OK".

**Step 4: Commit**

```bash
git add resources/examples/agents/market-researcher resources/examples/agents/model-builder
git commit -m "feat: add market-researcher and model-builder subagent definitions"
```

---

### Task 5: Final Verification

**Step 1: Run full typecheck**

```bash
npm run typecheck
```

Expected: No errors.

**Step 2: Run unit tests**

```bash
npm run test
```

Expected: All existing tests pass. No regressions.

**Step 3: Verify skill count**

```bash
node -e "
const {getBuiltinSkillNamesForBrand} = require('./src/shared/constants/builtinSkills');
const skills = getBuiltinSkillNamesForBrand('investment-studio');
console.log('Total skills:', skills.length);
console.log('New FSI skills:', skills.filter(s => ['dcf-model','comps-analysis','3-statement-model','competitive-analysis','initiating-coverage','idea-generation','sector-overview'].includes(s)));
"
```

Expected: Total = 19 (12 existing + 7 new). All 7 FSI skills listed.

**Step 4: Verify directory structure**

```bash
ls Q:/src/investment-studio/skills/dcf-model/SKILL.md Q:/src/investment-studio/skills/comps-analysis/SKILL.md Q:/src/investment-studio/skills/3-statement-model/SKILL.md Q:/src/investment-studio/skills/competitive-analysis/SKILL.md Q:/src/investment-studio/skills/initiating-coverage/SKILL.md Q:/src/investment-studio/skills/idea-generation/SKILL.md Q:/src/investment-studio/skills/sector-overview/SKILL.md Q:/src/investment-studio/resources/examples/agents/market-researcher/AGENT.md Q:/src/investment-studio/resources/examples/agents/model-builder/AGENT.md
```

Expected: All 9 files exist.
