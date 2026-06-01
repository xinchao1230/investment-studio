# FSI Plugin Integration Design

## Summary

Integrate skills and agent patterns from the open-source `financial-services` repository into Investment Studio. The FSI skills are loosely coupled to data sources (fallback chains, no hardcoded tool names), making direct import viable with minimal adaptation.

## Context

- **Investment Studio**: Electron desktop AI agent with MCP-based tool execution, skill system (SKILL.md format), and subagent support.
- **Financial Services (FSI)**: Claude Code plugin collection with 7 verticals, 10+ named agents, and 50+ skills covering equity research, financial analysis, IB, wealth management, PE, and operations.
- **Key finding**: FSI skills are environment-agnostic (80-90% analysis logic, 10-20% data sourcing with multi-level fallback). Studio skills are tightly coupled to `research-mcp` tools. This asymmetry means FSI skills import cleanly into Studio without modification.

## Design Decisions

### Approach: Direct Import (No Abstraction Layer)

FSI skills are imported as-is into Studio's `skills/` directory. No code changes to the skills themselves. A single system prompt addition guides the LLM to use Studio's `research-mcp` tools when premium MCPs are unavailable.

**Rationale**: FSI skills already define fallback chains (MCP -> web search -> user-provided data). The LLM naturally adapts to available tools. An abstraction layer would solve a problem that doesn't exist.

### Skill Selection Criteria

1. Fills a capability gap in Studio (no existing equivalent)
2. Low/zero MCP dependency (works without FactSet/Kensho)
3. Relevant to investment research workflow (not ops/admin)

## Skills to Import

### Batch 1: Valuation Modeling (Studio has zero coverage)

| Skill | Source Vertical | MCP Dependency |
|-------|----------------|----------------|
| `dcf-model` | financial-analysis | Low (prioritized, not required) |
| `comps-analysis` | financial-analysis | Medium (prefers FactSet/Kensho, falls back to web/user) |
| `3-statement-model` | financial-analysis | None (user-provided templates) |
| `competitive-analysis` | financial-analysis | None (uses web research) |

### Batch 2: Research Workflows

| Skill | Source Vertical | MCP Dependency |
|-------|----------------|----------------|
| `initiating-coverage` | equity-research | Low (SEC filings + web) |
| `idea-generation` | equity-research | None (pure framework) |
| `sector-overview` | equity-research | None (web research) |

### Batch 3: Output Tools (Optional)

| Skill | Source Vertical | MCP Dependency |
|-------|----------------|----------------|
| `xlsx-author` | financial-analysis | None |
| `pptx-author` | financial-analysis | None |

### Not Importing

- PE/IB-specific: `lbo-model`, `merger-model`, `pitch-deck`, `cim-builder`, `teaser`
- Operations: `fund-admin/*`, `operations/*`
- Wealth management: `portfolio-rebalance`, `tax-loss-harvesting` (different user persona)

## SubAgent Definitions

Two new subagents, registered via `SubAgentConfig` in the default agent profile:

### market-researcher

```json
{
  "name": "market-researcher",
  "description": "Produces sector or thematic market research: industry overview, competitive landscape, peer comps spread, and ideas shortlist. Use when the user asks for a sector primer, thematic research, or peer comparison.",
  "model": "inherit",
  "skills": ["sector-overview", "competitive-analysis", "comps-analysis", "idea-generation"]
}
```

### model-builder

```json
{
  "name": "model-builder",
  "description": "Builds financial models (DCF, 3-statement, comps) in Excel format. Use when the user requests valuation modeling, financial projections, or intrinsic value analysis.",
  "model": "inherit",
  "skills": ["dcf-model", "3-statement-model", "comps-analysis", "xlsx-author"]
}
```

Both inherit parent's MCP servers (including `research-mcp`).

## System Prompt Addition

Add to `globalSystemPrompt.ts` for the `investment-studio` brand, appended to the skills section:

```
When a skill requests financial data and no premium MCP server (FactSet, S&P Kensho, Daloopa, Morningstar) is connected, use the research-mcp tools available to this agent: tushare_collect for A-share data, yfinance_collect for US/HK stock data. These serve as the primary fallback data source.
```

## Directory Structure (Post-Integration)

```
skills/
  _cache-policy.md
  # Existing Studio skills
  stock-analyze/
  earnings-review/
  earnings-forecast/
  key-drivers/
  industry-comparison/
  stock-screening/
  marginal-tracking/
  xlsx/
  # Imported from FSI (batch 1)
  dcf-model/
  comps-analysis/
  3-statement-model/
  competitive-analysis/
  # Imported from FSI (batch 2)
  initiating-coverage/
  idea-generation/
  sector-overview/
```

## Registration

Add to `INVESTMENT_STUDIO_SKILL_NAMES` in `src/shared/constants/builtinSkills.ts`:

```typescript
const INVESTMENT_STUDIO_SKILL_NAMES: string[] = [
  // existing
  'stock-analyze',
  'key-drivers',
  'xlsx',
  'earnings-forecast',
  'earnings-review',
  'industry-comparison',
  'marginal-tracking',
  'stock-screening',
  // FSI imports
  'dcf-model',
  'comps-analysis',
  '3-statement-model',
  'competitive-analysis',
  'initiating-coverage',
  'idea-generation',
  'sector-overview',
];
```

Bump `BUILTIN_DEFAULTS_VERSION` and add changelog entry so existing profiles get the new skills on next launch.

## Risks & Mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| comps-analysis underperforms without FactSet | Medium | System prompt fallback to yfinance; user can add FactSet MCP if subscribed |
| Skill naming collision | Low | FSI uses different names from Studio's existing skills |
| Upstream FSI updates | Medium | Pin to a commit; periodic manual sync (no auto-update) |
| User confusion (EN skills in CN-focused app) | Low | Skills produce output in the language the user prompts in |

## Future Extensions

- Import `xlsx-author` / `pptx-author` when Studio's output formatting needs improve
- Offer optional MCP server registry UI so users can add FactSet/Morningstar with one click
- Consider importing `earnings-preview` / `catalyst-calendar` for pre-earnings workflow
