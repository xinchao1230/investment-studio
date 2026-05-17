---
name: key-drivers
description: "Build a full investment thesis (短期/长期逻辑 + 3-5 leading tracking variables + 估值参考 + 风险) for a research target and write it to key-drivers.md. Use when the user wants to: (1) build / fill in / 梳理 an investment thesis for a stock or company, (2) populate or refresh a target's key-drivers.md, (3) define what metrics to track for a research target, or (4) run the /key-drivers slash command."
---

# Key Drivers (投资逻辑构建)

## Input
- stock_code: Stock code (e.g. 600519, 09961.HK). For unlisted/private companies, pass the company name as a synthetic placeholder.
- company_name: Company name in Chinese (e.g. 携程集团). Optional but strongly recommended — used in headers and validation.

## Principle
**No fabrication, no platitudes.** Every claim must trace to a concrete data point (Tushare/yfinance metric, public announcement, regulatory filing, or sell-side title) collected in Phase 2. The Phase 6 reviewer is the sole quality gate — do not write to disk until every check passes.

## Workflow

### Phase 1 — Parse + Locate
1. Resolve `stock_code` → market (A 股 / 港股 / 美股 / unlisted) by suffix or numeric prefix.
2. Call `portfolio_list_targets` to find the matching target folder.
   - If missing: call `portfolio_init_target` with `{ stock_code, name }` first, then proceed.
3. Read existing `key-drivers.md` (if non-empty) via `read_file`. If it already contains substantive thesis (not just the empty skeleton), **stop and ask the user** whether to overwrite.

### Phase 2 — Collect (parallel)
Run these in parallel. Skip any that error out, but record the gap.

**Cache first.** Before any `*_collect` call, follow `skills/_cache-policy.md`:
for each endpoint, read `{target_dir}/data-cache/{source}/{endpoint}.meta.json`
and reuse the existing CSV when fresh (within TTL). On cache miss, call the
collect tool with `out_dir = {target_dir}/data-cache/{source}/` and immediately
write the sibling `meta.json`. Force refresh on "最新数据 / 刷新 / 重新拉取".

TTL: income/balancesheet/cashflow/peer_comparison = 7d, daily = 12h, capital_flow = 6h, shareholder = 30d.

**Financial baseline:**
- `tushare_collect` for A 股 / 港股 — last 3 fiscal years + latest quarter:
  - income statement (营收 / 毛利率 / 净利润 / 经营现金流)
  - balance sheet headline (总资产 / 资产负债率)
  - shareholder structure (前 10 大股东最新一期)
- `yfinance_collect` for 美股 equivalents.

**Public information layer:**
- `bing_web_search` (or `google_web_search`) with at least 3 queries:
  - `{company_name} 公告 OR 业绩 OR 战略 (recent 12 months)`
  - `{company_name} 行业 趋势 OR 政策 OR 监管`
  - `{company_name} 卖方 研报 OR 深度`
- Pull top 5-10 hits per query, prefer official IR pages and major news outlets.
- `fetch_web_content` on the 2-3 most authoritative pages for full text.

### Phase 3 — Distill thesis
Write two paragraphs, **each ≤ 120 words**:

- **短期逻辑** (1-3 month catalysts): events / data prints / regulatory decisions / earnings that should move the stock within a quarter. Cite at least **2 concrete catalysts** from Phase 2 (e.g. "Q3 出境游 GMV 增速即将公布", "反垄断调查整改方案预计 12 月落地").
- **长期逻辑** (3-5 year structural): unit economics, moat, market structure, optionality. Cite at least **2 structural drivers** with supporting metrics (e.g. "高星酒店直连库存覆盖率从 35% → 58%", "海外业务 GMV 占比从 12% → 24%").

### Phase 4 — Tracking variables
Produce **3-5** variables that are:

- **Leading** — not lagging (e.g. ✅ "出境游订单 GMV 增速" / ❌ "全年净利润")
- **Measurable** — quantitative with a clear data source (`tushare_collect`, IR releases, third-party trackers)
- **Disaggregated** — sub-segment KPIs preferred over aggregates (e.g. ✅ "酒店业务 take rate" / ❌ "公司总收入")
- **Company-specific** — not generic ("营收增速" is too generic; what drives that revenue is the variable)

For each variable, record:
1. Name
2. Why it matters (one line)
3. Data source / how to fetch
4. Current reading (number from Phase 2, or "待补" if not yet collected)
5. Threshold that would change the thesis (one line)

### Phase 5 — Reviewer self-check (single pass)
Validate the draft against this checklist. **Any ✗ → revise, do NOT write to disk:**

| # | Check | Pass criterion |
|---|---|---|
| 1 | 短期 ≠ 长期 | The two paragraphs cite different evidence and different timeframes |
| 2 | All numbers cited | Every quantitative claim has a Phase 2 source (Tushare / 公告 / news URL) |
| 3 | No marketing copy | No "看好" / "前景广阔" / "龙头地位稳固" without backing numbers |
| 4 | Variables are leading | Each tracking variable can in principle change *before* revenue/profit changes |
| 5 | Variables are disaggregated | At least 3 of 5 are sub-segment / KPI level, not total-company aggregates |

### Phase 6 — Write
Compose the final markdown body matching the existing skeleton structure:

```markdown
# {company_name} ({stock_code}) - Key Drivers

## 投资逻辑

**短期逻辑**：…（≤120 词，引用 ≥2 个具体催化）

**长期逻辑**：…（≤120 词，引用 ≥2 个结构性驱动）

## 核心跟踪变量

1. **{variable_name}**
   - 意义：…
   - 数据源：…
   - 当前读数：…
   - 阈值：…

2. …
```

Then persist:
1. Call `portfolio_update_key_drivers` with `{ stock_code, content }` — this **overwrites** the file atomically.
2. Call `portfolio_append_note` with `{ stock_code, content: "Built investment thesis (key-drivers.md) — short/long logic, {n} tracking variables." }`.

## Output

Markdown written to `{target_dir}/key-drivers.md`. A timestamped note appended to `{target_dir}/notes.md`.

## Notes

- Valuation comparables and risk analysis are intentionally **out of scope** for `key-drivers.md` — those live in `research/` reports produced by `stock-analyze` or ad-hoc analysis. Keep this file focused on thesis + tracking signals.
- For **unlisted/private targets**, skip Tushare/yfinance/peer_collect; substitute with `bing_web_search` for funding rounds, customer testimonials, founder background, and any leaked unit-economics.
- This skill complements `stock-analyze` (full 6-phase deep research report) — `key-drivers` is the lighter "thesis only" pipeline that runs in seconds to a minute, suitable as the first action after `portfolio_init_target`.
