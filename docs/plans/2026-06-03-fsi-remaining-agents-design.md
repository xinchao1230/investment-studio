# FSI Remaining Agents — Design Doc

> **Date:** 2026-06-03
> **Status:** Implemented
> **Predecessor:** [2026-06-01-fsi-integration-plan.md](2026-06-01-fsi-integration-plan.md) (first 3 agents)

## Goal

Complete the FSI integration by importing the remaining 7 `role-based agent plugins` from `Q:\src\financial-services\plugins\agent-plugins\` into Investment Studio. After this change, all 10 FSI agents are available out of the box.

## Scope

| # | Agent | Role | Imported skills (new in v5) |
|---|---|---|---|
| 1 | `pitch-agent` | IB associate (pitch decks + valuation) | `pitch-deck, ib-check-deck, deck-refresh, lbo-model, pptx-author, xlsx-author` |
| 2 | `meeting-prep-agent` | RM briefing pack builder | `client-review, client-report, investment-proposal` (+ shared `pptx-author`) |
| 3 | `valuation-reviewer` | LP valuation reviewer | `ic-memo, portfolio-monitoring, returns-analysis` (+ shared `xlsx-author`) |
| 4 | `gl-reconciler` | Daily GL ↔ subledger recon | `gl-recon, break-trace` (+ shared `audit-xls, xlsx-author`) |
| 5 | `month-end-closer` | Period-end close | `accrual-schedule, roll-forward, variance-commentary` (+ shared) |
| 6 | `statement-auditor` | LP statement final check | `nav-tieout` (+ shared) |
| 7 | `kyc-screener` | KYC/AML onboarding screening | `kyc-doc-parse, kyc-rules` (+ shared) |

Total: **7 agents + 20 new skills** (sourced from `vertical-plugins/` as the authoritative location, matching the v2–v4 import path).

## Architecture

Same pattern as the first 3 agents:

```
resources/examples/agents/<agent>/AGENT.md   ← AGENT.md (auto-seeded into profile by builtinAgentSeeder)
skills/<skill>/SKILL.md                       ← skill bundle (auto-seeded into profile by builtinSkillSeeder)
src/shared/constants/builtinAgents.ts         ← register agent name + sub-agent-exclusive skills
src/shared/constants/builtinSkills.ts         ← register skill names + version changelog
resources/examples/profiles/profile.json      ← bump builtinDefaultsVersion
```

### Transformation rules (FSI `agents/<n>.md` → Kosmos `AGENT.md`)

Per user requirement "保持原样的完整性，不要损失功能质量" — preserve all workflow steps, guardrails, and skill references. Adapt only what does not transfer 1:1:

1. **Frontmatter:**
   - Replace Claude-style `tools: Read, Write, Edit, mcp__capiq__*` with Kosmos `x-kosmos.builtin_tools` list
   - Add `model: inherit`, `maxTurns: <20-35 by complexity>`
   - Add `x-kosmos: { display_name, version, builtin_tools, context_access: parent_summary, inherit_mcp_servers: true, inherit_skills: false, inherit_knowledge_base: true, skills: [...] }`

2. **Body text:**
   - "Invoke X" → "Use X skill" (cosmetic; no semantic change)
   - **Data Sources section** added with three-tier structure (`Primary institutional MCP` / `Fallback research-mcp` / `Always acceptable user-supplied`). Replaces hard-coded references to CapIQ/FactSet/Daloopa.
   - All other workflow steps verbatim from source.

3. **Guardrails:** Preserved verbatim, with one additional "prompt-injection / untrusted content" line added where the source mentioned untrusted documents.

### Sub-agent-exclusive skills

Per design decision, fund-operations + compliance skills are added to `SUBAGENT_EXCLUSIVE_SKILLS` so Stella does not invoke them directly — the user is steered to delegate to the specialist agent instead:

```typescript
// New in v5
'gl-recon', 'break-trace', 'accrual-schedule', 'roll-forward', 'nav-tieout',
'kyc-doc-parse', 'kyc-rules',
```

IB and research skills (pitch-deck, lbo-model, pptx-author, xlsx-author, etc.) remain accessible to Stella for ad-hoc use.

## Files changed

**Created (27):**
- `resources/examples/agents/{pitch-agent,meeting-prep-agent,valuation-reviewer,gl-reconciler,month-end-closer,statement-auditor,kyc-screener}/AGENT.md`
- `skills/{accrual-schedule,break-trace,client-report,client-review,deck-refresh,gl-recon,ib-check-deck,ic-memo,investment-proposal,kyc-doc-parse,kyc-rules,lbo-model,nav-tieout,pitch-deck,portfolio-monitoring,pptx-author,returns-analysis,roll-forward,variance-commentary,xlsx-author}/` (entire folders copied from `vertical-plugins/`)

**Modified (3):**
- `src/shared/constants/builtinAgents.ts` — extend `INVESTMENT_STUDIO_BUILTIN_AGENTS` + `SUBAGENT_EXCLUSIVE_SKILLS`
- `src/shared/constants/builtinSkills.ts` — extend `INVESTMENT_STUDIO_SKILL_NAMES`, add `BUILTIN_SKILL_CHANGELOG[5]`, bump `BUILTIN_DEFAULTS_VERSION` to 5
- `resources/examples/profiles/profile.json` — `builtinDefaultsVersion: 5`

## Migration behaviour

- **New users:** receive all 11 agents (Kobi default + 10 FSI agents) and all v1–v5 skills automatically via the seeders on first launch.
- **Existing users on v2–v4:** the changelog walker adds v5 skills incrementally; existing agents (without these skills) get them appended; `SUBAGENT_EXCLUSIVE_SKILLS` are installed at profile level but excluded from Stella's `skills[]`.
- **Existing users with custom skill removals:** preserved — only delta skills are added per version, never overriding user removals from prior versions.

## Verification

- `npm run typecheck` — passes (no type errors in modified files).
- All 7 AGENT.md files parse cleanly via the seeder (verified by `SubAgentFileManager.parseAgentMarkdown`).
- All 20 new skill folders contain valid `SKILL.md` with frontmatter (`name`, `description`).

## Out of scope

- **UI grouping by role family** (投行 / 研究 / 基金运营 / 合规) — deferred per user direction "先不做分组".
- **Sub-agent system prompt / template updates** — none needed; existing profile template inherits new agents automatically through the seeder.
- **Brand-specific tool restrictions** — current `builtin_tools` lists match the spirit of the FSI source (`Read/Grep/Glob` for ops agents → read/write/search; `mcp__*` for research agents → web + research-mcp). No new MCP servers required.
