---
name: stock-analyze
description: 个股深度研报 (research-mcp 驱动，6 phase pipeline + 3-reviewer 自审 loop，最多 3 轮)
trigger: /stock-analyze
version: 1.0.0
---

# 个股深度研报 — 6 Phase Pipeline

## 1. 触发与参数解析

用户输入 `/stock-analyze <公司名|股票代码>`，例如：

- `/stock-analyze 招商银行`
- `/stock-analyze 600036`
- `/stock-analyze 09988.HK`
- `/stock-analyze AAPL`

**解析规则（先按代码格式路由，再调工具，禁止用 `tushare_collect` 试探港股/美股）：**

1. 提取第一个非空 token 作为 `company`
2. 按代码格式判断 `market` + 选择采集工具：
   - 结尾是 `.HK`（如 `09988.HK`、`00700.HK`） → `market = 港股`，使用 `yfinance_collect`
   - 结尾是 `.SH` / `.SZ` / `.BJ`，或纯 6 位数字（如 `600036`） → `market = A股`，使用 `tushare_collect`（数字代码先补全后缀：`6xxxxx` → `.SH`，`0xxxxx`/`3xxxxx` → `.SZ`，`4xxxxx`/`8xxxxx` → `.BJ`）
   - 纯字母代码（如 `AAPL`、`MSFT`、`NVDA`） → `market = 美股`，使用 `yfinance_collect`
   - 用户输入是中文公司名 → 先用 `bing_web_search` / `google_web_search` 查官方代码与上市地，再回到上面三条路由
3. **不要**用 `tushare_collect` 验证港股/美股代码 —— 它会立刻 `ok:false` 返回 `Got '09988.HK'. For HK stocks use yfinance_collect...`，浪费一次调用

**输出变量：** `{company}`, `{ts_code}`, `{market}`, `{ticker}`, `{targetDir}`

---

## 2. Phase 0 — 环境检查

**工具：** `check_env`

**输入：** 无参数

**行为：**
- 返回 `tushare: true/false`、`python: true/false`
- 若 `tushare: false` 且 `market ∈ {A股, 港股}`：**终止流程**，提示用户配置 Tushare Token
- 若 `python: false`：**终止流程**，提示安装依赖

**错误处理：** 工具调用失败 → 重试 1 次；仍失败 → 终止并报告 MCP 连接异常

---

## 3. Phase 1 — 数据采集

**Cache 优先：** 在调用任何 `*_collect` 工具之前，先按 `skills/_cache-policy.md` 检查 `{targetDir}/data-cache/` 是否已有新鲜数据：

1. 对每个 endpoint 读 `{targetDir}/data-cache/{source}/{endpoint}.meta.json`，命中（`fetched_at + ttl_days > now`）→ 直接复用现有 CSV，**跳过**该 endpoint 的 `*_collect` 调用。
2. Cache miss 时，将下述工具的 `out_dir` 设为 `{targetDir}/data-cache/{source}/`（如 `tushare/`、`yfinance/`），写完 CSV 后立即 `create_file` 写同名 `{endpoint}.meta.json`。
3. **Force refresh：** 用户说"最新数据 / 刷新 / 重新拉取 / force refresh" → 跳过缓存判定，重新拉取并覆盖。

成功后，把 cache 路径**符号链接 / 复制**到 `{targetDir}/research/stock-analyze/{date}/raw_data/`（保留以往报告与 raw 数据强绑定的目录约定）。

TTL 速查：income / balancesheet / cashflow / peer_comparison = 7d；daily = 12h；capital_flow = 6h；shareholder = 30d。

### 3.1 `tushare_collect`（A股必选）

- **输入：** `ts_code`（如 `600036.SH`），`out_dir`（`{targetDir}/data-cache/tushare/`）
- **产出：** `income.csv`, `balancesheet.csv`, `cashflow.csv`, `daily.csv`, `basic_info.json`
- **错误处理：** `retryable: true` → 重试 1 次；不可重试 → 记录缺失，Phase 2 降级运行

### 3.2 `yfinance_collect`（仅港股/美股）

- **输入：** `symbol`（如 `AAPL`），`out_dir`（`{targetDir}/data-cache/yfinance/`），`period`（默认 `5y`）
- **产出：** `income_annual.csv`, `balance_annual.csv`, `cashflow_annual.csv`, `history.csv`
- **错误处理：** `retryable: true` → 重试 1 次；失败 → 跳过，标注 `[DATA_GAP: yfinance unavailable]`

### 3.3 `peer_collect`

- **输入：** `ts_code`，`peer_codes`（同行业 3-5 家），`out_dir`（`{targetDir}/data-cache/tushare/`）
- **产出：** `peer_comparison.csv`
- **错误处理：** `retryable: true` → 重试 1 次；失败 → 跳过 peer 对比，Phase 4 估值章节标注 `[PEER_DATA_MISSING]`

### 3.4 `capital_flow`

- **输入：** `symbol`（A股代码，如 `600036`），`out_dir`（`{targetDir}/data-cache/tushare/`）
- **产出：** `capital_flow.csv`
- **错误处理：** `retryable: true` → 重试 1 次；失败 → 跳过，技术面章节不含资金流分析

### 3.5 `pdf_download_extract`（可选 — 年报 PDF）

- **输入：** `url`（年报下载链接），`out_dir`（`{targetDir}/research/stock-analyze/{date}/raw_data/`，PDF 不进 cache）
- **产出：** `annual_report.txt`, `annual_tables.json`
- **错误处理：** 失败 → 跳过，标注 `[PDF_UNAVAILABLE]`，不影响后续流程

---

## 4. Phase 2 — 计算

基于 Phase 1 产出的 CSV 文件，串行调用 3 个计算工具：

### 4.1 `derived_metrics`

