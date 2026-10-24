"""Bounded MCP client: tools are allowlisted and inputs never choose a host."""
import asyncio
import json
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
import httpx
from config.config import Settings, get_settings
from rag.errors import AssistantError

TOOLS = {"list_buckets", "list_vms", "list_datasets", "check_bucket_access", "check_table"}

class DemoClient:
    def __init__(self, settings: Settings | None = None):
        self.settings = settings or get_settings()

    async def call(self, tool: str, arguments: dict | None = None) -> dict:
        if tool not in TOOLS:
            raise AssistantError("invalid_tool", "Ferramenta não permitida.", 400)
        try:
            async with asyncio.timeout(min(self.settings.request_timeout, 15)):
                async with streamable_http_client(self.settings.mcp_url) as (read, write, _):
                    async with ClientSession(read, write) as session:
                        await session.initialize()
                        result = await session.call_tool(tool, arguments or {})
                        if result.isError:
                            raise ValueError("MCP tool returned an error")
                        value = result.structuredContent
                        if value is None:
                            value = json.loads(next(c.text for c in result.content if c.type == "text"))
                        if value.get("simulated") is not True or "data" not in value:
                            raise ValueError("Unexpected demo response")
                        return value
        except Exception as exc:
            raise AssistantError("mcp_unavailable", "A demonstração MCP está indisponível. Verifique o serviço mcp.") from exc

    async def healthy(self) -> bool:
        base = self.settings.mcp_url.rsplit("/", 1)[0]
        try:
            async with httpx.AsyncClient(timeout=2) as client:
                response = await client.get(base + "/health")
                return response.status_code == 200 and response.json().get("simulated") is True
        except (httpx.HTTPError, ValueError):
            return False
