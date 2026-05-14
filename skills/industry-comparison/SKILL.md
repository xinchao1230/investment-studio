---
name: industry-comparison
description: "Horizontal comparison of companies within an industry"
version: 1.0.0
license: MIT
---

# Industry Comparison (行业对比)

## Input
- Either: industry name (e.g. "餐饮") OR list of stock codes

## Workflow

### Step 1: Identify Peers
If industry name: use `pro.stock_basic(industry='...')` to get peer list.
If stock codes provided: use those directly.

### Step 2: Fetch Comparable Data
For each company, fetch:
- Market cap
- PE (TTM), PB, PS
- Revenue (LTM), net profit (LTM)
- Revenue growth YoY
- ROE, gross margin, net margin
- Debt/equity ratio

### Step 3: Build Comparison Table
Create a ranked table sorted by market cap:

| Company | Code | Mkt Cap | PE | PB | Rev Growth | ROE | Gross Margin |
|---------|------|---------|----|----|-----------|-----|-------------|
| ... | ... | ... | ... | ... | ... | ... | ... |

### Step 4: Analysis
- Identify outliers (cheap/expensive relative to peers)
- Note quality leaders (high ROE + high margins)
- Highlight growth leaders

### Step 5: Save
- Save to `_industry/{industry-name}-comparison-{YYYY-MM-DD}.md`
- Include both the table and analysis narrative
