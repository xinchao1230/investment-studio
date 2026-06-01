---
name: catalyst-calendar
description: "Build and maintain a calendar of upcoming catalysts across coverage universe. Triggers on: catalyst calendar, upcoming events, earnings calendar, event calendar, 催化剂日历, 事件日历, 近期催化"
version: 1.0.0
license: MIT
---

# Catalyst Calendar

## Input
- universe: List of stock codes or "current portfolio"
- horizon: Time horizon (default: next 4 weeks)

## Workflow

### Step 1: Define Coverage Universe

- List of companies to track (tickers or names)
- Sector / industry focus
- Include macro events? (central bank meetings, economic data, regulatory deadlines)
- Time horizon (next 2 weeks, month, quarter)

### Step 2: Gather Catalysts

For each company, identify upcoming events:

**Earnings & Financial Events**
- Quarterly earnings date (A-share: annual report Apr 30 deadline, Q1 Apr 30, H1 Aug 31, Q3 Oct 31)
- Annual shareholder meeting
- Investor day / analyst day
- Debt maturity / refinancing dates

**Corporate Events**
- Product launches or announcements
- Regulatory approvals / decisions
- Contract renewals or expirations
- M&A milestones (close dates, regulatory approvals)
- Management transitions
- Share lockup expirations (A-share: IPO lockup, private placement lockup)
- Share buyback/cancellation announcements

**Industry Events**
- Major conferences (dates, which companies presenting)
- Trade shows and expos
- Regulatory comment periods or rulings
- Industry data releases (monthly sales, PMI, etc.)

**Macro Events (China-specific)**
- PBOC MLF/LPR decisions
- State Council / Politburo meetings on economy
- NBS data releases (CPI, PPI, industrial profit, PMI)
- NDRC policy announcements
- CSRC regulatory changes (IPO pace, margin rules, short-selling rules)

**Macro Events (Global)**
- Fed meetings (FOMC dates)
- Jobs report, CPI, GDP releases
- Central bank decisions (ECB, BOJ, etc.)

### Step 3: Calendar View

| Date | Event | Company/Sector | Type | Impact (H/M/L) | Our Positioning | Notes |
|------|-------|---------------|------|-----------------|----------------|-------|
| | | | Earnings/Corp/Industry/Macro | | Long/Short/Neutral | |

### Step 4: Weekly Preview

Each week, generate a forward-looking summary:

**This Week's Key Events:**
1. [Day]: [Company] Q[X] earnings — consensus [X billion rev], our estimate [X], key focus: [metric]
2. [Day]: [Event] — why it matters for [stocks]
3. [Day]: [Macro release] — expectations and positioning

**Next Week Preview:**
- Early heads-up on important events coming

**Position Implications:**
- Events that could move specific positions
- Any pre-positioning recommended
- Risk management ahead of binary events

### Step 5: Output

- Markdown calendar saved to `{workspace_dir}/_shared/catalyst-calendar.md`
- Weekly preview note (markdown)
- Update the calendar incrementally (append new, mark past events as resolved)

## Important Notes

- A-share earnings dates: check cninfo.com.cn for official disclosure schedule
- Pre-announce risk (A-share: performance forecast / 业绩预告 is mandatory for certain conditions)
- Conference attendance: which companies are at sell-side conferences matters for sentiment
- Some catalysts are recurring (monthly PMI, quarterly earnings) — build a template
- Archive past catalysts with the actual outcome — builds pattern recognition over time
- Color-code by impact level: Red = high impact, Yellow = moderate, Green = routine
