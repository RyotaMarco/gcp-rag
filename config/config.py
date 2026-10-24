"""Configuration is evaluated at startup, never requiring secrets during import."""
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
import os
from dotenv import load_dotenv

@dataclass(frozen=True)
class Settings:
    data_dir: Path = Path("data")
    qdrant_url: str = "http://localhost:6333"
    collection_name: str = "gcp_docs_v2"
    embedding_model: str = "intfloat/multilingual-e5-small"
    reranker_model: str = "cross-encoder/mmarco-mMiniLMv2-L12-H384-v1"
    groq_api_key: str = ""
    groq_model: str = "openai/gpt-oss-20b"
    api_plan: str = "free"
    allow_paid_api: bool = False
    max_context_chars: int = 12000
    max_output_tokens: int = 1000
    request_timeout: float = 45.0
    max_history_messages: int = 6
    retrieval_k: int = 5
    min_relevance_score: float = 0.30
    mcp_url: str = "http://localhost:8001/mcp"
    chunk_size: int = 1600
    chunk_overlap: int = 200
    crawl_max_pages: int = 25
    crawl_delay: float = 1.0

    def __post_init__(self):
        if self.api_plan not in {"free", "paid"}:
            raise ValueError("API_PLAN must be free or paid")
        if self.api_plan == "paid" and not self.allow_paid_api:
            raise ValueError("Set ALLOW_PAID_API=true to explicitly enable API_PLAN=paid")
        if not 0 <= self.min_relevance_score <= 1:
            raise ValueError("MIN_RELEVANCE_SCORE must be between 0 and 1")
        if not 0 <= self.chunk_overlap < self.chunk_size:
            raise ValueError("CHUNK_OVERLAP must be smaller than CHUNK_SIZE")
        for name in ("max_context_chars", "max_output_tokens", "request_timeout", "max_history_messages", "retrieval_k", "crawl_max_pages"):
            if getattr(self, name) <= 0:
                raise ValueError(f"{name} must be positive")
        if self.crawl_delay < 0:
            raise ValueError("CRAWL_DELAY must be nonnegative")

@lru_cache
def get_settings() -> Settings:
    load_dotenv()
    defaults = Settings()
    values = {}
    for name in defaults.__dataclass_fields__:
        raw = os.getenv(name.upper())
        if raw is None:
            continue
        default = getattr(defaults, name)
        if isinstance(default, bool):
            if raw.lower() not in {"true", "false"}:
                raise ValueError(f"{name.upper()} must be true or false")
            values[name] = raw.lower() == "true"
        elif isinstance(default, Path):
            values[name] = Path(raw)
        else:
            values[name] = type(default)(raw)
    return Settings(**values)
