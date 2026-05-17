---
name: earnings-review
description: "Earnings review - analyze quarterly financial report for a research target"
version: 1.0.0
license: MIT
---

# Earnings Review (财报点评)

## Input
- stock_code: Stock code (e.g. 603993)
- period: Reporting period (e.g. 2026Q1)

## Workflow

### Step 0: Check Cache (MANDATORY)
Before any `*_collect` call, follow `skills/_cache-policy.md`:
- Read `{target_dir}/data-cache/tushare/{endpoint}.meta.json` for each endpoint (income / balancesheet / cashflow). Within TTL (income/balancesheet/cashflow = 7d) → reuse the CSV, skip Step 1's `*_collect` for that endpoint.
- On cache miss, call the collect tool with `out_dir = {target_dir}/data-cache/tushare/` and write the sibling `meta.json` after success.
- Force refresh when the user says "最新数据 / 刷新 / 重新拉取".

### Step 1: Fetch Financial Data
Use Tushare to fetch the following for the given stock_code and period:
- Income statement (营收, 净利润, 毛利率, 净利率)
- Balance sheet (总资产, 净资产, 资产负债率)
- Cash flow statement (经营现金流, 自由现金流)
- Same period last year for YoY comparison
- Previous quarter for QoQ comparison

Python example:
```python
import tushare as ts
pro = ts.pro_api()
# Income statement
df = pro.income(ts_code='603993.SH', period='20260331')
# Balance sheet
df_bs = pro.balancesheet(ts_code='603993.SH', period='20260331')
# Cash flow
df_cf = pro.cashflow(ts_code='603993.SH', period='20260331')
```

### Step 2: Read Target Context
Use `portfolio_get_target_files` to check if the target exists.
If exists, read `key-drivers.md` to understand what metrics matter for this company.
If not exists, call `portfolio_init_target` first.

### Step 3: Analyze
- Calculate YoY and QoQ changes for revenue, net profit, gross margin, net margin
- Compare against key drivers (if available)
- Highlight significant changes (>10% deviation from trend)
- Note any one-time items or accounting changes

### Step 4: Generate Report
Write a structured markdown report with these sections:
1. **Summary** - 2-3 sentence overview (beat/miss/inline, key highlights)
2. **Revenue Analysis** - Revenue breakdown, growth drivers
3. **Profitability** - Margins, cost structure changes
4. **Balance Sheet** - Asset quality, leverage changes
5. **Cash Flow** - Operating CF quality, capex trends
6. **Key Drivers Update** - How key drivers changed this quarter
7. **Outlook** - Forward-looking signals from this report

### Step 5: Save
Save the report to the target folder using file system:
- Path: `{target_dir}/earnings/{period}-review.md`
- Also use `portfolio_append_note` to log: "Earnings review completed for {period}"

## Output Format
Markdown file saved to target's earnings/ directory.
