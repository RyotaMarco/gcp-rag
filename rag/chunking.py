"""Header-aware Markdown splitting without discarding lists or code."""
from hashlib import sha256
import re
from uuid import NAMESPACE_URL, uuid5
from config.config import Settings, get_settings
from rag.models import Document


class Chunker:
    def __init__(self, settings: Settings | None = None):
        self.settings = settings or get_settings()

    def chunk(self, content: str, metadata: dict | None = None) -> list[Document]:
        metadata = dict(metadata or {})
        sections, lines, headers = [], [], {}
        fenced = False
        for line in content.splitlines(keepends=True):
            if line.lstrip().startswith(("```", "~~~")):
                fenced = not fenced
            match = re.match(r"^(#{1,6})\s+(.+?)\s*$", line) if not fenced else None
            if match:
                if "".join(lines).strip():
                    sections.append((" > ".join(headers.values()), "".join(lines)))
                level = len(match.group(1))
                headers = {key: value for key, value in headers.items() if key < level}
                headers[level] = match.group(2)
                lines = [line]
            else:
                lines.append(line)
        if "".join(lines).strip():
            sections.append((" > ".join(headers.values()), "".join(lines)))
        documents = []
        for section, text in sections:
            offset = 0
            while offset < len(text):
                end = min(offset + self.settings.chunk_size, len(text))
                if end < len(text):
                    boundary = text.rfind("\n", offset + self.settings.chunk_size // 2, end)
                    if boundary > offset:
                        end = boundary + 1
                body = text[offset:end].strip()
                if body:
                    info = {**metadata, "section": section, "chunk_index": len(documents)}
                    digest = sha256(body.encode("utf-8")).hexdigest()
                    identity = f"{info.get('source_url', '')}:{section}:{len(documents)}:{digest}"
                    documents.append(Document(body, info, str(uuid5(NAMESPACE_URL, identity))))
                if end >= len(text):
                    break
                offset = max(offset + 1, end - self.settings.chunk_overlap)
        return documents
