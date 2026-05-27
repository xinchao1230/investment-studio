"""Pure-compute tools for financial analysis.

Covers derived metrics, financial audit, and technical analysis.
All tools take CSV file paths as input and write results to out_dir.
Testing pattern: pass small inline DataFrames via tmp_path CSVs.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import pandas as pd

from research_mcp.lib.result import ok, fail


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _safe_div(a, b):
    """Safe division returning None on zero/None."""
    if a is None or b is None or b == 0:
        return None
    return a / b


def _safe_float(x):
    """Convert to float, return None on failure/NaN."""
    try:
        if x is None:
            return None
        import math
        v = float(x)
        if math.isnan(v):
            return None
        return v
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------------------
# Tool: derived_metrics
# ---------------------------------------------------------------------------

def derived_metrics(
    income_csv: str,
    balance_csv: str,
    cashflow_csv: str,
    out_dir: str,
) -> dict:
    """Compute derived financial ratios from income, balance sheet, and cashflow CSVs.

    Computes ~10 stable ratios per fiscal period: gross margin, operating margin,
    net margin, ROE, ROA, current ratio, debt-to-equity, free cash flow,
    revenue growth YoY, and net income growth YoY.

    Args:
        income_csv: Path to income statement CSV (from tushare_collect/yfinance_collect).
        balance_csv: Path to balance sheet CSV.
        cashflow_csv: Path to cashflow CSV.
        out_dir: Absolute output directory.

    Returns:
        Result dict with ok, paths, summary or error fields.
    """
    try:
        os.makedirs(out_dir, exist_ok=True)

        df_inc = pd.read_csv(income_csv)
        df_bal = pd.read_csv(balance_csv)
        df_cf = pd.read_csv(cashflow_csv)

        if df_inc.empty:
            return fail(error="derived_metrics failed: income CSV is empty", retryable=False)

        # Align by end_date
        rows = []
        for _, inc_row in df_inc.iterrows():
            period = str(inc_row.get("end_date", ""))
            revenue = _safe_float(inc_row.get("revenue"))
            oper_cost = _safe_float(inc_row.get("oper_cost"))
            net_income = _safe_float(inc_row.get("n_income_attr_p"))
            total_profit = _safe_float(inc_row.get("total_profit"))

            # Match balance row
            bal_row = df_bal[df_bal["end_date"].astype(str) == period]
            total_assets = _safe_float(bal_row.iloc[0].get("total_assets")) if not bal_row.empty else None
            total_liab = _safe_float(bal_row.iloc[0].get("total_liab")) if not bal_row.empty else None
            total_cur_assets = _safe_float(bal_row.iloc[0].get("total_cur_assets")) if not bal_row.empty else None
            total_cur_liab = _safe_float(bal_row.iloc[0].get("total_cur_liab")) if not bal_row.empty else None
            equity = _safe_float(bal_row.iloc[0].get("total_hldr_eqy_inc_min_int")) if not bal_row.empty else None

            # Match cashflow row
            cf_row = df_cf[df_cf["end_date"].astype(str) == period]
            ocf = _safe_float(cf_row.iloc[0].get("n_cashflow_act")) if not cf_row.empty else None
            capex = _safe_float(cf_row.iloc[0].get("c_pay_acq_const_fiolta")) if not cf_row.empty else None

            metrics = {"period": period}
            metrics["gross_margin"] = _safe_div((revenue or 0) - (oper_cost or 0), revenue) if revenue else None
            metrics["operating_margin"] = _safe_div(total_profit, revenue)
            metrics["net_margin"] = _safe_div(net_income, revenue)
            metrics["roe"] = _safe_div(net_income, equity)
            metrics["roa"] = _safe_div(net_income, total_assets)
            metrics["current_ratio"] = _safe_div(total_cur_assets, total_cur_liab)
            metrics["debt_to_equity"] = _safe_div(total_liab, equity)
            metrics["free_cashflow"] = (ocf - capex) if ocf is not None and capex is not None else None
            metrics["revenue"] = revenue
            metrics["net_income"] = net_income

            rows.append(metrics)

        df_out = pd.DataFrame(rows)

        # Compute YoY growth (requires sorted by period)
        df_out = df_out.sort_values("period").reset_index(drop=True)
        df_out["revenue_growth_yoy"] = df_out["revenue"].pct_change()
        df_out["net_income_growth_yoy"] = df_out["net_income"].pct_change()

        # Write output
        out_path = Path(out_dir) / "derived_metrics.csv"
        df_out.to_csv(out_path, index=False)

        metric_names = [
            "gross_margin", "operating_margin", "net_margin", "roe", "roa",
            "current_ratio", "debt_to_equity", "free_cashflow",
            "revenue_growth_yoy", "net_income_growth_yoy",
        ]
        periods = df_out["period"].tolist()
        summary = {
            "rows": len(df_out),
            "metrics": metric_names,
            "periods": [periods[0], periods[-1]] if periods else [],
        }

        return ok(paths=["derived_metrics.csv"], summary=summary)
    except Exception as e:
        return fail(error=f"derived_metrics failed: {e}", retryable=False)


# ---------------------------------------------------------------------------
# Tool: financial_audit_11
# ---------------------------------------------------------------------------

def financial_audit_11(
    income_csv: str,
    balance_csv: str,
    cashflow_csv: str,
    out_dir: str,
) -> dict:
    """Run an 11-checkpoint financial-quality audit.

    Selection criteria for the 11 checks (from financial_audit.py frameworks):
    1. Net income positive (Piotroski #1)
    2. Operating cash flow positive (Piotroski #3)
    3. Cash flow > net income (earnings quality, Piotroski #4)
    4. ROA improvement YoY (Piotroski #5)
    5. Leverage decrease YoY (Piotroski #6)
    6. Current ratio improvement YoY (Piotroski #7)
    7. Gross margin improvement YoY (Piotroski #8)
    8. Asset turnover improvement YoY (Piotroski #9)
    9. Revenue growth positive (growth quality)
    10. Free cash flow positive (capital allocation)
    11. Debt-to-equity below 2.0 (solvency)

    Args:
        income_csv: Path to income statement CSV.
        balance_csv: Path to balance sheet CSV.
        cashflow_csv: Path to cashflow CSV.
        out_dir: Absolute output directory.

    Returns:
        Result dict with ok, paths, summary or error fields.
    """
    try:
        os.makedirs(out_dir, exist_ok=True)

        df_inc = pd.read_csv(income_csv)
        df_bal = pd.read_csv(balance_csv)
        df_cf = pd.read_csv(cashflow_csv)

        if df_inc.empty or len(df_inc) < 2:
            return fail(error="financial_audit_11 failed: need at least 2 periods of data", retryable=False)

        # Sort by period ascending
        df_inc = df_inc.sort_values("end_date").reset_index(drop=True)
        df_bal = df_bal.sort_values("end_date").reset_index(drop=True)
        df_cf = df_cf.sort_values("end_date").reset_index(drop=True)

        # Latest and previous period
        inc_now = df_inc.iloc[-1]
        inc_prev = df_inc.iloc[-2]

        bal_now = df_bal.iloc[-1] if len(df_bal) >= 1 else pd.Series()
        bal_prev = df_bal.iloc[-2] if len(df_bal) >= 2 else pd.Series()

        cf_now = df_cf.iloc[-1] if len(df_cf) >= 1 else pd.Series()
        cf_prev = df_cf.iloc[-2] if len(df_cf) >= 2 else pd.Series()

        # Extract values
        ni_now = _safe_float(inc_now.get("n_income_attr_p"))
        ni_prev = _safe_float(inc_prev.get("n_income_attr_p"))
        rev_now = _safe_float(inc_now.get("revenue"))
        rev_prev = _safe_float(inc_prev.get("revenue"))
        cost_now = _safe_float(inc_now.get("oper_cost"))
        cost_prev = _safe_float(inc_prev.get("oper_cost"))

        ta_now = _safe_float(bal_now.get("total_assets"))
        ta_prev = _safe_float(bal_prev.get("total_assets"))
        tl_now = _safe_float(bal_now.get("total_liab"))
        tl_prev = _safe_float(bal_prev.get("total_liab"))
        tca_now = _safe_float(bal_now.get("total_cur_assets"))
        tca_prev = _safe_float(bal_prev.get("total_cur_assets"))
        tcl_now = _safe_float(bal_now.get("total_cur_liab"))
        tcl_prev = _safe_float(bal_prev.get("total_cur_liab"))
        equity_now = _safe_float(bal_now.get("total_hldr_eqy_inc_min_int"))

        ocf_now = _safe_float(cf_now.get("n_cashflow_act"))
        capex_now = _safe_float(cf_now.get("c_pay_acq_const_fiolta"))

        checks: list[dict] = []

        def _check(name: str, condition: bool | None, value, threshold: str, note: str):
            if condition is None:
                status = "WARN"
            elif condition:
                status = "PASS"
            else:
                status = "FAIL"
            checks.append({
                "name": name,
                "status": status,
                "value": value,
                "threshold": threshold,
                "note": note,
            })

        # 1. Net income positive
        _check("net_income_positive", (ni_now or 0) > 0,
               ni_now, "> 0", "Latest period net income")

        # 2. Operating cash flow positive
        _check("ocf_positive", (ocf_now or 0) > 0,
               ocf_now, "> 0", "Latest period operating cash flow")

        # 3. Cash flow > net income (earnings quality)
        _check("ocf_exceeds_ni", (ocf_now or 0) > (ni_now or 0),
               _safe_div(ocf_now, ni_now), "OCF/NI > 1", "Earnings backed by cash")

        # 4. ROA improvement YoY
        roa_now = _safe_div(ni_now, ta_now)
        roa_prev = _safe_div(ni_prev, ta_prev)
        _check("roa_improvement", (roa_now or 0) > (roa_prev or 0) if roa_now is not None and roa_prev is not None else None,
               roa_now, "ROA(t) > ROA(t-1)", "Return on assets trend")

        # 5. Leverage decrease YoY
        lev_now = _safe_div(tl_now, ta_now)
        lev_prev = _safe_div(tl_prev, ta_prev)
        _check("leverage_decrease", (lev_now or 1) < (lev_prev or 1) if lev_now is not None and lev_prev is not None else None,
               lev_now, "Lev(t) < Lev(t-1)", "Debt-to-assets trend")

        # 6. Current ratio improvement YoY
        cr_now = _safe_div(tca_now, tcl_now)
        cr_prev = _safe_div(tca_prev, tcl_prev)
        _check("current_ratio_improvement", (cr_now or 0) > (cr_prev or 0) if cr_now is not None and cr_prev is not None else None,
               cr_now, "CR(t) > CR(t-1)", "Liquidity trend")

        # 7. Gross margin improvement YoY
        gm_now = _safe_div((rev_now or 0) - (cost_now or 0), rev_now) if rev_now else None
        gm_prev = _safe_div((rev_prev or 0) - (cost_prev or 0), rev_prev) if rev_prev else None
        _check("gross_margin_improvement", (gm_now or 0) > (gm_prev or 0) if gm_now is not None and gm_prev is not None else None,
               gm_now, "GM(t) > GM(t-1)", "Profitability trend")

        # 8. Asset turnover improvement YoY
        at_now = _safe_div(rev_now, ta_now)
        at_prev = _safe_div(rev_prev, ta_prev)
        _check("asset_turnover_improvement", (at_now or 0) > (at_prev or 0) if at_now is not None and at_prev is not None else None,
               at_now, "AT(t) > AT(t-1)", "Efficiency trend")

        # 9. Revenue growth positive
        rev_growth = _safe_div((rev_now or 0) - (rev_prev or 0), rev_prev) if rev_prev else None
        _check("revenue_growth_positive", (rev_growth or 0) > 0 if rev_growth is not None else None,
               rev_growth, "> 0%", "Top-line growth")

        # 10. Free cash flow positive
        fcf = (ocf_now - capex_now) if ocf_now is not None and capex_now is not None else None
        _check("fcf_positive", (fcf or 0) > 0 if fcf is not None else None,
               fcf, "> 0", "Cash generation after capex")

        # 11. Debt-to-equity below 2.0
        dte = _safe_div(tl_now, equity_now)
        _check("debt_to_equity_safe", (dte or 0) < 2.0 if dte is not None else None,
               dte, "< 2.0", "Solvency check")

        # Overall status
        statuses = [c["status"] for c in checks]
        if "FAIL" in statuses:
            overall = "FAIL"
        elif "WARN" in statuses:
            overall = "WARN"
        else:
            overall = "PASS"

        audit_result = {"checks": checks, "overall": overall}
        out_path = Path(out_dir) / "audit.json"
        out_path.write_text(json.dumps(audit_result, ensure_ascii=False, indent=2), encoding="utf-8")

        passed = statuses.count("PASS")
        warned = statuses.count("WARN")
        failed = statuses.count("FAIL")
        summary = {"passed": passed, "warned": warned, "failed": failed, "overall": overall}

        return ok(paths=["audit.json"], summary=summary)
    except Exception as e:
        return fail(error=f"financial_audit_11 failed: {e}", retryable=False)


# ---------------------------------------------------------------------------
# Tool: technical_analysis
# ---------------------------------------------------------------------------

def technical_analysis(
    daily_csv: str,
    out_dir: str,
) -> dict:
    """Compute technical analysis indicators from daily price data.

    Indicators: SMA(20/60/120), EMA(12/26), RSI(14), MACD(12/26/9),
    Bollinger Bands(20,2σ), 20-day volatility, volume MA(20).
    Outputs enriched daily CSV and a signals JSON with latest crossover signals.

    Args:
        daily_csv: Path to daily price CSV (columns: trade_date, open, high, low, close, vol).
        out_dir: Absolute output directory.

    Returns:
        Result dict with ok, paths, summary or error fields.
    """
    try:
        os.makedirs(out_dir, exist_ok=True)

        df = pd.read_csv(daily_csv)
        if df.empty or "close" not in df.columns:
            return fail(error="technical_analysis failed: daily CSV is empty or missing 'close' column", retryable=False)

        # Sort ascending by trade_date
        if "trade_date" in df.columns:
            df = df.sort_values("trade_date").reset_index(drop=True)

        close = df["close"].astype(float)
        vol = df["vol"].astype(float) if "vol" in df.columns else pd.Series([0] * len(df))

        # SMA
        df["sma_20"] = close.rolling(window=20, min_periods=1).mean()
        df["sma_60"] = close.rolling(window=60, min_periods=1).mean()
        df["sma_120"] = close.rolling(window=120, min_periods=1).mean()

        # EMA
        df["ema_12"] = close.ewm(span=12, adjust=False).mean()
        df["ema_26"] = close.ewm(span=26, adjust=False).mean()

        # MACD
        diff = df["ema_12"] - df["ema_26"]
        dea = diff.ewm(span=9, adjust=False).mean()
        df["macd_diff"] = diff
        df["macd_dea"] = dea
        df["macd_hist"] = (diff - dea) * 2

        # RSI(14)
        delta = close.diff()
        gain = delta.where(delta > 0, 0).rolling(window=14, min_periods=1).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=14, min_periods=1).mean()
        rs = gain / loss.replace(0, float("nan"))
        df["rsi_14"] = 100 - 100 / (1 + rs)

        # Bollinger Bands (20, 2σ)
        df["boll_mid"] = df["sma_20"]
        std_20 = close.rolling(window=20, min_periods=1).std()
        df["boll_upper"] = df["boll_mid"] + 2 * std_20
        df["boll_lower"] = df["boll_mid"] - 2 * std_20

        # Volatility (20-day std of returns)
        df["volatility_20d"] = close.pct_change().rolling(window=20, min_periods=1).std()

        # Volume MA(20)
        df["vol_ma_20"] = vol.rolling(window=20, min_periods=1).mean()

        # Write technicals CSV
        tech_path = Path(out_dir) / "technicals.csv"
        df.to_csv(tech_path, index=False)

        # Generate signals (latest crossover signals)
        signals: list[str] = []
        if len(df) >= 2:
            last = df.iloc[-1]
            prev = df.iloc[-2]

            # MACD golden/death cross
            if prev["macd_diff"] < prev["macd_dea"] and last["macd_diff"] >= last["macd_dea"]:
                signals.append("macd_golden_cross")
            elif prev["macd_diff"] > prev["macd_dea"] and last["macd_diff"] <= last["macd_dea"]:
                signals.append("macd_death_cross")

            # Price crosses SMA20
            if prev["close"] < prev["sma_20"] and last["close"] >= last["sma_20"]:
                signals.append("price_above_sma20")
            elif prev["close"] > prev["sma_20"] and last["close"] <= last["sma_20"]:
                signals.append("price_below_sma20")

            # RSI extremes
            rsi_val = last["rsi_14"]
            if pd.notna(rsi_val):
                if rsi_val > 70:
                    signals.append("rsi_overbought")
                elif rsi_val < 30:
                    signals.append("rsi_oversold")

            # Bollinger breakout
            if last["close"] > last["boll_upper"]:
                signals.append("boll_upper_breakout")
            elif last["close"] < last["boll_lower"]:
                signals.append("boll_lower_breakout")

        last_row = df.iloc[-1]
        signals_data = {
            "trade_date": str(last_row.get("trade_date", "")),
            "last_close": float(last_row["close"]),
            "last_rsi": float(last_row["rsi_14"]) if pd.notna(last_row["rsi_14"]) else None,
            "signals": signals,
        }

        signals_path = Path(out_dir) / "signals.json"
        signals_path.write_text(json.dumps(signals_data, ensure_ascii=False, indent=2), encoding="utf-8")

        summary = {
            "rows": len(df),
            "last_close": float(last_row["close"]),
            "last_rsi": float(last_row["rsi_14"]) if pd.notna(last_row["rsi_14"]) else 0.0,
            "signals": signals,
        }

        return ok(paths=["technicals.csv", "signals.json"], summary=summary)
    except Exception as e:
        return fail(error=f"technical_analysis failed: {e}", retryable=False)


# ---------------------------------------------------------------------------
# Tool: data_snapshot
# ---------------------------------------------------------------------------

def data_snapshot(
    out_dir: str,
    *,
    sources: dict | None = None,
) -> dict:
    """Bundle multiple source files into a unified JSON snapshot.

    Reads each source file path from `sources` dict. CSV files are parsed as
    records, JSON files are loaded as-is. Missing files get recorded as
    {"_unavailable": True} without failing the tool.

    Args:
        out_dir: Absolute output directory.
        sources: Mapping of key -> file path. e.g.
            {"derived_metrics": "/path/to/derived_metrics.csv",
             "audit": "/path/to/audit.json",
             "technicals": "/path/to/technicals.csv"}

    Returns:
        Result dict with ok, paths, summary or error fields.
    """
    try:
        os.makedirs(out_dir, exist_ok=True)
        sources = sources or {}

        snapshot: dict = {}
        available = 0
        unavailable = 0

        for key, filepath in sources.items():
            p = Path(filepath)
            if not p.exists():
                snapshot[key] = {"_unavailable": True}
                unavailable += 1
                continue

            try:
                if p.suffix == ".json":
                    snapshot[key] = json.loads(p.read_text(encoding="utf-8"))
                elif p.suffix == ".csv":
                    df = pd.read_csv(filepath)
                    snapshot[key] = df.to_dict(orient="records")
                else:
                    snapshot[key] = p.read_text(encoding="utf-8")
                available += 1
            except Exception:
                snapshot[key] = {"_unavailable": True}
                unavailable += 1

        out_path = Path(out_dir) / "snapshot.json"
        out_path.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")

        summary = {
            "available": available,
            "unavailable": unavailable,
            "sources": list(sources.keys()),
        }

        return ok(paths=["snapshot.json"], summary=summary)
    except Exception as e:
        return fail(error=f"data_snapshot failed: {e}", retryable=False)
