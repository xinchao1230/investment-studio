---
name: model-update
description: "Update financial models with new earnings, guidance, or revised assumptions. Triggers on: update model, plug earnings, refresh estimates, new guidance, revise estimates, 更新模型, 刷新预测, 调整盈利预测"
version: 1.0.0
license: MIT
---

# Model Update

## Input
- stock_code: Stock code (e.g. 600036 or AAPL)
- trigger: earnings | guidance | macro | event

## Workflow

### Step 0: Check Cache (MANDATORY)
Before any `*_collect` call, follow `skills/_cache-policy.md`:
- Read `{target_dir}/data-cache/tushare/{endpoint}.meta.json` for each endpoint (income / balancesheet / cashflow). Within TTL → reuse the CSV.
- On cache miss, call the collect tool with `out_dir = {target_dir}/data-cache/tushare/` and write the sibling `meta.json`.
- Force refresh when the user says "最新数据 / 刷新 / 重新拉取".

### Step 1: Identify What Changed

Determine the update trigger:
- **Earnings release**: New quarterly actuals to plug in
- **Guidance change**: Company updated forward outlook (A-share: performance forecast / 业绩预告)
- **Estimate revision**: Analyst changing assumptions based on new data
- **Macro update**: Interest rates, FX, commodity prices changed
- **Event-driven**: M&A, restructuring, new product, management change

### Step 2: Plug New Data

#### After Earnings
Update the model with reported actuals:

| Line Item | Prior Estimate | Actual | Delta | Notes |
|-----------|---------------|--------|-------|-------|
| Revenue | | | | |
| Gross Margin | | | | |
| Operating Expenses | | | | |
| Net Profit (deducted non-recurring) | | | | |
| EPS | | | | |
| [Key metric 1] | | | | |
| [Key metric 2] | | | | |

**Segment Detail** (if applicable):
- Update each segment's revenue and margin
- Note any segment mix shifts

**Balance Sheet / Cash Flow Updates**:
- Cash and debt balances (A-share: note restricted cash separately)
- Share count (buybacks, dilution, private placements)
- Capex actual vs. estimate
- Working capital changes

### Step 3: Revise Forward Estimates

Based on the new data, adjust forward estimates:

| | Old FY Est | New FY Est | Change | Old Next FY | New Next FY | Change |
|---|-----------|-----------|--------|------------|------------|--------|
| Revenue | | | | | | |
| Net Profit | | | | | | |
| EPS | | | | | | |

**Key Assumption Changes:**
- What assumptions are you changing and why?
- Revenue growth rate: old -> new (reason)
- Margin assumption: old -> new (reason)
- Any new items (restructuring charges, one-time gains, asset impairments, etc.)

### Step 4: Valuation Impact

Recalculate valuation with updated estimates:

| Valuation Method | Prior | Updated | Change |
|-----------------|-------|---------|--------|
| DCF fair value | | | |
| P/E (NTM EPS x target multiple) | | | |
| EV/EBITDA (NTM EBITDA x target multiple) | | | |
| PB-ROE (if applicable) | | | |
| **Price Target** | | | |

### Step 5: Summary & Action

**Estimate Change Summary:**
- One paragraph: what changed, why, and what it means for the stock
- Is this a thesis-changing event or noise?

**Rating / Price Target:**
- Maintain or change rating?
- New price target (if changed) with methodology
- Upside/downside to current price

### Step 6: Output

- Updated model saved to `{target_dir}/model/` directory
- Estimate change summary appended to `{target_dir}/notes/`
- Updated price target derivation

## Important Notes

- Always reconcile your estimates to the company's reported figures before projecting forward
- A-share: note whether figures are GAAP (CAS) or adjusted (deducted non-recurring / 扣非)
- Track your estimate revision history — it shows your analytical progression
- If the quarter was noisy, separate signal from noise in your estimate changes
- Check consensus after updating — how do your revised estimates compare to Wind/iFind consensus?
- Share count matters — dilution from private placements (定增), converts, or buybacks can materially affect EPS
