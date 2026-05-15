"""Tests for compute tools — structure only, small inline DataFrames."""
import json

import pandas as pd
import pytest

from research_mcp.tools.compute import derived_metrics, financial_audit_11, technical_analysis


# ===========================================================================
# derived_metrics
# ===========================================================================


def _write_income_csv(path, rows=3):
    """Write a minimal income CSV with required columns."""
    data = {
        "end_date": [f"{2020 + i}1231" for i in range(rows)],
        "revenue": [1e9 * (1.1 ** i) for i in range(rows)],
        "n_income_attr_p": [1e8 * (1.05 ** i) for i in range(rows)],
        "oper_cost": [6e8 * (1.08 ** i) for i in range(rows)],
        "total_profit": [1.2e8 * (1.05 ** i) for i in range(rows)],
    }
    pd.DataFrame(data).to_csv(path, index=False)


def _write_balance_csv(path, rows=3):
    """Write a minimal balance sheet CSV."""
    data = {
        "end_date": [f"{2020 + i}1231" for i in range(rows)],
        "total_assets": [5e9 * (1.05 ** i) for i in range(rows)],
        "total_liab": [2.5e9 * (1.03 ** i) for i in range(rows)],
        "total_cur_assets": [2e9 * (1.04 ** i) for i in range(rows)],
        "total_cur_liab": [1.2e9 * (1.02 ** i) for i in range(rows)],
        "total_hldr_eqy_inc_min_int": [2.5e9 * (1.07 ** i) for i in range(rows)],
    }
    pd.DataFrame(data).to_csv(path, index=False)


def _write_cashflow_csv(path, rows=3):
    """Write a minimal cashflow CSV."""
    data = {
        "end_date": [f"{2020 + i}1231" for i in range(rows)],
        "n_cashflow_act": [3e8 * (1.06 ** i) for i in range(rows)],
        "c_pay_acq_const_fiolta": [1e8 * (1.02 ** i) for i in range(rows)],
    }
    pd.DataFrame(data).to_csv(path, index=False)


def test_derived_metrics_writes_csv(tmp_path):
    income_csv = str(tmp_path / "income.csv")
    balance_csv = str(tmp_path / "balance.csv")
    cashflow_csv = str(tmp_path / "cashflow.csv")
    out_dir = str(tmp_path / "out")

    _write_income_csv(income_csv)
    _write_balance_csv(balance_csv)
    _write_cashflow_csv(cashflow_csv)

    result = derived_metrics(income_csv, balance_csv, cashflow_csv, out_dir)
    assert result["ok"] is True
    assert "derived_metrics.csv" in result["paths"]
    assert (tmp_path / "out" / "derived_metrics.csv").exists()
    assert result["summary"]["rows"] > 0
    assert isinstance(result["summary"]["metrics"], list)
    assert len(result["summary"]["metrics"]) >= 8
    assert isinstance(result["summary"]["periods"], list)
    assert len(result["summary"]["periods"]) == 2


def test_derived_metrics_handles_missing_file(tmp_path):
    result = derived_metrics(
        str(tmp_path / "nope.csv"),
        str(tmp_path / "nope2.csv"),
        str(tmp_path / "nope3.csv"),
        str(tmp_path / "out"),
    )
    assert result["ok"] is False
    assert result["retryable"] is False


# ===========================================================================
# financial_audit_11
# ===========================================================================


def test_financial_audit_writes_json(tmp_path):
    income_csv = str(tmp_path / "income.csv")
    balance_csv = str(tmp_path / "balance.csv")
    cashflow_csv = str(tmp_path / "cashflow.csv")
    out_dir = str(tmp_path / "out")

    _write_income_csv(income_csv)
    _write_balance_csv(balance_csv)
    _write_cashflow_csv(cashflow_csv)

    result = financial_audit_11(income_csv, balance_csv, cashflow_csv, out_dir)
    assert result["ok"] is True
    assert "audit.json" in result["paths"]
    assert (tmp_path / "out" / "audit.json").exists()

    audit_data = json.loads((tmp_path / "out" / "audit.json").read_text(encoding="utf-8"))
    assert "checks" in audit_data
    assert "overall" in audit_data
    assert audit_data["overall"] in ("PASS", "WARN", "FAIL")
    # Should have exactly 11 checks
    assert len(audit_data["checks"]) == 11

    summary = result["summary"]
    assert summary["passed"] + summary["warned"] + summary["failed"] == 11
    assert summary["overall"] in ("PASS", "WARN", "FAIL")


def test_financial_audit_handles_missing_file(tmp_path):
    result = financial_audit_11(
        str(tmp_path / "nope.csv"),
        str(tmp_path / "nope2.csv"),
        str(tmp_path / "nope3.csv"),
        str(tmp_path / "out"),
    )
    assert result["ok"] is False
    assert result["retryable"] is False


# ===========================================================================
# technical_analysis
# ===========================================================================


def _write_daily_csv(path, rows=150):
    """Write a minimal daily price CSV with enough rows for TA indicators."""
    import numpy as np
    dates = pd.date_range("2023-01-01", periods=rows, freq="B")
    close = 100 + np.cumsum(np.random.default_rng(42).normal(0, 1, rows))
    data = {
        "trade_date": [d.strftime("%Y%m%d") for d in dates],
        "open": close - 0.5,
        "high": close + 1.0,
        "low": close - 1.0,
        "close": close,
        "vol": [1e6 + i * 1000 for i in range(rows)],
    }
    pd.DataFrame(data).to_csv(path, index=False)


def test_technical_analysis_writes_outputs(tmp_path):
    daily_csv = str(tmp_path / "daily.csv")
    out_dir = str(tmp_path / "out")
    _write_daily_csv(daily_csv)

    result = technical_analysis(daily_csv, out_dir)
    assert result["ok"] is True
    assert "technicals.csv" in result["paths"]
    assert "signals.json" in result["paths"]
    assert (tmp_path / "out" / "technicals.csv").exists()
    assert (tmp_path / "out" / "signals.json").exists()

    summary = result["summary"]
    assert summary["rows"] == 150
    assert isinstance(summary["last_close"], float)
    assert isinstance(summary["last_rsi"], float)
    assert isinstance(summary["signals"], list)


def test_technical_analysis_handles_empty_csv(tmp_path):
    daily_csv = str(tmp_path / "daily.csv")
    pd.DataFrame().to_csv(daily_csv, index=False)
    out_dir = str(tmp_path / "out")

    result = technical_analysis(daily_csv, out_dir)
    assert result["ok"] is False
    assert result["retryable"] is False


def test_technical_analysis_handles_missing_file(tmp_path):
    result = technical_analysis(str(tmp_path / "nope.csv"), str(tmp_path / "out"))
    assert result["ok"] is False
    assert result["retryable"] is False
