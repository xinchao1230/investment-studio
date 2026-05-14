---
name: marginal-tracking
description: "Track marginal changes in key metrics for a research target"
version: 1.0.0
license: MIT
---

# Marginal Change Tracking (边际变化追踪)

## Input
- stock_code: Stock code

## Workflow

### Step 1: Read Current State
Read the target's `tracking.md` to understand:
- What metrics are being tracked
- Last recorded values and dates
Read `key-drivers.md` to know which metrics matter.

### Step 2: Fetch Latest Data
Use Tushare to get latest available data:
- Latest daily quote (price, volume, turnover)
- Latest financial data (if new report published)
- Top 10 holders changes (quarterly)
- Any recent announcements

### Step 3: Compare
For each tracked metric:
- Current value vs last recorded value
- Calculate change (absolute and percentage)
- Flag significant changes (configurable threshold, default >5%)

### Step 4: Update tracking.md
Append new rows to the tracking table:

```
| 2026-05-14 | Revenue Q1 | 45.2B | 52.1B | +15.3% YoY, beat estimate |
| 2026-05-14 | Store count | 1,856 | 1,892 | +36 net new in Q1 |
```

### Step 5: Save
- Update `tracking.md` in place
- Append note if significant changes detected: "Marginal changes detected: {summary}"

## Automation Note
This skill is designed to be run on a schedule (e.g., daily at 19:00). The scheduler should call this skill with each tracked target's stock_code.
