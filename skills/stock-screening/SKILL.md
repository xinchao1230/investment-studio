---
name: stock-screening
description: "Quick screening of a stock pool based on fundamental criteria"
version: 1.0.0
license: MIT
---

# Stock Screening (个股初筛)

## Input
- stock_codes: List of stock codes to screen
- OR criteria: Screening criteria (e.g. "PE < 20, ROE > 15%, revenue growth > 10%")

## Workflow

### Step 1: Define Universe
If stock codes provided: use those.
If criteria provided: use Tushare to scan. Example:
```python
# Get all A-share stocks
df = pro.stock_basic(list_status='L')
# Then filter by financial metrics
```

### Step 2: Fetch Key Metrics
**Cache first.** Workspace-scoped: cache root is `{workspace_dir}/_data-cache/tushare/{symbol}/`. Follow `skills/_cache-policy.md`:
- For each stock + each endpoint, read `{workspace_dir}/_data-cache/tushare/{symbol}/{endpoint}.meta.json`. Within TTL (financials = 7d; daily = 12h) → reuse the CSV, skip the `*_collect` call.
- On cache miss, call `tushare_collect` with `out_dir = {workspace_dir}/_data-cache/tushare/{symbol}/` and write the sibling `meta.json`.
- Force refresh when the user says "最新数据 / 刷新 / 重新拉取".
- **Universe scan**: when filtering the full A-share list by criteria, batch-fetch and cache each stock once — subsequent screening passes reuse the cache freely.

For each stock:
- Price, market cap
- PE, PB, PS (TTM)
- Revenue growth, net profit growth
- ROE, gross margin
- Dividend yield

### Step 3: Score and Rank
Simple scoring system:
- Valuation score (PE/PB percentile within group)
- Growth score (revenue + profit growth)
- Quality score (ROE + margin stability)
- Total = weighted average

### Step 4: Generate Results
Output a ranked table with scores and brief comment per stock.
Flag top picks and red flags.

### Step 5: Save
- Save to workspace root: `screening-{YYYY-MM-DD}.md`
- For stocks that pass screening, suggest `portfolio_init_target` to start tracking
