# Data Cache Policy

**Audience:** All investment-studio skills calling `tushare_collect`, `yfinance_collect`, `peer_collect`, or `capital_flow`.

**Goal:** Avoid refetching the same financial data within its freshness window. Tushare Pro rate-limits per minute and most financial endpoints update only once per quarter.

---

## Cache root

- **Target-scoped skills** (anything that operates on a single research target — key-drivers, earnings-review, earnings-forecast, marginal-tracking, stock-analyze):
  - `cache_root = {target_dir}/data-cache`
- **Workspace-scoped skills** (industry-comparison, stock-screening — operate on multiple stocks at once):
  - `cache_root = {workspace_dir}/_data-cache`
  - Filenames carry a symbol prefix: `{cache_root}/{source}/{symbol}/{endpoint}.csv`.

---

## File layout (per endpoint)

For every endpoint fetched, write **two** files in `{cache_root}/{source}/`:

1. The raw CSV — exactly what `tushare_collect` / `yfinance_collect` / `peer_collect` produced.
2. A sibling `{endpoint}.meta.json` describing when and how it was fetched:

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

---

## TTL table

| Source | Endpoint(s) | TTL |
|---|---|---|
| tushare | `income`, `balancesheet`, `cashflow`, `peer_comparison` | **7 days** |
| tushare | `shareholder` | **30 days** |
| tushare | `daily` | **0.5 days** (12 hours) |
| tushare | `capital_flow` | **0.25 days** (6 hours) |
| yfinance | `income_annual`, `balance_annual`, `cashflow_annual` | **7 days** |
| yfinance | `history` | **0.5 days** (12 hours) |

Rationale: financial statements move quarterly; price moves daily; capital flow updates intraday.

---

## Phase 0 procedure (paste-friendly)

Every data-fetching skill **must** run this before any `*_collect` call:

```
For each endpoint this skill needs:
  1. Read {cache_root}/{source}/{endpoint}.meta.json via read_file.
     - Absent or unparseable → CACHE MISS.
  2. Get current time via get_current_datetime.
     Compute expiry = fetched_at + (ttl_days * 24h).
     - now < expiry → CACHE HIT. Reuse {cache_root}/{source}/{endpoint}.csv
       directly. Do NOT call the *_collect tool for this endpoint.
     - now >= expiry → CACHE MISS.

For each CACHE MISS:
  1. Call *_collect with out_dir = {cache_root}/{source}/.
     (For workspace-scoped skills, out_dir = {cache_root}/{source}/{symbol}/.)
  2. Immediately after success, write {endpoint}.meta.json containing
     source / endpoint / symbol / fetched_at (ISO-8601 UTC) / ttl_days /
     params via create_file.
```

---

## Force refresh

Bypass the cache (rewrite both CSV and meta) when the user explicitly says any of:

- "最新数据"
- "刷新"
- "重新拉取"
- "force refresh"
- "ignore cache"

When force-refreshing, also delete sibling endpoints' meta files only if the user asked to refresh **everything** for that target.

---

## Robustness rules

- If `meta.json` is missing but the CSV exists → treat as CACHE MISS and overwrite both.
- If the CSV is missing but the meta exists → treat as CACHE MISS, overwrite both.
- If the parsed `fetched_at` is in the future (clock skew) → treat as CACHE MISS.
- Never delete CSVs proactively. They are small and per-target; let `portfolio_delete_target` carry them to the recycle bin.

---

## Quick reference for skill authors

Include this block as your Phase 0 / Step 0:

```markdown
### Phase 0 — Check Cache (MANDATORY)

Follow `skills/_cache-policy.md`. For every endpoint this skill needs:

1. Read `{cache_root}/{source}/{endpoint}.meta.json`. Fresh (within TTL) →
   reuse the existing CSV, skip the corresponding `*_collect` call.
2. On cache miss, call `*_collect` with `out_dir = {cache_root}/{source}/`,
   then write the sibling `meta.json`.

`cache_root` = `{target_dir}/data-cache` (this skill) /
`{workspace_dir}/_data-cache` (workspace-scoped skills).

Force refresh when the user says "最新数据" / "刷新" / "重新拉取".
```
