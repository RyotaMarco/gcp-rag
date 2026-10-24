"""HTTP smoke assertions for a disposable Compose stack, without a Groq key.

Used by CI before ingest, after ingest, and after a full restart. Deliberately
does not substitute a fake provider and claim real Groq validation.
"""
import argparse
import json
from pathlib import Path
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def request(base, path, payload=None):
    body = json.dumps(payload).encode() if payload is not None else None
    req = Request(base.rstrip("/") + path, data=body, headers={"Content-Type": "application/json"} if body else {})
    try:
        with urlopen(req, timeout=180) as response:
            status, raw = response.status, response.read().decode()
    except HTTPError as error:
        status, raw = error.code, error.read().decode()
    try:
        return status, json.loads(raw)
    except json.JSONDecodeError:
        return status, raw


def wait_live(base):
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        try:
            status, data = request(base, "/api/health/live")
            if status == 200 and data == {"status": "ok"}:
                return
        except (URLError, OSError):
            pass
        time.sleep(2)
    raise RuntimeError("API liveness did not become healthy")


def wait_dependencies(base):
    deadline = time.monotonic() + 180
    last = None
    while time.monotonic() < deadline:
        status, readiness = request(base, "/api/health/ready")
        last = (status, readiness)
        if isinstance(readiness, dict):
            checks = readiness.get("checks", {})
            if checks.get("qdrant") and checks.get("mcp"):
                return status, readiness
        time.sleep(2)
    raise RuntimeError(f"Dependencies did not become available: {last}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8080")
    parser.add_argument("--phase", required=True, choices=["empty", "indexed", "restarted"])
    parser.add_argument("--state", type=Path, default=Path("compose-smoke-state.json"))
    args = parser.parse_args()
    wait_live(args.base_url)
    status, html = request(args.base_url, "/")
    assert status == 200 and isinstance(html, str) and 'id="root"' in html
    status, readiness = wait_dependencies(args.base_url)
    # No provider key is configured in this job, so full readiness must be false.
    assert status == 503, readiness
    assert readiness["checks"]["provider_configured"] is False, readiness
    assert readiness["checks"]["qdrant"] is True, readiness
    assert readiness["checks"]["mcp"] is True, readiness
    count = readiness["indexed_chunks"]
    if args.phase == "empty":
        assert count == 0 and readiness["checks"]["index"] is False, readiness
    else:
        assert count >= 15 and readiness["checks"]["index"] is True, readiness
    if args.phase == "indexed":
        args.state.write_text(json.dumps({"indexed_chunks": count}), encoding="utf-8")
    if args.phase == "restarted":
        previous = json.loads(args.state.read_text(encoding="utf-8"))
        assert count == previous["indexed_chunks"], (previous, readiness)
    for question in ("Liste os buckets do projeto demo.", "List the virtual machines in the demo project.", "Liste os datasets do BigQuery no projeto demo."):
        status, answer = request(args.base_url, "/api/ask/", {"question": question})
        assert status == 200, answer
        assert answer["mode"] == "mcp" and answer["simulated"] is True, answer
        assert answer["sources"] == [], answer
        assert "```json" in answer["answer"], answer
    status, invalid = request(args.base_url, "/api/ask/", {"question": " "})
    assert status == 422, invalid
    print(json.dumps({"phase": args.phase, "indexed_chunks": count, "checks": readiness["checks"], "mcp_queries": 3, "status": "passed"}, indent=2))


if __name__ == "__main__":
    main()
