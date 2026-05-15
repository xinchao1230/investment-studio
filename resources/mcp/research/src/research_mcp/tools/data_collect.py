"""Data collection tools for A-share and US equity research.

Testing pattern: Dependency Injection (DI) via `_client` parameter.
Each tool accepts an optional `_client` kwarg. In production it defaults to
the real API client (tushare/yfinance/akshare); in tests a fake client is
injected that returns small fixture DataFrames. This avoids all network calls
in pytest while keeping the file-writing logic fully exercised.
"""
from __future__ import annotations

import os
from pathlib import Path

import pandas as pd

from research_mcp.lib.result import ok, fail


# ---------------------------------------------------------------------------
# Tool 1: tushare_collect
# ---------------------------------------------------------------------------

def _build_tushare_client():
    """Build default tushare pro_api client from env."""
    import tushare as ts
    token = os.environ.get("TUSHARE_TOKEN", "")
    if not token:
        raise RuntimeError("TUSHARE_TOKEN not set")
    ts.set_token(token)
    return ts.pro_api()


def tushare_collect(
    ts_code: str,
    out_dir: str,
    start_date: str = "",
    *,
    _client=None,
) -> dict:
    """Fetch annual financials (income, balance, cashflow) for an A-share ticker via Tushare.

    Args:
        ts_code: Tushare ticker, e.g. '600036.SH'.
        out_dir: Absolute output directory. Files written here.
        start_date: Optional YYYYMMDD start date filter. Defaults to '20200101'.
        _client: Injected tushare pro_api instance for testing.

    Returns:
        Result dict with ok, paths, summary or error fields.
    """
    try:
        os.makedirs(out_dir, exist_ok=True)
        client = _client or _build_tushare_client()
        sd = start_date or "20200101"

        paths: list[str] = []
        summary: dict = {"ts_code": ts_code}

        # Income statement
        df_income = client.income(ts_code=ts_code, start_date=sd)
        if df_income is None:
            df_income = pd.DataFrame()
        p = Path(out_dir) / "income.csv"
        df_income.to_csv(p, index=False)
        paths.append("income.csv")
        summary["income_rows"] = len(df_income)

        # Balance sheet
        df_balance = client.balancesheet(ts_code=ts_code, start_date=sd)
        if df_balance is None:
            df_balance = pd.DataFrame()
        p = Path(out_dir) / "balancesheet.csv"
        df_balance.to_csv(p, index=False)
        paths.append("balancesheet.csv")
        summary["balance_rows"] = len(df_balance)

        # Cash flow
        df_cashflow = client.cashflow(ts_code=ts_code, start_date=sd)
        if df_cashflow is None:
            df_cashflow = pd.DataFrame()
        p = Path(out_dir) / "cashflow.csv"
        df_cashflow.to_csv(p, index=False)
        paths.append("cashflow.csv")
        summary["cashflow_rows"] = len(df_cashflow)

        return ok(paths=paths, summary=summary)
    except Exception as e:
        return fail(error=f"tushare_collect failed: {e}", retryable=True)


# ---------------------------------------------------------------------------
# Tool 2: yfinance_collect
# ---------------------------------------------------------------------------

def _build_yfinance_ticker(symbol: str):
    """Build default yfinance Ticker."""
    import yfinance as yf
    return yf.Ticker(symbol)


def yfinance_collect(
    symbol: str,
    out_dir: str,
    period: str = "5y",
    *,
    _client=None,
) -> dict:
    """Fetch financials and price history for a US equity via yfinance.

    Args:
        symbol: US ticker, e.g. 'AAPL'.
        out_dir: Absolute output directory.
        period: Price history period (default '5y').
        _client: Injected yfinance Ticker-like object for testing.

    Returns:
        Result dict with ok, paths, summary or error fields.
    """
    try:
        os.makedirs(out_dir, exist_ok=True)
        ticker = _client or _build_yfinance_ticker(symbol)
        paths: list[str] = []
        summary: dict = {"symbol": symbol.upper()}

        # Income statement (annual)
        df_income = ticker.financials
        if df_income is None:
            df_income = pd.DataFrame()
        elif not df_income.empty:
            df_income = df_income.T.reset_index()
            df_income.rename(columns={"index": "period"}, inplace=True)
        p = Path(out_dir) / "income_annual.csv"
        df_income.to_csv(p, index=False)
        paths.append("income_annual.csv")
        summary["income_rows"] = len(df_income)

        # Balance sheet (annual)
        df_balance = ticker.balance_sheet
        if df_balance is None:
            df_balance = pd.DataFrame()
        elif not df_balance.empty:
            df_balance = df_balance.T.reset_index()
            df_balance.rename(columns={"index": "period"}, inplace=True)
        p = Path(out_dir) / "balance_annual.csv"
        df_balance.to_csv(p, index=False)
        paths.append("balance_annual.csv")
        summary["balance_rows"] = len(df_balance)

        # Cash flow (annual)
        df_cashflow = ticker.cashflow
        if df_cashflow is None:
            df_cashflow = pd.DataFrame()
        elif not df_cashflow.empty:
            df_cashflow = df_cashflow.T.reset_index()
            df_cashflow.rename(columns={"index": "period"}, inplace=True)
        p = Path(out_dir) / "cashflow_annual.csv"
        df_cashflow.to_csv(p, index=False)
        paths.append("cashflow_annual.csv")
        summary["cashflow_rows"] = len(df_cashflow)

        # Price history
        df_hist = ticker.history(period=period)
        if df_hist is None:
            df_hist = pd.DataFrame()
        elif not df_hist.empty:
            df_hist = df_hist.reset_index()
        p = Path(out_dir) / "history.csv"
        df_hist.to_csv(p, index=False)
        paths.append("history.csv")
        summary["history_rows"] = len(df_hist)

        return ok(paths=paths, summary=summary)
    except Exception as e:
        return fail(error=f"yfinance_collect failed: {e}", retryable=True)
