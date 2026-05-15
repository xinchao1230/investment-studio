"""Tests for data_collect tools — structure only, no live network calls."""
import pandas as pd
import pytest

from research_mcp.tools.data_collect import tushare_collect


# ===========================================================================
# tushare_collect
# ===========================================================================

class FakeTushareClient:
    def income(self, **kw):
        return pd.DataFrame({"end_date": ["20231231"], "revenue": [1.0e9]})

    def balancesheet(self, **kw):
        return pd.DataFrame({"end_date": ["20231231"], "total_assets": [5.0e9]})

    def cashflow(self, **kw):
        return pd.DataFrame({"end_date": ["20231231"], "n_cashflow_act": [2.0e8]})


def test_tushare_collect_writes_expected_output(tmp_path):
    out = tushare_collect("600036.SH", str(tmp_path), _client=FakeTushareClient())
    assert out["ok"] is True
    assert "income.csv" in out["paths"]
    assert "balancesheet.csv" in out["paths"]
    assert "cashflow.csv" in out["paths"]
    assert out["summary"]["income_rows"] == 1
    # Verify files exist on disk
    assert (tmp_path / "income.csv").exists()
    assert (tmp_path / "balancesheet.csv").exists()
    assert (tmp_path / "cashflow.csv").exists()


def test_tushare_collect_handles_failure_gracefully(tmp_path):
    class BoomClient:
        def income(self, **kw):
            raise RuntimeError("boom")

    out = tushare_collect("600036.SH", str(tmp_path), _client=BoomClient())
    assert out["ok"] is False
    assert "boom" in out["error"]
    assert out["retryable"] is True
