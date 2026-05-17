"""Data collection tools for A-share and US equity research.

Testing pattern: Dependency Injection (DI) via `_client` parameter.
Each tool accepts an optional `_client` kwarg. In production it defaults to
the real API client (tushare/yfinance/akshare); in tests a fake client is
injected that returns small fixture DataFrames. This avoids all network calls
in pytest while keeping the file-writing logic fully exercised.
"""
from __future__ import annotations

import os
import re
import sys
import time
import traceback
from pathlib import Path

# Module-load instrumentation — diagnose slow lazy import on first tool call.
_modload_t0 = time.monotonic()
try:
    print(f"[trace] data_collect MODULE_LOAD start", file=sys.stderr, flush=True)
except Exception:
    pass

_t = time.monotonic()
import pandas as pd
try:
    print(f"[trace] data_collect MODULE_LOAD import pandas elapsed={time.monotonic() - _t:.2f}s", file=sys.stderr, flush=True)
except Exception:
    pass

_t = time.monotonic()
from research_mcp.lib.result import ok, fail
try:
    print(f"[trace] data_collect MODULE_LOAD import result elapsed={time.monotonic() - _t:.2f}s total={time.monotonic() - _modload_t0:.2f}s", file=sys.stderr, flush=True)
except Exception:
    pass


# ---------------------------------------------------------------------------
# Observability — emit trace lines on stderr so the host (Electron MCP client)
# captures them as `DEBUG [stderr] [trace] ...` log entries. This is the only
# way to see what tushare/yfinance/akshare are actually doing during a hang.
# ---------------------------------------------------------------------------


def _trace(tag: str, msg: str) -> None:
    """Emit a single stderr trace line. Flushed immediately so the host sees it
    even when the call is still blocked on a network read."""
    try:
        print(f"[trace] {tag} {msg}", file=sys.stderr, flush=True)
    except Exception:
        # Never let logging crash a tool.
        pass


def _timed_call(tag: str, label: str, fn, **kwargs):
    """Call `fn(**kwargs)`, logging start, finish-with-rowcount, and exception."""
    _trace(tag, f">>> {label} kwargs={kwargs}")
    t0 = time.monotonic()
    try:
        result = fn(**kwargs)
        elapsed = time.monotonic() - t0
        rows = "?"
        try:
            if result is None:
                rows = "None"
            elif hasattr(result, "__len__"):
                rows = str(len(result))
        except Exception:
            pass
        _trace(tag, f"<<< {label} rows={rows} elapsed={elapsed:.2f}s")
        return result
    except Exception as e:
        elapsed = time.monotonic() - t0
        _trace(tag, f"!!! {label} EXC after {elapsed:.2f}s: {type(e).__name__}: {e}")
        _trace(tag, traceback.format_exc())
        raise


# ---------------------------------------------------------------------------
# Shared validators
# ---------------------------------------------------------------------------

_A_SHARE_CODE_RE = re.compile(r"^\d{6}\.(SH|SZ|BJ)$", re.IGNORECASE)


def _is_a_share_code(code: str) -> bool:
    """Return True if `code` is a Tushare A-share ticker (e.g. 600036.SH)."""
    return bool(isinstance(code, str) and _A_SHARE_CODE_RE.match(code))


def _a_share_routing_hint(code: str) -> str:
    """Return a hint string suggesting which tool to use for a non-A-share code."""
    if isinstance(code, str) and code.upper().endswith(".HK"):
        return "For HK stocks use yfinance_collect with the .HK ticker (e.g. 09988.HK)."
    return (
        "For HK stocks use yfinance_collect with .HK suffix (e.g. 09988.HK); "
        "for US stocks use yfinance_collect with the bare symbol (e.g. AAPL)."
    )


# ---------------------------------------------------------------------------
# Tool 1: tushare_collect
# ---------------------------------------------------------------------------

