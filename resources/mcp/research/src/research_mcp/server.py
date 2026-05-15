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
    ]

@app.call_tool()
async def call_tool(name: str, arguments: dict) -> list[types.TextContent]:
    if name == "check_env":
        result = check_env()
    else:
        result = {"ok": False, "error": f"unknown tool: {name}", "retryable": False}
    return [types.TextContent(type="text", text=json.dumps(result, ensure_ascii=False))]

async def main():
    async with stdio_server() as (r, w):
        await app.run(r, w, app.create_initialization_options())

def run():
    asyncio.run(main())
