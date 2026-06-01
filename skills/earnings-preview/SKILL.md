---
name: earnings-preview
description: "Pre-earnings analysis with scenario frameworks and key metrics. Triggers on: earnings preview, pre-earnings, earnings setup, preview Q[X], 业绩前瞻, 财报预览, 盈利预测"
version: 1.0.0
license: MIT
---

# Earnings Preview

## Input
- stock_code: Stock code (e.g. 600036 or AAPL)
- period: Reporting period (e.g. 2026Q1)

## Workflow

### Step 0: Check Cache (MANDATORY)
Before any `*_collect` call, follow `skills/_cache-policy.md`:
- Read `{target_dir}/data-cache/tushare/{endpoint}.meta.json` for each endpoint needed (income / balancesheet / cashflow / daily). Within TTL → reuse the CSV, skip the corresponding `*_collect` call.
- On cache miss, call the collect tool with `out_dir = {target_dir}/data-cache/tushare/` and write the sibling `meta.json` after success.
- Force refresh when the user says "最新数据 / 刷新 / 重新拉取".

### Step 1: Gather Context

- Identify the company and reporting quarter
- Pull consensus estimates (revenue, EPS / net profit, key segment metrics)
  - A-share: use tushare `forecast` endpoint or web search for analyst consensus (Wind/iFind)
  - US stock: web search for consensus estimates
- Find the earnings date
- Review the company's prior quarter earnings call / investor Q&A for guidance

### Step 2: Key Metrics Framework

Build a "what to watch" framework specific to the company:

**Financial Metrics:**
- Revenue vs. consensus (total and by segment)
- Net profit vs. consensus (A-share: focus on deducted non-recurring / 扣非净利润)
- Margins (gross, operating, net) — expanding or contracting?
- Free cash flow
- Forward guidance vs. consensus

**Operational Metrics** (sector-specific):
- Tech/SaaS: ARR, net retention, RPO, customer count
- Retail: Same-store sales, traffic, basket size
- Industrials: Backlog, book-to-bill, price vs. volume
- Financials: NIM, credit quality, loan growth, fee income (A-share banks: net interest income, provision coverage)
- Healthcare: Scripts, patient volumes, pipeline updates
- Consumer (A-share): channel inventory, dealer count, ASP trends
- Manufacturing (A-share): capacity utilization, order backlog, export ratio

### Step 3: Scenario Analysis

Build 3 scenarios with stock price implications:

| Scenario | Revenue | Net Profit / EPS | Key Driver | Stock Reaction |
|----------|---------|-----------------|------------|----------------|
| Bull | | | | |
| Base | | | | |
| Bear | | | | |

For each scenario:
- What would need to happen operationally
- What management commentary would signal this
- Historical context — how has the stock moved on similar prints?

### Step 4: Catalyst Checklist

Identify the 3-5 things that will determine the stock's reaction:

1. [Metric] vs. [consensus/whisper number] — why it matters
2. [Guidance item] — what the buy-side expects to hear
3. [Narrative shift] — any strategic changes, M&A, restructuring

### Step 5: Output

One-page earnings preview with:
- Company, quarter, earnings date
- Consensus estimates table
- Key metrics to watch (ranked by importance)
- Bull/base/bear scenario table
- Catalyst checklist
- Trading setup: recent stock performance, implied move (A-share: historical earnings-day volatility)

## Important Notes

- Consensus estimates change — always note the source and date of estimates
- For A-share: Wind/iFind consensus is more authoritative than web aggregators
- Historical earnings reactions help calibrate expectations
- A-share stocks don't have options-implied moves; use historical earnings-day price range instead