def _build_tushare_client():
    """Build default tushare pro_api client from env."""
    t0 = time.monotonic()
    try:
        print(f"[trace] _build_tushare_client >>> import tushare", file=sys.stderr, flush=True)
    except Exception:
        pass
    import tushare as ts
    t1 = time.monotonic()
    try:
        print(f"[trace] _build_tushare_client <<< import tushare elapsed={t1 - t0:.2f}s", file=sys.stderr, flush=True)
    except Exception:
        pass
    token = os.environ.get("TUSHARE_TOKEN", "")
    if not token:
        raise RuntimeError("TUSHARE_TOKEN not set")
    ts.set_token(token)
    try:
        print(f"[trace] _build_tushare_client >>> ts.pro_api()", file=sys.stderr, flush=True)
    except Exception:
        pass
    client = ts.pro_api()
    t2 = time.monotonic()
    try:
        print(f"[trace] _build_tushare_client <<< ts.pro_api() elapsed={t2 - t1:.2f}s total={t2 - t0:.2f}s", file=sys.stderr, flush=True)
    except Exception:
        pass
    return client


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
    if not _is_a_share_code(ts_code):
        return fail(
            error=(
                f"tushare_collect only supports A-share codes "
                f"(e.g. 600036.SH, 000001.SZ, 832000.BJ). Got '{ts_code}'. "
                + _a_share_routing_hint(ts_code)
            ),
            retryable=False,
        )
    tag = f"tushare_collect[{ts_code}]"
    t_total = time.monotonic()
    _trace(tag, f"START out_dir={out_dir!r} start_date={start_date!r}")
    try:
        os.makedirs(out_dir, exist_ok=True)
        client = _client or _build_tushare_client()
        sd = start_date or "20200101"

        paths: list[str] = []
        summary: dict = {"ts_code": ts_code}

        # Income statement
        df_income = _timed_call(tag, "client.income", client.income, ts_code=ts_code, start_date=sd)
        if df_income is None:
            df_income = pd.DataFrame()
        p = Path(out_dir) / "income.csv"
        df_income.to_csv(p, index=False)
        paths.append("income.csv")
        summary["income_rows"] = len(df_income)

        # Balance sheet
        df_balance = _timed_call(tag, "client.balancesheet", client.balancesheet, ts_code=ts_code, start_date=sd)
        if df_balance is None:
            df_balance = pd.DataFrame()
        p = Path(out_dir) / "balancesheet.csv"
        df_balance.to_csv(p, index=False)
        paths.append("balancesheet.csv")
        summary["balance_rows"] = len(df_balance)

        # Cash flow
        df_cashflow = _timed_call(tag, "client.cashflow", client.cashflow, ts_code=ts_code, start_date=sd)
        if df_cashflow is None:
            df_cashflow = pd.DataFrame()
        p = Path(out_dir) / "cashflow.csv"
        df_cashflow.to_csv(p, index=False)
        paths.append("cashflow.csv")
        summary["cashflow_rows"] = len(df_cashflow)

        _trace(tag, f"DONE ok total_elapsed={time.monotonic() - t_total:.2f}s summary={summary}")
        return ok(paths=paths, summary=summary)
    except Exception as e:
        _trace(tag, f"FAIL after {time.monotonic() - t_total:.2f}s: {type(e).__name__}: {e}")
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


# ---------------------------------------------------------------------------
# Tool 3: peer_collect
# ---------------------------------------------------------------------------

def _build_peer_client():
    """Build default tushare pro_api client for peer collection."""
    return _build_tushare_client()


def peer_collect(
    ts_code: str,
    peer_codes: list[str],
    out_dir: str,
    *,
    _client=None,
) -> dict:
    """Fetch peer comparison data for a list of A-share tickers.

    Simplified vs source: accepts explicit peer_codes list instead of
    re-implementing industry classification lookups. The caller (LLM agent)
    provides peer tickers directly.

    Args:
        ts_code: Target ticker for context, e.g. '600036.SH'.
        peer_codes: List of peer tickers to compare, e.g. ['601166.SH', '000001.SZ'].
        out_dir: Absolute output directory.
        _client: Injected tushare pro_api instance for testing.

    Returns:
        Result dict with ok, paths, summary or error fields.
    """
    invalid = [c for c in [ts_code, *peer_codes] if not _is_a_share_code(c)]
    if invalid:
        return fail(
            error=(
                f"peer_collect only supports A-share codes "
                f"(e.g. 600036.SH). Invalid: {invalid}. "
                + _a_share_routing_hint(invalid[0])
            ),
            retryable=False,
        )
    tag = f"peer_collect[{ts_code}+{len(peer_codes)}peers]"
    t_total = time.monotonic()
    _trace(tag, f"START peers={peer_codes} out_dir={out_dir!r}")
    try:
        os.makedirs(out_dir, exist_ok=True)
        client = _client or _build_peer_client()
        all_codes = [ts_code] + peer_codes
        paths: list[str] = []
        summary: dict = {"target": ts_code, "peers": peer_codes}

        # Fetch daily_basic (valuation) for each code
        rows = []
        for code in all_codes:
            df = _timed_call(tag, f"client.daily_basic({code})", client.daily_basic, ts_code=code)
            if df is not None and not df.empty:
                row = df.iloc[0].to_dict()
                row["ts_code"] = code
                rows.append(row)

        df_valuation = pd.DataFrame(rows)
        p = Path(out_dir) / "peer_valuation.csv"
        df_valuation.to_csv(p, index=False)
        paths.append("peer_valuation.csv")
        summary["valuation_rows"] = len(df_valuation)

        # Fetch fina_indicator for each code
        fina_rows = []
        for code in all_codes:
            df = _timed_call(tag, f"client.fina_indicator({code})", client.fina_indicator, ts_code=code)
            if df is not None and not df.empty:
                row = df.iloc[0].to_dict()
                row["ts_code"] = code
                fina_rows.append(row)

        df_fina = pd.DataFrame(fina_rows)
        p = Path(out_dir) / "peer_financials.csv"
        df_fina.to_csv(p, index=False)
        paths.append("peer_financials.csv")
        summary["financials_rows"] = len(df_fina)

        _trace(tag, f"DONE ok total_elapsed={time.monotonic() - t_total:.2f}s summary={summary}")
        return ok(paths=paths, summary=summary)
    except Exception as e:
        _trace(tag, f"FAIL after {time.monotonic() - t_total:.2f}s: {type(e).__name__}: {e}")
        return fail(error=f"peer_collect failed: {e}", retryable=True)


