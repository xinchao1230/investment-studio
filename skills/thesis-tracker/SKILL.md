---
name: thesis-tracker
description: "Maintain and update investment theses for portfolio positions. Triggers on: update thesis, thesis check, is my thesis intact, review positions, 论点追踪, 投资逻辑检验, 持仓复盘"
version: 1.0.0
license: MIT
---

# Thesis Tracker

## Input
- stock_code: Stock code (e.g. 600036 or AAPL)
- action: create | update | review

## Workflow

### Step 0: Check Cache (MANDATORY)
Before any `*_collect` call, follow `skills/_cache-policy.md`:
- Read `{target_dir}/data-cache/tushare/{endpoint}.meta.json` for relevant endpoints. Within TTL → reuse the CSV.
- On cache miss, call the collect tool and write `meta.json`.
- Force refresh when the user says "最新数据 / 刷新 / 重新拉取".

### Step 1: Define or Load Thesis

If creating a new thesis:
- **Company**: Name and ticker
- **Position**: Long or Short
- **Thesis statement**: 1-2 sentence core thesis (e.g., "Long 600036 — retail AUM growth + fee income expansion as wealth management mix shifts")
- **Key pillars**: 3-5 supporting arguments
- **Key risks**: 3-5 risks that would invalidate the thesis
- **Catalysts**: Upcoming events (earnings, policy changes, product launches)
- **Target price / valuation**: What's it worth if the thesis plays out
- **Stop-loss trigger**: What would make you exit

If updating an existing thesis, load from `{target_dir}/thesis/thesis.md` and ask for the new data point.

### Step 2: Update Log

For each new data point or development:

| Date | Data Point | Pillar Affected | Impact | Action | Conviction |
|------|-----------|----------------|--------|--------|------------|
| | | | Strengthen/Weaken/Neutral | Hold/Add/Trim/Exit | High/Med/Low |

### Step 3: Thesis Scorecard

Maintain a running scorecard:

| Pillar | Original Expectation | Current Status | Trend |
|--------|---------------------|----------------|-------|
| Revenue growth >20% | On track | Q3 was 22% | Stable |
| Margin expansion | Behind | Margins flat YoY | Concerning |
| Policy tailwind | Pending | New regulation announced | Watch |

### Step 4: Catalyst Calendar

Track upcoming catalysts for this position:

| Date | Event | Expected Impact | Notes |
|------|-------|-----------------|-------|
| | | | |

### Step 5: Output

Save thesis to `{target_dir}/thesis/thesis.md` with:
- Thesis statement and pillars
- Current scorecard
- Update log (append-only)
- Catalyst calendar
- Current conviction level

## Storage

- Thesis file: `{target_dir}/thesis/thesis.md`
- One thesis per research target (aligned with portfolio structure)
- Update log is append-only — never delete history

## Important Notes

- A thesis should be falsifiable — if nothing could disprove it, it's not a thesis
- Track disconfirming evidence as rigorously as confirming evidence
- Review theses at least quarterly, even when nothing dramatic has happened
- For A-share: pay attention to policy/regulatory shifts as thesis risks (industry policy, capital market reform, window guidance)
- If the user manages multiple positions, offer to do a full portfolio thesis review
