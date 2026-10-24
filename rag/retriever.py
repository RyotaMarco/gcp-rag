"""Hybrid retrieval: dense search + BM25 fusion + multilingual cross-encoder."""
from collections import defaultdict
from functools import wraps
import re
import time
from threading import RLock
import unicodedata
from rank_bm25 import BM25Okapi
from config.config import Settings, get_settings
from rag.embedding import Embedding, Reranker
from rag.indexer import IndexCompatibilityError, create_client, index_status, payload_document, read_corpus


def synchronized(method):
    @wraps(method)
    def locked(self, *args, **kwargs):
        with self._lock:
            return method(self, *args, **kwargs)
    return locked


def tokenize(text: str) -> list[str]:
    normalized = unicodedata.normalize("NFKD", text.lower())
    normalized = "".join(char for char in normalized if not unicodedata.combining(char))
    return re.findall(r"[a-z0-9]+", normalized)


class Retriever:
    def __init__(self, settings: Settings | None = None, client=None, embedding=None, reranker=None):
        self.settings = settings or get_settings()
        self.client = client if client is not None else create_client(self.settings.qdrant_url)
        self.embedding = embedding if embedding is not None else Embedding(self.settings)
        self.reranker = reranker if reranker is not None else Reranker(self.settings)
        self._documents, self._bm25, self._loaded_at, self._count = [], None, 0.0, -1
        self._lock = RLock()

    def status(self) -> dict:
        return index_status(self.client, self.settings)

    def _ready(self):
        status = self.status()
        if not status["index_compatible"]:
            raise IndexCompatibilityError(status["detail"])
        return status

    def _dense(self, query: str, k: int):
        result = self.client.query_points(collection_name=self.settings.collection_name,
            query=self.embedding.embed_query(query), limit=k, with_payload=True)
        return [payload_document(point) for point in result.points]

    @synchronized
    def baseline_retrieve(self, query: str, k: int = 5):
        if not self._ready()["index_ready"]:
            return []
        return self._dense(query, k)

    def _lexical(self, query: str, k: int, count: int):
        if self._count != count or time.monotonic() - self._loaded_at > 30:
            self._documents = read_corpus(self.client, self.settings.collection_name)
            tokens = [tokenize(doc.metadata.get("title", "") + " " + doc.metadata.get("section", "") + " " + doc.page_content) or ["_"] for doc in self._documents]
            self._bm25 = BM25Okapi(tokens) if tokens else None
            self._loaded_at, self._count = time.monotonic(), count
        if self._bm25 is None:
            return []
        scores = self._bm25.get_scores(tokenize(query))
        ordered = sorted(range(len(scores)), key=lambda index: float(scores[index]), reverse=True)
        return [self._documents[index] for index in ordered[:k] if scores[index] > 0]

    @synchronized
    def retrieve(self, query: str, top_k: int | None = None):
        if not query.strip():
            return []
        status = self._ready()
        if not status["index_ready"]:
            return []
        k = top_k or self.settings.retrieval_k
        candidate_k = max(20, k * 4)
        dense = self._dense(query, candidate_k)
        lexical = self._lexical(query, candidate_k, status["indexed_chunks"])
        scores, candidates = defaultdict(float), {}
        for ranked in (dense, lexical):
            for rank, document in enumerate(ranked, 1):
                scores[document.id] += 1 / (60 + rank)
                candidates[document.id] = document
        fused = sorted(candidates.values(), key=lambda doc: scores[doc.id], reverse=True)[:candidate_k]
        relevance = self.reranker.score(query, [doc.page_content for doc in fused])
        if len(relevance) != len(fused):
            raise ValueError("Reranker result length does not match candidate count")
        selected = []
        for document, score in zip(fused, relevance):
            document.score = float(score)
            if document.score >= self.settings.min_relevance_score:
                selected.append(document)
        return sorted(selected, key=lambda doc: doc.score, reverse=True)[:k]
