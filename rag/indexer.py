"""Qdrant indexing with version checks, stable point IDs and safe source updates."""
from hashlib import sha256
import json
import logging
import time
import httpx
from qdrant_client import QdrantClient, models
from qdrant_client.http.exceptions import ResponseHandlingException
from config.config import Settings, get_settings
from rag.embedding import Embedding
from rag.models import Document

INDEX_VERSION = 2
logger = logging.getLogger(__name__)


class IndexCompatibilityError(RuntimeError):
    pass


def create_client(url: str) -> QdrantClient:
    if url == ":memory:":
        return QdrantClient(":memory:")
    if url.startswith("local:"):
        return QdrantClient(path=url.removeprefix("local:"))
    # Compose's service_started does not mean the HTTP listener is ready yet.
    # Use short probes so connection failures cannot stall startup indefinitely.
    probe = QdrantClient(url=url, timeout=1, check_compatibility=False)
    try:
        for attempt in range(10):
            try:
                probe.get_collections()
                break
            except ResponseHandlingException as error:
                if not isinstance(error.source, httpx.TransportError):
                    raise
                if attempt == 9:
                    logger.warning("Qdrant startup probe exhausted; readiness will report unavailable")
                else:
                    time.sleep(1)
    finally:
        probe.close()
    # Leave the API capable of exposing /health/live and actionable /health/ready
    # even when the database is still unavailable after the bounded startup wait.
    return QdrantClient(url=url, timeout=10, check_compatibility=False)


def payload_document(point) -> Document:
    payload = point.payload or {}
    return Document(payload.get("page_content", ""), payload.get("metadata", {}),
                    str(point.id), float(getattr(point, "score", 0.0) or 0.0))


def read_corpus(client, collection: str, max_documents: int = 20000) -> list[Document]:
    result, offset = [], None
    while True:
        points, offset = client.scroll(collection_name=collection, limit=256,
                                       offset=offset, with_payload=True, with_vectors=False)
        result.extend(payload_document(point) for point in points)
        if len(result) > max_documents:
            raise RuntimeError("Local lexical search supports up to 20000 chunks; narrow the documentation corpus")
        if offset is None:
            break
    return result


def index_status(client, settings: Settings) -> dict:
    if not client.collection_exists(settings.collection_name):
        return {"indexed_chunks": 0, "index_ready": False, "index_compatible": True,
                "detail": "Índice vazio. Execute o comando de ingestão."}
    info = client.get_collection(settings.collection_name)
    count = info.points_count or 0
    compatible = True
    if count:
        points, _ = client.scroll(collection_name=settings.collection_name, limit=1,
                                  with_payload=True, with_vectors=False)
        payload = points[0].payload or {}
        vectors = info.config.params.vectors
        compatible = (payload.get("index_version") == INDEX_VERSION
                      and payload.get("embedding_model") == settings.embedding_model
                      and payload.get("embedding_dimension") == getattr(vectors, "size", None))
    return {"indexed_chunks": count, "index_ready": count > 0 and compatible,
            "index_compatible": compatible,
            "detail": "Pronto" if count and compatible else
                      "Índice incompatível. Execute ingest --rebuild." if not compatible else
                      "Índice vazio. Execute o comando de ingestão."}


class Indexer:
    def __init__(self, settings: Settings | None = None, client=None, embedding=None):
        self.settings = settings or get_settings()
        self.client = client if client is not None else create_client(self.settings.qdrant_url)
        self.embedding = embedding if embedding is not None else Embedding(self.settings)

    def prepare(self, rebuild: bool = False):
        exists = self.client.collection_exists(self.settings.collection_name)
        if exists and rebuild:
            self.client.delete_collection(self.settings.collection_name)
            exists = False
        if exists:
            status = index_status(self.client, self.settings)
            if not status["index_compatible"]:
                raise IndexCompatibilityError(status["detail"])
            info = self.client.get_collection(self.settings.collection_name)
            if info.config.params.vectors.size != self.embedding.dimension:
                raise IndexCompatibilityError("Embedding dimensions changed; run ingest --rebuild")
        else:
            self.client.create_collection(collection_name=self.settings.collection_name,
                vectors_config=models.VectorParams(size=self.embedding.dimension, distance=models.Distance.COSINE))

    def upsert_source(self, documents: list[Document]) -> dict:
        if not documents:
            raise ValueError("A source must contain at least one chunk")
        source_url = documents[0].metadata["source_url"]
        if any(doc.metadata.get("source_url") != source_url for doc in documents):
            raise ValueError("upsert_source accepts exactly one source URL")
        source_filter = models.Filter(must=[models.FieldCondition(key="metadata.source_url", match=models.MatchValue(value=source_url))])
        previous, cursor = [], None
        while True:
            points, cursor = self.client.scroll(collection_name=self.settings.collection_name,
                scroll_filter=source_filter, limit=256, offset=cursor, with_payload=True, with_vectors=False)
            previous.extend(points)
            if cursor is None:
                break
        fingerprint = sha256(json.dumps([
            {"text": doc.page_content, "metadata": {key: value for key, value in doc.metadata.items() if key != "crawled_at"}}
            for doc in documents], sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        unchanged = (len(previous) == len(documents) and all((point.payload or {}).get("source_hash") == fingerprint for point in previous))
        if unchanged:
            # Refresh crawl timestamps and metadata without recalculating embeddings.
            by_id = {doc.id: doc for doc in documents}
            for point in previous:
                document = by_id.get(str(point.id))
                if document is not None:
                    self.client.set_payload(collection_name=self.settings.collection_name,
                        payload={"metadata": document.metadata}, points=[point.id], wait=True)
            return {"status": "unchanged", "chunks": len(documents)}
        vectors = self.embedding.embed_documents([doc.page_content for doc in documents])
        if len(vectors) != len(documents):
            raise ValueError("Embedding result length does not match document count")
        points = [models.PointStruct(id=doc.id, vector=vector, payload={
            "page_content": doc.page_content, "metadata": doc.metadata,
            "embedding_model": self.settings.embedding_model,
            "embedding_dimension": self.embedding.dimension,
            "index_version": INDEX_VERSION, "source_hash": fingerprint})
            for doc, vector in zip(documents, vectors)]
        for start in range(0, len(points), 64):
            self.client.upsert(collection_name=self.settings.collection_name, points=points[start:start + 64], wait=True)
        keep = {doc.id for doc in documents}
        stale = [point.id for point in previous if str(point.id) not in keep]
        if stale:
            self.client.delete(collection_name=self.settings.collection_name,
                               points_selector=models.PointIdsList(points=stale), wait=True)
        return {"status": "updated", "chunks": len(documents)}

    def add_documents(self, documents: list[Document]):
        self.prepare()
        return self.upsert_source(documents)
