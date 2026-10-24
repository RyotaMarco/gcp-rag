"""Atomic, content-addressed document storage on a persistent filesystem."""
from datetime import datetime, timezone
from hashlib import sha256
import json
import os
from pathlib import Path
import tempfile
from urllib.parse import urlsplit, urlunsplit
from config.config import Settings, get_settings

ALLOWED_DOC_HOSTS = {"cloud.google.com", "docs.cloud.google.com", "ai.google.dev"}


def canonical_url(url: str) -> str:
    parts = urlsplit(url)
    if parts.scheme != "https" or parts.hostname not in ALLOWED_DOC_HOSTS or parts.username or parts.password or parts.port not in {None, 443}:
        raise ValueError("Document sources must be HTTPS URLs on official Google documentation domains")
    return urlunsplit(("https", parts.hostname, parts.path.rstrip("/") or "/", "", ""))


def atomic_json(path: Path, value: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=".tmp-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


class DocumentStorage:
    def __init__(self, settings: Settings | None = None):
        self.settings = settings or get_settings()
        self.raw_dir = self.settings.data_dir / "raw"

    def save(self, content: str, metadata: dict) -> Path:
        if not content.strip():
            raise ValueError("Cannot store an empty document")
        metadata = dict(metadata)
        metadata["source_url"] = canonical_url(metadata["source_url"])
        metadata.setdefault("crawled_at", datetime.now(timezone.utc).isoformat())
        metadata.setdefault("title", metadata.get("product", "Google Cloud documentation"))
        path = self.raw_dir / (sha256(metadata["source_url"].encode()).hexdigest() + ".json")
        atomic_json(path, {"content": content, "metadata": metadata})
        return path

    def documents(self, directory: Path | None = None, on_error=None):
        root = directory or self.raw_dir
        for path in sorted(root.glob("*.json")):
            try:
                value = json.loads(path.read_text(encoding="utf-8-sig"))
                if not isinstance(value, dict) or not isinstance(value.get("content"), str) or not isinstance(value.get("metadata"), dict):
                    raise ValueError(f"Invalid document file: {path.name}")
                value["metadata"]["source_url"] = canonical_url(value["metadata"]["source_url"])
                yield value
            except (OSError, ValueError, KeyError, TypeError) as error:
                if on_error is None:
                    raise ValueError(f"Invalid document file: {path.name}") from error
                on_error(path, error)


# Compatibility name for callers migrating from the original S3 implementation.
BucketStorage = DocumentStorage