# ---------------------------------------------------------------------------
# Tool 4: capital_flow
# ---------------------------------------------------------------------------

def _build_akshare_module():
    """Return the akshare module."""
    import akshare as ak
    return ak


def capital_flow(
    symbol: str,
    out_dir: str,
    *,
    _client=None,
) -> dict:
    """Fetch capital flow data for an A-share ticker via akshare (no token needed).

    Fetches individual stock fund flow (main force net inflow) and market-wide
    fund flow ranking data.

    Args:
        symbol: A-share ticker code (digits only, e.g. '600036' or with suffix '600036.SH').
        out_dir: Absolute output directory.
        _client: Injected akshare-like module for testing.

    Returns:
        Result dict with ok, paths, summary or error fields.
    """
    # Accept either bare 6-digit A-share code or full Tushare-style code.
    bare_code = symbol.split(".")[0] if isinstance(symbol, str) else ""
    if not (isinstance(symbol, str) and re.match(r"^\d{6}$", bare_code)
            and ("." not in symbol or _is_a_share_code(symbol))):
        return fail(
            error=(
                f"capital_flow only supports A-share codes "
                f"(e.g. 600036, 600036.SH, 000001.SZ). Got '{symbol}'. "
                + _a_share_routing_hint(symbol)
            ),
            retryable=False,
        )
    tag = f"capital_flow[{symbol}]"
    t_total = time.monotonic()
    _trace(tag, f"START out_dir={out_dir!r}")
    try:
        os.makedirs(out_dir, exist_ok=True)
        ak = _client or _build_akshare_module()
        paths: list[str] = []
        summary: dict = {"symbol": symbol}

        # Individual stock fund flow
        market = "sh" if bare_code.startswith("6") else "sz"
        df_flow = _timed_call(
            tag,
            f"ak.stock_individual_fund_flow(stock={bare_code},market={market})",
            ak.stock_individual_fund_flow,
            stock=bare_code,
            market=market,
        )
        if df_flow is None:
            df_flow = pd.DataFrame()
        p = Path(out_dir) / "individual_fund_flow.csv"
        df_flow.to_csv(p, index=False)
        paths.append("individual_fund_flow.csv")
        summary["flow_rows"] = len(df_flow)

        # Fund flow ranking (market-wide, latest day)
        df_rank = _timed_call(
            tag,
            "ak.stock_individual_fund_flow_rank(indicator=today)",
            ak.stock_individual_fund_flow_rank,
            indicator="today",
        )
        if df_rank is None:
            df_rank = pd.DataFrame()
        p = Path(out_dir) / "fund_flow_rank.csv"
        df_rank.to_csv(p, index=False)
        paths.append("fund_flow_rank.csv")
        summary["rank_rows"] = len(df_rank)

        _trace(tag, f"DONE ok total_elapsed={time.monotonic() - t_total:.2f}s summary={summary}")
        return ok(paths=paths, summary=summary)
    except Exception as e:
        _trace(tag, f"FAIL after {time.monotonic() - t_total:.2f}s: {type(e).__name__}: {e}")
        return fail(error=f"capital_flow failed: {e}", retryable=False)
