from dataclasses import dataclass, field
from typing import Any

@dataclass
class Document:
    page_content: str
    metadata: dict[str, Any] = field(default_factory=dict)
    id: str = ""
    score: float = 0.0
