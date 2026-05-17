---
name: deep-report
description: "Deep research report - comprehensive analysis of a company"
version: 1.0.0
license: MIT
---

# Deep Report (深度报告)

## Input
- stock_code: Stock code (e.g. 603993)

## Workflow

This is a multi-step deep analysis. Each section can be executed by a separate agent in parallel.

### Step 0: Check Cache (MANDATORY)
Before any Tushare call, follow `skills/_cache-policy.md`:
- For each endpoint (income / balancesheet / cashflow / peer_comparison / daily), read `{target_dir}/data-cache/tushare/{endpoint}.meta.json`. Within TTL (financials/peer = 7d; daily = 12h) → reuse the CSV.
- On cache miss, call the relevant collect tool with `out_dir = {target_dir}/data-cache/tushare/` and write the sibling `meta.json`.
- Force refresh when the user says "最新数据 / 刷新 / 重新拉取".

### Step 1: Company Overview
Fetch via Tushare:
- Company basic info: `pro.stock_basic(ts_code='...')`
- Industry classification
- Market cap, listing date

### Step 2: Industry Landscape
- Fetch industry peer list: `pro.stock_basic(industry='...')`
- Compare market caps, PE ratios, revenue scale among peers
- Identify market position and competitive dynamics

### Step 3: Financial Analysis (3-year trend)
Fetch 3 years of data:
- Revenue, net profit, gross/net margins
- ROE, ROA, ROIC
- Debt/equity ratio, current ratio
- Operating cash flow vs net profit ratio

Present as trend tables with YoY growth rates.

### Step 4: Valuation
- Current PE, PB, PS, EV/EBITDA
- Historical valuation range (3-year)
- Peer comparison valuation
- Simple DCF if data sufficient

### Step 5: Risk Assessment
- Financial risks (leverage, cash burn, receivables quality)
- Business risks (customer concentration, regulatory)
- Valuation risks (premium/discount to peers)

### Step 6: Compile Report
Combine all sections into a comprehensive report:
1. Investment Thesis (3 sentences)
2. Company Overview
3. Industry Landscape
4. Financial Deep Dive
5. Valuation Assessment
6. Risk Factors
7. Key Metrics Dashboard (summary table)

### Step 7: Save
- Save to `{target_dir}/deep-report-{YYYY-MM-DD}.md`
- Update `key-drivers.md` with identified key drivers
- Append note: "Deep report completed"

## Parallel Execution Hint
Steps 2, 3, 4 can run in parallel as they are independent data fetches. Step 5 depends on Step 3. Step 6 depends on all previous steps.
