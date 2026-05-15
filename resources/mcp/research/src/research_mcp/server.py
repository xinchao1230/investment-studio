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
    else:
        result = {"ok": False, "error": f"unknown tool: {name}", "retryable": False}
    return [types.TextContent(type="text", text=json.dumps(result, ensure_ascii=False))]

async def main():
    async with stdio_server() as (r, w):
        await app.run(r, w, app.create_initialization_options())

def run():
    asyncio.run(main())
