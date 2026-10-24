"""A genuine MCP Streamable HTTP server backed exclusively by fictional data."""
from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations
from starlette.responses import JSONResponse
from demo_mcp.fixtures import BUCKETS, DATASETS, PROJECT, VMS

mcp = FastMCP("GCP demonstration (fictional resources)", host="0.0.0.0", port=8001,
              stateless_http=True, json_response=True)
READ_ONLY = ToolAnnotations(readOnlyHint=True, destructiveHint=False, idempotentHint=True, openWorldHint=False)

def envelope(value):
    return {"simulated": True, "project": PROJECT, "data": value}

@mcp.tool(annotations=READ_ONLY)
def list_buckets() -> dict:
    """List fictional GCP Storage buckets, including simulated public access."""
    return envelope(BUCKETS)

@mcp.tool(annotations=READ_ONLY)
def list_vms() -> dict:
    """List fictional Compute Engine instances and their statuses."""
    return envelope(VMS)

@mcp.tool(annotations=READ_ONLY)
def list_datasets() -> dict:
    """List fictional BigQuery datasets and their table names."""
    return envelope(DATASETS)

@mcp.tool(annotations=READ_ONLY)
def check_bucket_access(bucket: str) -> dict:
    """Check public access on a fictional bucket; never connects to GCP."""
    found = next((b for b in BUCKETS if b["name"] == bucket), None)
    return envelope({"bucket": bucket, "exists": found is not None, "public": found["public"] if found else None})

@mcp.tool(annotations=READ_ONLY)
def check_table(dataset: str, table: str) -> dict:
    """Check whether a table exists in the fictional BigQuery dataset."""
    found = next((d for d in DATASETS if d["name"] == dataset), None)
    return envelope({"dataset": dataset, "table": table, "exists": bool(found and table in found["tables"])})

@mcp.custom_route("/health", methods=["GET"])
async def health(request):
    return JSONResponse({"status": "ok", "simulated": True})

if __name__ == "__main__":
    mcp.run(transport="streamable-http")
