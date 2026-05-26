---
name: earnings-forecast
description: "Earnings forecast - build revenue/profit prediction model"
version: 1.0.0
license: MIT
---

# Earnings Forecast (盈利预测/建模)

## Input
- stock_code: Stock code
- assumptions (optional): Key assumptions to override defaults

## Workflow

### Step 0: Check Cache (MANDATORY)
Before any `*_collect` call, follow `skills/_cache-policy.md`:
- Read `{target_dir}/data-cache/tushare/{endpoint}.meta.json` for each endpoint (income / balancesheet / cashflow). Within TTL (7d for financials) → reuse the CSV, skip Step 1's `*_collect` for that endpoint.
- On cache miss, call the collect tool with `out_dir = {target_dir}/data-cache/tushare/` and write the sibling `meta.json` after success.
- Force refresh when the user says "最新数据 / 刷新 / 重新拉取".

### Step 1: Fetch Historical Data
Use Tushare to get 3-5 years of quarterly financial data:
- Revenue breakdown (if available via segments)
- Cost structure
- Key operating metrics

### Step 2: Build Assumptions
Based on historical trends, propose default assumptions:
- Revenue growth rate (by segment if possible)
- Gross margin trajectory
- SG&A as % of revenue
- Capex as % of revenue
- Tax rate

If user provides custom assumptions, use those instead.

### Step 3: Generate Forecast Model
Create a CSV/XLSX with:
- Rows: Line items (revenue, COGS, gross profit, SG&A, EBIT, net income, EPS)
- Columns: Historical years + 2 forecast years
- Formulas documented in a separate assumptions.md

### Step 4: Sensitivity Analysis
Create a sensitivity table:
- Revenue growth +/- 5pp
- Gross margin +/- 2pp
- Show impact on net income and EPS

### Step 5: Save
- Model: `{target_dir}/models/forecast-{YYYY-MM-DD}.csv`
- Assumptions: `{target_dir}/models/forecast-{YYYY-MM-DD}-assumptions.md`
- Append note: "Forecast model created with assumptions: {summary}"

## Output
CSV model file + assumptions markdown, saved to target's models/ directory.
