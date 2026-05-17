# Skill-Layer Data Cache for Tushare/yfinance

**Date:** 2026-05-17
**Status:** Approved, ready for implementation (no push until user verifies)
**Scope:** All investment-studio skills that call `tushare_collect` / `yfinance_collect` / `peer_collect` / `capital_flow`

## Problem

`research-mcp` has **zero cache** today —
[resources/mcp/research/src/research_mcp/tools/data_collect.py](../../resources/mcp/research/src/research_mcp/tools/data_collect.py)
calls the Tushare / yfinance API on every invocation. Concretely:

- A single target running `key-drivers` → `earnings-review` → `marginal-tracking`
  → `stock-analyze` will refetch the same `income.csv` four times.
- Tushare Pro pricing is **points + per-minute rate limit** (not per-call).
  The fast skills can hammer the same endpoint within seconds and burn the
  per-minute quota, then everything else queues.
- Most financial endpoints (income / balance / cashflow / peer comparison /
  shareholder) only update once a quarter — refetching daily wastes both
  network and quota for no fidelity gain.

## Goals

1. Each Tushare/yfinance endpoint result is fetched at most once per target
   within its freshness TTL.
2. Quality first: short TTLs and explicit force-refresh keyword so the LLM
   never silently uses stale data for a fast-moving signal.
3. Zero Python changes — implement purely at the skill (markdown) layer.
4. Cache lives under each target so it travels with the target on delete /
   move and is easy to inspect from the file tree.

## Non-Goals

- No SQLite, no LRU eviction, no cache-hit metrics (YAGNI for per-target
  CSV files under a megabyte).
- No cross-target dedup — the same stock under two different research
  targets each keeps its own cache copy. Cheap and predictable.
- No format conversion — cache is literally the CSV the `*_collect` tool
  wrote.

## Design

### Directory layout

```
{target_dir}/
├── profile.yaml
├── key-drivers.md
├── notes.md
├── tracking.md
├── inputs/
├── earnings/
├── research/
├── models/
└── data-cache/                              ← new
    ├── tushare/
    │   ├── income.csv
    │   ├── income.meta.json
    │   ├── balancesheet.csv
    │   ├── balancesheet.meta.json
    │   ├── cashflow.csv
    │   ├── cashflow.meta.json
    │   ├── peer_comparison.csv
    │   ├── peer_comparison.meta.json
    │   ├── daily.csv
    │   ├── daily.meta.json
    │   ├── capital_flow.csv
    │   └── capital_flow.meta.json
    └── yfinance/
        ├── income_annual.csv
        ├── income_annual.meta.json
        └── ... (balance_annual / cashflow_annual / history)
```

For workspace-scoped skills that aren't bound to a single target
(`industry-comparison`, `stock-screening`), the cache lives under
`{workspace_dir}/_data-cache/tushare/...` with the same file layout.

### Meta file shape

```json
{
  "source": "tushare",
  "endpoint": "income",
  "symbol": "600036.SH",
  "fetched_at": "2026-05-17T12:34:56Z",
  "ttl_days": 7,
  "params": { "start_date": "20200101" }
}
```

### TTL policy (single source of truth — `skills/_cache-policy.md`)

| Endpoint | Source | TTL |
|---|---|---|
| `income` / `balancesheet` / `cashflow` | tushare | 7 days |
| `peer_comparison` | tushare | 7 days |
| `shareholder` | tushare | 30 days |
| `daily` | tushare | 12 hours |
| `capital_flow` | tushare | 6 hours |
| `income_annual` / `balance_annual` / `cashflow_annual` | yfinance | 7 days |
| `history` | yfinance | 12 hours |

Choices reflect actual update cadence: financial statements move
quarterly, price moves daily, capital flow updates intraday.

### Phase 0 contract (uniform across skills)

Every skill that calls a `*_collect` tool starts with:

```markdown
### Phase 0 — Check Cache (MANDATORY)

For each endpoint this skill needs, follow `skills/_cache-policy.md`:

1. Read `{cache_root}/{source}/{endpoint}.meta.json`. Absent → cache miss.
2. If present, compare `fetched_at + ttl_days` against the result of
   `get_current_datetime`. Fresh → reuse the existing CSV directly. Skip
   the corresponding `*_collect` call.
3. For cache misses, call the `*_collect` tool with
   `out_dir = {cache_root}/{source}/`, then write `{endpoint}.meta.json`
   alongside the CSV.

Force refresh: if the user explicitly says "最新数据" / "刷新" /
"重新拉取" / "force refresh", bypass the cache and overwrite.

`{cache_root}` = `{target_dir}/data-cache` for target-scoped skills,
`{workspace_dir}/_data-cache` for workspace-scoped skills
(industry-comparison, stock-screening).
```

### Files to edit

| File | Change |
|---|---|
| `skills/_cache-policy.md` | **New** — single document of cache rules + TTL table referenced by every skill. |
| `skills/key-drivers/SKILL.md` | Insert Phase 0 before Phase 2 (Collect). |
| `skills/stock-analyze/SKILL.md` | Insert Phase 0 before Phase 1 (Collect). |
| `skills/deep-report/SKILL.md` | Insert Step 0 before Step 1 (Overview). |
| `skills/earnings-review/SKILL.md` | Insert Step 0 before Step 1 (Fetch). |
| `skills/earnings-forecast/SKILL.md` | Insert Step 0 before Step 1 (Fetch). |
| `skills/industry-comparison/SKILL.md` | Insert Step 0 before Step 2 (Fetch). Use workspace-scoped cache. |
| `skills/stock-screening/SKILL.md` | Insert Step 0 before Step 2 (Fetch). Use workspace-scoped cache. |
| `skills/marginal-tracking/SKILL.md` | Insert Step 0 before Step 2 (Fetch). |

## Compatibility

- Pure additive — existing targets without a `data-cache/` directory just
  pay the cost of the first fetch.
- `tushare_collect` etc. already call `os.makedirs(out_dir, exist_ok=True)`,
  so pointing `out_dir` at the cache directory works without changes.
- No effect on file watchers / IPC — `data-cache/` shows up in the file
  tree but it's read-only from the user's perspective.

## Validation

Manual checks the user will run:

1. New target → run `/key-drivers` → confirm `data-cache/tushare/*.csv +
   *.meta.json` appear.
2. Re-run `/key-drivers` immediately → confirm tool-call view shows
   **no** new `tushare_collect` invocations (skill reuses cache).
3. Run `earnings-review` on same target → confirm it also reuses the
   cached `income.csv` without refetching.
4. Hand-edit a meta file's `fetched_at` to 8 days ago → re-run any skill
   → confirm a fresh fetch happens.
5. Say "请用最新数据重新拉取 06862" → confirm force refresh works.

## Risks

- **LLM skips Phase 0** → mitigated by (a) marking it `MANDATORY` in bold,
  (b) keeping the section first, (c) the brand prompt also reminds of
  cache discipline. Not bulletproof.
- **Stale-data masquerades as fresh** when an endpoint silently changes
  mid-week → TTLs are short for fast-moving signals; force-refresh
  keyword is documented in user-facing copy.
- **Workspace-scoped cache** has no per-symbol scoping — different stocks
  share filenames. **Resolution**: filenames carry symbol prefix:
  `_data-cache/tushare/{symbol}/{endpoint}.csv`.
