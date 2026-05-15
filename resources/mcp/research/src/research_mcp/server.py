import asyncio
import json
from mcp.server import Server
from mcp.server.stdio import stdio_server
import mcp.types as types
from .tools.env import check_env

app = Server("research-mcp")

@app.list_tools()
async def list_tools() -> list[types.Tool]:
    return [
        types.Tool(
            name="check_env",
            description="Check research-mcp environment readiness (tushare token, python version)",
            inputSchema={"type": "object", "properties": {}},
        ),
        types.Tool(
            name="tushare_collect",
            description="Fetch annual/quarterly financials for an A-share ticker via Tushare and dump to CSV in out_dir.",
            inputSchema={
                "type": "object",
                "properties": {
                    "ts_code": {"type": "string", "description": "Tushare ticker, e.g. 600036.SH"},
                    "out_dir": {"type": "string", "description": "Absolute output directory"},
                    "start_date": {"type": "string", "description": "YYYYMMDD, optional", "default": ""},
                },
                "required": ["ts_code", "out_dir"],
            },
        ),
        types.Tool(
            name="yfinance_collect",
            description="Fetch financials and price history for a US equity via yfinance and dump to CSV in out_dir.",
            inputSchema={
                "type": "object",
                "properties": {
                    "symbol": {"type": "string", "description": "US ticker, e.g. AAPL"},
                    "out_dir": {"type": "string", "description": "Absolute output directory"},
                    "period": {"type": "string", "description": "Price history period, e.g. 5y", "default": "5y"},
                },
                "required": ["symbol", "out_dir"],
            },
        ),
        types.Tool(
            name="peer_collect",
            description="Fetch peer comparison data (valuation + financials) for a list of A-share tickers via Tushare.",
            inputSchema={
                "type": "object",
                "properties": {
                    "ts_code": {"type": "string", "description": "Target ticker, e.g. 600036.SH"},
                    "peer_codes": {"type": "array", "items": {"type": "string"}, "description": "List of peer tickers"},
                    "out_dir": {"type": "string", "description": "Absolute output directory"},
                },
                "required": ["ts_code", "peer_codes", "out_dir"],
            },
        ),
        types.Tool(
            name="capital_flow",
            description="Fetch capital flow data for an A-share ticker via akshare (no token needed).",
            inputSchema={
                "type": "object",
                "properties": {
                    "symbol": {"type": "string", "description": "A-share ticker, e.g. 600036 or 600036.SH"},
                    "out_dir": {"type": "string", "description": "Absolute output directory"},
                },
                "required": ["symbol", "out_dir"],
            },
        ),
        types.Tool(
            name="pdf_download_extract",
            description="Download a PDF from a URL and extract text and tables to out_dir.",
            inputSchema={
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "HTTP(S) URL of the PDF file"},
                    "out_dir": {"type": "string", "description": "Absolute output directory"},
                },
                "required": ["url", "out_dir"],
            },
        ),
        types.Tool(
            name="derived_metrics",
            description="Compute derived financial ratios (margins, ROE, ROA, FCF, growth) from income/balance/cashflow CSVs.",
            inputSchema={
                "type": "object",
                "properties": {
                    "income_csv": {"type": "string", "description": "Path to income statement CSV"},
                    "balance_csv": {"type": "string", "description": "Path to balance sheet CSV"},
                    "cashflow_csv": {"type": "string", "description": "Path to cashflow CSV"},
                    "out_dir": {"type": "string", "description": "Absolute output directory"},
                },
                "required": ["income_csv", "balance_csv", "cashflow_csv", "out_dir"],
            },
        ),
        types.Tool(
            name="financial_audit_11",
            description="Run an 11-checkpoint financial-quality audit (Piotroski-inspired) on income/balance/cashflow CSVs.",
            inputSchema={
                "type": "object",
                "properties": {
                    "income_csv": {"type": "string", "description": "Path to income statement CSV"},
                    "balance_csv": {"type": "string", "description": "Path to balance sheet CSV"},
                    "cashflow_csv": {"type": "string", "description": "Path to cashflow CSV"},
                    "out_dir": {"type": "string", "description": "Absolute output directory"},
                },
                "required": ["income_csv", "balance_csv", "cashflow_csv", "out_dir"],
            },
        ),
        types.Tool(
            name="technical_analysis",
            description="Compute technical indicators (SMA, EMA, RSI, MACD, Bollinger, volatility) from daily price CSV.",
            inputSchema={
                "type": "object",
                "properties": {
                    "daily_csv": {"type": "string", "description": "Path to daily price CSV"},
                    "out_dir": {"type": "string", "description": "Absolute output directory"},
                },
                "required": ["daily_csv", "out_dir"],
            },
        ),
        types.Tool(
            name="data_snapshot",
            description="Bundle multiple source files into a unified JSON snapshot for downstream reporting.",
            inputSchema={
                "type": "object",
                "properties": {
                    "out_dir": {"type": "string", "description": "Absolute output directory"},
                    "sources": {"type": "object", "description": "Mapping of key -> file path to bundle", "default": {}},
                },
                "required": ["out_dir"],
            },
        ),
    ]

