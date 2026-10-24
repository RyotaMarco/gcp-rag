from qdrant_client import QdrantClient
from config.config import Settings
from rag.chunking import Chunker
from rag.indexer import Indexer
from rag.retriever import Retriever, tokenize


class ConstantEmbedding:
    model_name = "fake"
    dimension = 3
    def embed_query(self, query):
        return [1.0, 0.0, 0.0]
    def embed_documents(self, texts):
        return [[1.0, 0.0, 0.0] for _ in texts]


class KeywordReranker:
    def score(self, query, passages):
        return [0.95 if "registry" in text.lower() and "registry" in query.lower() else 0.05 for text in passages]


def test_hybrid_reranks_and_abstains_without_evidence(tmp_path):
    settings = Settings(data_dir=tmp_path, embedding_model="fake", qdrant_url=":memory:")
    client, embedding = QdrantClient(":memory:"), ConstantEmbedding()
    indexer = Indexer(settings, client=client, embedding=embedding)
    indexer.prepare()
    for index, text in enumerate(["Vertex AI model registry stores model versions.", "Cloud Storage stores objects in buckets.", "Speech-to-Text transcribes audio."]):
        docs = Chunker(settings).chunk(text, {"source_url": f"https://cloud.google.com/vertex-ai/docs/test-{index}", "title": "Documentation", "product": "GCP"})
        indexer.upsert_source(docs)
    retriever = Retriever(settings, client=client, embedding=embedding, reranker=KeywordReranker())
    results = retriever.retrieve("How does the model registry work?")
    assert len(results) == 1
    assert "registry" in results[0].page_content
    assert results[0].score == 0.95
    assert retriever.retrieve("What is a nonexistent product?") == []
    assert retriever.retrieve(" ") == []
    assert len(retriever.baseline_retrieve("registry")) == 3
    assert retriever.status()["index_ready"]
    client.close()


def test_empty_index_needs_no_models(tmp_path):
    class FailIfUsed:
        def __getattr__(self, key):
            raise AssertionError("Model should not load for an empty index")
    client = QdrantClient(":memory:")
    retriever = Retriever(Settings(data_dir=tmp_path), client=client, embedding=FailIfUsed(), reranker=FailIfUsed())
    assert retriever.retrieve("Vertex AI") == []
    assert retriever.baseline_retrieve("Vertex AI") == []
    assert retriever.status()["indexed_chunks"] == 0
    client.close()


def test_tokenization_supports_portuguese_accents():
    assert tokenize("Versões, implantação e permissões IAM") == ["versoes", "implantacao", "e", "permissoes", "iam"]

def test_lazy_model_initialization_is_thread_safe(monkeypatch):
    import sys
    import time
    import types
    from concurrent.futures import ThreadPoolExecutor
    from rag.embedding import Embedding, Reranker
    calls = []
    class FakeModel:
        def __init__(self, name, device):
            calls.append(name)
            time.sleep(0.02)
    monkeypatch.setitem(sys.modules, "sentence_transformers", types.SimpleNamespace(SentenceTransformer=FakeModel, CrossEncoder=FakeModel))
    embedding, reranker = Embedding(Settings()), Reranker(Settings())
    with ThreadPoolExecutor(max_workers=4) as pool:
        embeddings = list(pool.map(lambda _: embedding.model, range(4)))
        rerankers = list(pool.map(lambda _: reranker.model, range(4)))
    assert all(model is embeddings[0] for model in embeddings)
    assert all(model is rerankers[0] for model in rerankers)
    assert calls == [embedding.settings.embedding_model, reranker.settings.reranker_model]

def test_qdrant_startup_retries_transport_only(monkeypatch):
    import httpx
    import rag.indexer as module
    from qdrant_client.http.exceptions import ResponseHandlingException, UnexpectedResponse
    instances, sleeps = [], []
    class FakeClient:
        def __init__(self, **kwargs):
            self.kwargs, self.attempts, self.closed = kwargs, 0, False
            instances.append(self)
        def get_collections(self):
            self.attempts += 1
            if self.attempts < 3:
                raise ResponseHandlingException(httpx.ConnectError("not listening"))
        def close(self):
            self.closed = True
    monkeypatch.setattr(module, "QdrantClient", FakeClient)
    monkeypatch.setattr(module.time, "sleep", sleeps.append)
    client = module.create_client("http://qdrant:6333")
    assert sleeps == [1, 1]
    assert instances[0].attempts == 3 and instances[0].closed
    assert client.kwargs["timeout"] == 10
    instances.clear()
    sleeps.clear()
    class Unauthorized(FakeClient):
        def get_collections(self):
            raise UnexpectedResponse(401, "Unauthorized", b"", httpx.Headers())
    monkeypatch.setattr(module, "QdrantClient", Unauthorized)
    with __import__("pytest").raises(UnexpectedResponse):
        module.create_client("http://qdrant:6333")
    assert sleeps == []
    assert len(instances) == 1 and instances[0].closed


def test_qdrant_startup_wait_is_bounded_and_leaves_api_client(monkeypatch):
    import httpx
    import rag.indexer as module
    from qdrant_client.http.exceptions import ResponseHandlingException
    instances, sleeps = [], []
    class Offline:
        def __init__(self, **kwargs):
            self.kwargs, self.attempts, self.closed = kwargs, 0, False
            instances.append(self)
        def get_collections(self):
            self.attempts += 1
            raise ResponseHandlingException(httpx.ConnectError("offline"))
        def close(self):
            self.closed = True
    monkeypatch.setattr(module, "QdrantClient", Offline)
    monkeypatch.setattr(module.time, "sleep", sleeps.append)
    client = module.create_client("http://qdrant:6333")
    assert instances[0].attempts == 10 and instances[0].closed
    assert sleeps == [1] * 9
    assert client is instances[1] and client.kwargs["timeout"] == 10


def test_model_warmup_runs_both_local_models_without_provider(monkeypatch):
    import rag.embedding as module
    calls = []
    class FakeEmbedding:
        def embed_query(self, query):
            calls.append(("embedding", query))
            return [1.0]
    class FakeReranker:
        def __init__(self, settings):
            assert not settings.groq_api_key
        def score(self, query, documents):
            calls.append(("reranker", query))
            return [0.9]
    monkeypatch.setattr(module, "Reranker", FakeReranker)
    module.warm_models(Settings(), embedding=FakeEmbedding())
    assert [name for name, _ in calls] == ["embedding", "reranker"]