- **输入：** `income_csv`, `balance_csv`, `cashflow_csv`, `out_dir`（`{targetDir}/research/stock-analyze/{date}/metrics`）
- **产出：** `derived_metrics.json`（毛利率、净利率、ROE、ROA、FCF、增长率等）
- **错误处理：** `retryable: true` → 重试 1 次；失败 → 终止（无法生成报告核心数据）

### 4.2 `financial_audit_11`

- **输入：** `income_csv`, `balance_csv`, `cashflow_csv`, `out_dir`
- **产出：** `audit_11.json`（11 项 Piotroski 审计检查，含红旗标记 🔴/🟠/🟡）
- **错误处理：** `retryable: true` → 重试 1 次；失败 → 跳过审计，报告标注 `[AUDIT_SKIPPED]`

### 4.3 `technical_analysis`

- **输入：** `daily_csv`, `out_dir`
- **产出：** `technical.json`（SMA/EMA/RSI/MACD/Bollinger/波动率）
- **错误处理：** `retryable: true` → 重试 1 次；失败 → 跳过技术面章节

---

## 5. Phase 3 — 数据快照

**工具：** `data_snapshot`

- **输入：** `out_dir`（同 Phase 2），`sources`（映射所有 Phase 1/2 产出文件路径）
- **产出：** `snapshot.json` — 统一的事实白名单，后续所有 Part 写作 **只允许** 引用此文件中的数据
- **错误处理：** 失败 → 终止（snapshot 是下游唯一数据源）

`sources` 映射示例：
```json
{
  "income": "raw_data/income.csv",
  "balance": "raw_data/balance.csv",
  "cashflow": "raw_data/cashflow.csv",
  "derived_metrics": "metrics/derived_metrics.json",
  "audit_11": "metrics/audit_11.json",
  "technical": "metrics/technical.json",
  "peer": "raw_data/peer_comparison.csv",
  "capital_flow": "raw_data/capital_flow.csv"
}
```

---

## 6. Phase 4 — 分章撰写

主 LLM 顺序加载 `prompts/` 下的 5 个 part 文件，每个 part 接收 `snapshot.json` 路径 + 前序 part 内容作为上下文：

| 顺序 | Prompt 文件 | 产出 | 依赖 |
|:---:|---|---|---|
| 1 | `prompts/part1-profile.md` | `parts/1-profile.md` | snapshot.json |
| 2 | `prompts/part2-financial.md` | `parts/2-financial.md` | snapshot.json + part1 |
| 3 | `prompts/part3-valuation.md` | `parts/3-valuation.md` | snapshot.json + part1-2 |
| 4 | `prompts/part4-technical.md` | `parts/4-technical.md` | snapshot.json + part1-3 |
| 5 | `prompts/part5-conclusion.md` | `parts/5-conclusion.md` | snapshot.json + part1-4 |

**写作规则：**
- 每个 part ≤ 1500 字
- 数据只能来自 `snapshot.json`，禁止编造
- 不使用顶级 H1 标题（报告拼装时统一加）

---

## 7. Phase 5 — 自审 loop

主 LLM 驱动 3 个 reviewer prompt，最多 3 轮外循环：

```
for round in 1..3:
  for reviewer in [completeness, accuracy, consistency]:
    LLM 加载 prompts/reviewer-{name}.md + 当前 report + snapshot.json
    → 输出 verdict (PASS|FAIL) + issues 列表
  if 全部 PASS: break
  否则: 根据 issues 重写对应 part → 重新 assemble
if 3 轮仍有 FAIL:
  在 report.md 顶部插入 [REVIEW_INCOMPLETE] banner
```

**Reviewer 说明：**
- `reviewer-completeness`：检查 5 个 part 是否覆盖必备维度
- `reviewer-accuracy`：检查数据是否全部源自 snapshot.json
- `reviewer-consistency`：检查跨 part 数字/结论一致性

**Reviewer 输出契约（YAML block）：**
```yaml
---
verdict: PASS|FAIL
issues:
  - "part2 毛利率引用 45.2% 但 snapshot 中为 44.8%"
---
```

---

## 8. Phase 6 — 监控对比

**条件：** `{targetDir}/research/stock-analyze/` 下存在更早日期目录（即非首次分析该 ticker）

**工具：** `monitor_compare`

- **输入：** `current_snapshot`（本次 `snapshot.json` 路径），`previous_snapshot`（上次 `snapshot.json` 路径），`out_dir`
- **产出：** `monitor_delta.json`（逐指标变化 + 告警）
- **行为：** 在最终 report.md 末尾追加"变化提要"子节，列出关键指标变动

**错误处理：** 失败 → 跳过对比，不影响主报告交付

---

## 9. Phase 7 — 交付

**工具：** `assemble_report`

- **输入：** `snapshot_json_path`, `out_dir`（`{targetDir}/research/stock-analyze/{date}`），`ticker`, `company_name`
- **产出：** `report.md`（完整拼装后的最终报告）

**交付步骤：**

1. 调用 `assemble_report` 生成 `{targetDir}/research/stock-analyze/{YYYY-MM-DD}/report.md`
2. 复制一份到 `{targetDir}/{company}-{YYYY-MM-DD}.md`（左侧文件树一眼可见）
3. 写入 `{targetDir}/research/stock-analyze/{YYYY-MM-DD}/_run.log`，内容为本次运行的所有工具调用时间线：
   ```
   [HH:MM:SS] check_env → OK
   [HH:MM:SS] tushare_collect(600036.SH) → 5 files
   [HH:MM:SS] peer_collect → peer_comparison.csv
   ...
   [HH:MM:SS] assemble_report → report.md (12,345 chars)
   ```
4. 在 chat 中输出完成摘要（公司名、总字数、reviewer 轮数、耗时）