@app.call_tool()
async def call_tool(name: str, arguments: dict) -> list[types.TextContent]:
    if name == "check_env":
        result = check_env()
    elif name == "tushare_collect":
        from .tools.data_collect import tushare_collect
        result = tushare_collect(
            ts_code=arguments["ts_code"],
            out_dir=arguments["out_dir"],
            start_date=arguments.get("start_date", ""),
        )
    elif name == "yfinance_collect":
        from .tools.data_collect import yfinance_collect
        result = yfinance_collect(
            symbol=arguments["symbol"],
            out_dir=arguments["out_dir"],
            period=arguments.get("period", "5y"),
        )
    elif name == "peer_collect":
        from .tools.data_collect import peer_collect
        result = peer_collect(
            ts_code=arguments["ts_code"],
            peer_codes=arguments["peer_codes"],
            out_dir=arguments["out_dir"],
        )
    elif name == "capital_flow":
        from .tools.data_collect import capital_flow
        result = capital_flow(
            symbol=arguments["symbol"],
            out_dir=arguments["out_dir"],
        )
    elif name == "pdf_download_extract":
        from .tools.pdf import pdf_download_extract
        result = pdf_download_extract(
            url=arguments["url"],
            out_dir=arguments["out_dir"],
        )
    elif name == "derived_metrics":
        from .tools.compute import derived_metrics
        result = derived_metrics(
            income_csv=arguments["income_csv"],
            balance_csv=arguments["balance_csv"],
            cashflow_csv=arguments["cashflow_csv"],
            out_dir=arguments["out_dir"],
        )
    elif name == "financial_audit_11":
        from .tools.compute import financial_audit_11
        result = financial_audit_11(
            income_csv=arguments["income_csv"],
            balance_csv=arguments["balance_csv"],
            cashflow_csv=arguments["cashflow_csv"],
            out_dir=arguments["out_dir"],
        )
    elif name == "technical_analysis":
        from .tools.compute import technical_analysis
        result = technical_analysis(
            daily_csv=arguments["daily_csv"],
            out_dir=arguments["out_dir"],
        )
    elif name == "data_snapshot":
        from .tools.compute import data_snapshot
        result = data_snapshot(
            out_dir=arguments["out_dir"],
            sources=arguments.get("sources"),
        )
    else:
        result = {"ok": False, "error": f"unknown tool: {name}", "retryable": False}
    return [types.TextContent(type="text", text=json.dumps(result, ensure_ascii=False))]

async def main():
    async with stdio_server() as (r, w):
        await app.run(r, w, app.create_initialization_options())

def run():
    asyncio.run(main())
