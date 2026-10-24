"""Exercise a real MCP HTTP handshake and tool result; no cloud or LLM API."""
import os
import subprocess
import sys
import time
import httpx
import pytest
from config.config import Settings
from demo_mcp.client import DemoClient

@pytest.fixture(scope="module")
def mcp_process():
    process = subprocess.Popen([sys.executable, "-m", "demo_mcp.server"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(100):
            if process.poll() is not None:
                pytest.fail("MCP server exited during startup")
            try:
                if httpx.get("http://localhost:8001/health", timeout=0.5).status_code == 200:
                    break
            except httpx.HTTPError:
                pass
            time.sleep(0.1)
        else:
            pytest.fail("MCP server did not start")
        yield
    finally:
        process.terminate()
        process.wait(timeout=15)

@pytest.mark.asyncio
async def test_real_mcp_protocol(mcp_process):
    demo = DemoClient(Settings())
    assert await demo.healthy()
    buckets = await demo.call("list_buckets")
    assert buckets["simulated"] is True
    assert buckets["data"][0]["name"] == "demo-documents-private"
    table = await demo.call("check_table", {"dataset": "demo_analytics", "table": "events"})
    assert table["data"]["exists"] is True
    missing = await demo.call("check_table", {"dataset": "demo_analytics", "table": "absent"})
    assert missing["data"]["exists"] is False
