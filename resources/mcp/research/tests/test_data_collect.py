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

from research_mcp.tools.data_collect import yfinance_collect


# ===========================================================================
# yfinance_collect
# ===========================================================================

class FakeYFinanceTicker:
    @property
    def financials(self):
        return pd.DataFrame({"Total Revenue": [1e9], "Net Income": [1e8]}, index=["2023-12-31"])

    @property
    def balance_sheet(self):
        return pd.DataFrame({"Total Assets": [5e9]}, index=["2023-12-31"])

    @property
    def cashflow(self):
        return pd.DataFrame({"Operating Cash Flow": [2e8]}, index=["2023-12-31"])

    def history(self, period="5y"):
        return pd.DataFrame({"Close": [150.0, 155.0], "Volume": [1e6, 1.1e6]},
                            index=pd.to_datetime(["2023-01-01", "2023-01-02"]))


def test_yfinance_collect_writes_expected_output(tmp_path):
    out = yfinance_collect("AAPL", str(tmp_path), _client=FakeYFinanceTicker())
    assert out["ok"] is True
    assert "income_annual.csv" in out["paths"]
    assert "balance_annual.csv" in out["paths"]
    assert "cashflow_annual.csv" in out["paths"]
    assert "history.csv" in out["paths"]
    assert out["summary"]["symbol"] == "AAPL"
    assert out["summary"]["history_rows"] == 2
    # Verify files
    assert (tmp_path / "history.csv").exists()


def test_yfinance_collect_handles_failure_gracefully(tmp_path):
    class BoomTicker:
        @property
        def financials(self):
            raise RuntimeError("yf_boom")

    out = yfinance_collect("AAPL", str(tmp_path), _client=BoomTicker())
    assert out["ok"] is False
    assert "yf_boom" in out["error"]

from research_mcp.tools.data_collect import peer_collect


# ===========================================================================
# peer_collect
# ===========================================================================

class FakePeerClient:
    def daily_basic(self, ts_code=None, **kw):
        return pd.DataFrame({"ts_code": [ts_code], "pe_ttm": [12.5], "pb": [1.2], "total_mv": [5000.0]})

    def fina_indicator(self, ts_code=None, **kw):
        return pd.DataFrame({"ts_code": [ts_code], "roe": [15.0], "grossprofit_margin": [30.0]})


def test_peer_collect_writes_expected_output(tmp_path):
    out = peer_collect(
        "600036.SH",
        ["601166.SH", "000001.SZ"],
        str(tmp_path),
        _client=FakePeerClient(),
    )
    assert out["ok"] is True
    assert "peer_valuation.csv" in out["paths"]
    assert "peer_financials.csv" in out["paths"]
    # 3 codes total (target + 2 peers)
    assert out["summary"]["valuation_rows"] == 3
    assert out["summary"]["financials_rows"] == 3
    assert (tmp_path / "peer_valuation.csv").exists()


def test_peer_collect_handles_failure_gracefully(tmp_path):
    class BoomClient:
        def daily_basic(self, **kw):
            raise RuntimeError("peer_boom")

    out = peer_collect("600036.SH", ["601166.SH"], str(tmp_path), _client=BoomClient())
    assert out["ok"] is False
    assert "peer_boom" in out["error"]

from research_mcp.tools.data_collect import capital_flow


# ===========================================================================
# capital_flow
# ===========================================================================

class FakeAkshare:
    def stock_individual_fund_flow(self, stock=None, market=None):
        return pd.DataFrame({
            "\u65e5\u671f": ["2023-12-29"],
            "\u4e3b\u529b\u51c0\u6d41\u5165-\u51c0\u989d": [1.5e7],
        })

    def stock_individual_fund_flow_rank(self, indicator=None):
        return pd.DataFrame({
            "\u4ee3\u7801": ["600036", "601166"],
            "\u540d\u79f0": ["\u62db\u5546\u94f6\u884c", "\u5174\u4e1a\u94f6\u884c"],
            "\u6700\u65b0\u4ef7": [35.0, 18.0],
        })


def test_capital_flow_writes_expected_output(tmp_path):
    out = capital_flow("600036.SH", str(tmp_path), _client=FakeAkshare())
    assert out["ok"] is True
    assert "individual_fund_flow.csv" in out["paths"]
    assert "fund_flow_rank.csv" in out["paths"]
    assert out["summary"]["flow_rows"] == 1
    assert out["summary"]["rank_rows"] == 2
    assert (tmp_path / "individual_fund_flow.csv").exists()


def test_capital_flow_handles_failure_gracefully(tmp_path):
    class BoomAk:
        def stock_individual_fund_flow(self, **kw):
            raise RuntimeError("ak_boom")

    out = capital_flow("600036.SH", str(tmp_path), _client=BoomAk())
    assert out["ok"] is False
    assert "ak_boom" in out["error"]
    assert out["retryable"] is False
