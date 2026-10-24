"""Repeatable ingestion from local raw JSON documents into Qdrant."""
import logging
from config.config import Settings, get_settings
from rag.chunking import Chunker
from rag.indexer import Indexer
from storage.bucket_storage import DocumentStorage

logger = logging.getLogger(__name__)


class Ingestion:
    def __init__(self, settings: Settings | None = None, client=None, embedding=None):
        self.settings = settings or get_settings()
        self.storage = DocumentStorage(self.settings)
        self.chunker = Chunker(self.settings)
        self.indexer = Indexer(self.settings, client=client, embedding=embedding)

    def run(self, rebuild: bool = False) -> dict:
        self.indexer.prepare(rebuild=rebuild)
        summary = {"updated": 0, "unchanged": 0, "failed": 0, "chunks": 0}
        def invalid_document(path, error):
            summary["failed"] += 1
            logger.error("Skipping invalid raw document %s: %s", path.name, error)
        for source in self.storage.documents(on_error=invalid_document):
            try:
                documents = self.chunker.chunk(source["content"], source["metadata"])
                result = self.indexer.upsert_source(documents)
                summary[result["status"]] += 1
                summary["chunks"] += result["chunks"]
            except Exception:
                summary["failed"] += 1
                logger.exception("Failed to index %s", source["metadata"].get("source_url", "unknown"))
        return summary
