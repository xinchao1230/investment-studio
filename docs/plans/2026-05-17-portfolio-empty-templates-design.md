# Portfolio Target — Empty Template Skeletons

**Date:** 2026-05-17
**Status:** Approved, ready for implementation
**Scope:** `portfolio_init_target` builtin tool — `key-drivers.md`, `notes.md`, `tracking.md`

## Problem

`PortfolioTools.executeInitTarget` writes a `key-drivers.md` whose body is
**hardcoded with Ctrip's (携程) investment thesis** — short-term/long-term logic
and seven 携程-specific tracking variables. Any newly-created listed target
(e.g. 海底捞, 腾讯) inherits this Ctrip narrative until the LLM is asked to
rewrite it via `portfolio_update_key_drivers`.

Concrete impact:

- Misleading boilerplate the user must manually delete
- Downstream skills (`earnings-review`, `marginal-tracking`, `deep-report`)
  read `key-drivers.md` to learn "what matters for this company" — they pick
  up Ctrip's drivers instead

The unlisted variant has the same shape (different placeholder text), but is
phrased as instructive prompts rather than fake content, so it's less harmful.
Still benefits from cleanup for consistency.

`notes.md` and `tracking.md` are already mostly empty (title + header). Only
minor tightening needed.

## Goals

1. New target's `key-drivers.md` contains **structural skeleton only**, no
   fabricated investment thesis
2. Preserve the listed/unlisted variant split — they have different sections
   (估值参考 vs 单位经济 + 退出路径)
3. Existing targets untouched — only initial creation is changed
4. Downstream tools (`portfolio_update_key_drivers` + reader skills) keep
   working unchanged

## Non-Goals

- Auto-generating content during creation (would add a tool round-trip)
- Moving templates to external files / resources (over-engineering for ~30 lines)
- Brand-specific templates (only investment-studio uses portfolio_*)

## Design

### key-drivers.md — listed

```markdown
# {name} ({stock_code}) — Key Drivers

## 投资逻辑

**短期逻辑**：

**长期逻辑**：

## 核心跟踪变量

1.
2.
3.

## 估值参考

| 可比公司 | 代码 | PS | PE | EV/Sales | 备注 |
|---------|------|----|----|----------|------|
|         |      |    |    |          |      |

## 风险

-
```

### key-drivers.md — unlisted

```markdown
# {name} — Key Drivers

## 投资逻辑

**短期逻辑**：

**长期逻辑**：

## 核心跟踪变量

1.
2.
3.

## 单位经济与资金

- 关键运营指标：
- 单位经济（LTV/CAC、毛利率）：
- 现金跑道：

## 估值参考（可比公司）

| 可比公司 | 代码 | PS | PE | EV/Sales | 备注 |
|---------|------|----|----|----------|------|
|         |      |    |    |          |      |

## 退出路径与风险

-
```

### notes.md

Unchanged. Already a clean title + blank.

### tracking.md

Add a one-line guidance blockquote above the existing 5-column table.

```markdown
# {name} ({stock_code}) — Marginal Change Tracking

> 用于记录"基本面边际变化"——关键指标 vs 上期 / 预期、行业政策、公司公告等。
> 建议每次跟踪 skill 自动 append；手动补充时按时间倒序。

| Date | Item | Previous | Current | Note |
|------|------|----------|---------|------|
```

## Implementation

Edit only:

- `src/main/lib/mcpRuntime/builtinTools/portfolioTools.ts`
  - Replace `buildListedKeyDrivers()` body with the listed skeleton above
  - Replace `buildUnlistedKeyDrivers()` body with the unlisted skeleton above
  - Update the inline `notes.md` / `tracking.md` writers in `executeInitTarget`
    to include the tracking blockquote

- `src/main/lib/mcpRuntime/builtinTools/__tests__/portfolioTools.test.ts`
  - Existing assertion "renders unlisted key-drivers without empty parens and
    includes 现金跑道" → keep "现金跑道" (now in 单位经济与资金 section)
  - Add positive assertions: listed contains `## 估值参考`; unlisted contains
    `## 单位经济与资金` and `## 退出路径与风险`
  - Add negative assertions: neither file contains `携程` / `携程`-specific
    tracking variables (`take rate`, `同程`, etc.)

## Compatibility

- `portfolio_update_key_drivers` signature unchanged → reader skills unaffected
- `profile.yaml` schema unchanged
- Old target folders on disk are not touched

## Risks

- Reader skills that pattern-match on Chinese section headers should be
  unaffected (headers preserved: `## 投资逻辑`, `## 核心跟踪变量`)
- LLM agents previously relying on Ctrip's structure as a writing example will
  now see a sparser scaffold — this is the desired outcome
