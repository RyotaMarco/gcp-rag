from dataclasses import replace
import json
from pathlib import Path
import pytest
from qdrant_client import QdrantClient
from config.config import Settings
from rag.chunking import Chunker
from rag.indexer import IndexCompatibilityError, Indexer, index_status, read_corpus
from rag.ingestion import Ingestion
from storage.bucket_storage import DocumentStorage, canonical_url
from scraping.scraping import extract_markdown


class FakeEmbedding:
    model_name = "fake-multilingual"
    dimension = 4
    def __init__(self):
        self.calls = 0
    def embed_documents(self, texts):
        self.calls += 1
        return [[1.0, float("Vertex" in text), float("bucket" in text), 0.1] for text in texts]
    def embed_query(self, text):
        return [1.0, float("Vertex" in text), float("bucket" in text), 0.1]


def environment(tmp_path):
    settings = Settings(data_dir=tmp_path, qdrant_url=":memory:", embedding_model=FakeEmbedding.model_name,
                        chunk_size=120, chunk_overlap=15)
    return settings, QdrantClient(":memory:"), FakeEmbedding()


def source(title="Vertex AI"):
    return {"source_url": "https://cloud.google.com/vertex-ai/docs/start?hl=en#section",
            "title": title, "product": "Vertex AI", "crawled_at": "2026-01-01T00:00:00+00:00"}


def test_ingestion_preserves_metadata_is_idempotent_and_removes_stale_chunks(tmp_path):
    settings, client, embedding = environment(tmp_path)
    storage = DocumentStorage(settings)
    storage.save("# Vertex AI\n\n" + "Train and deploy Vertex AI models. " * 25, source())
    ingestion = Ingestion(settings, client=client, embedding=embedding)
    first = ingestion.run()
    count = client.count(settings.collection_name).count
    assert first["updated"] == 1 and count > 2
    calls = embedding.calls
    second = ingestion.run()
    assert second["unchanged"] == 1
    assert client.count(settings.collection_name).count == count
    assert embedding.calls == calls
    storage.save("# Vertex AI\n\nUpdated model deployment instructions.", source("Updated title"))
    third = ingestion.run()
    documents = read_corpus(client, settings.collection_name)
    assert third["updated"] == 1
    assert len(documents) < count
    assert all(doc.metadata["title"] == "Updated title" for doc in documents)
    assert all(doc.metadata["section"] == "Vertex AI" for doc in documents)
    assert all(doc.metadata["source_url"] == "https://cloud.google.com/vertex-ai/docs/start" for doc in documents)
    assert documents[0].metadata["crawled_at"] == "2026-01-01T00:00:00+00:00"
    client.close()


def test_header_and_code_lists_are_preserved(tmp_path):
    settings = Settings(data_dir=tmp_path, chunk_size=1000)
    text = "# Deploy\n\n1. Enable API\n2. Upload model\n\n```bash\n# a shell comment, not a heading\ngcloud ai models list\n```\n\n## Permissions\n\n- roles/aiplatform.user\n"
    documents = Chunker(settings).chunk(text, source())
    assert len(documents) == 2
    assert "1. Enable API" in documents[0].page_content
    assert "# a shell comment" in documents[0].page_content
    assert documents[1].metadata["section"] == "Deploy > Permissions"
    assert "roles/aiplatform.user" in documents[1].page_content


def test_crawler_extraction_retains_ordered_lists_and_code():
    title, content, links = extract_markdown('<main><nav>menu</nav><h1>Deploy</h1><ol><li>Enable API</li><li>Upload</li></ol><pre><code>gcloud ai models list\n</code></pre><a href="/vertex-ai/docs">docs</a></main>')
    assert title == "Deploy"
    assert "Enable API" in content and "gcloud ai models list" in content
    assert "menu" not in content
    assert links == ["/vertex-ai/docs"]


def test_storage_is_atomic_and_validates_sources(tmp_path):
    storage = DocumentStorage(Settings(data_dir=tmp_path))
    path = storage.save("hello", source())
    assert path.parent == tmp_path / "raw"
    assert path.suffix == ".json"
    assert len(list(path.parent.glob("*.json"))) == 1
    assert json.loads(path.read_text(encoding="utf-8"))["content"] == "hello"
    for url in ["http://cloud.google.com/docs", "https://evil.com/docs", "https://cloud.google.com.evil.com/docs", "https://cloud.google.com:444/docs", "https://user@cloud.google.com/docs"]:
        with pytest.raises(ValueError):
            canonical_url(url)
    with pytest.raises(ValueError):
        storage.save(" ", source())


def test_index_fingerprint_requires_explicit_rebuild(tmp_path):
    settings, client, embedding = environment(tmp_path)
    ingestion = Ingestion(settings, client=client, embedding=embedding)
    DocumentStorage(settings).save("# Vertex AI\nModel registry and endpoints.", source())
    ingestion.run()
    changed = replace(settings, embedding_model="different-model")
    assert not index_status(client, changed)["index_compatible"]
    with pytest.raises(IndexCompatibilityError):
        Indexer(changed, client=client, embedding=embedding).prepare()
    Ingestion(changed, client=client, embedding=embedding).run(rebuild=True)
    assert index_status(client, changed)["index_ready"]
    client.close()


def test_persisted_qdrant_survives_restart(tmp_path):
    settings = Settings(data_dir=tmp_path / "docs", qdrant_url="local:" + str(tmp_path / "qdrant"), embedding_model=FakeEmbedding.model_name)
    DocumentStorage(settings).save("# Vertex AI\nModel registry.", source())
    ingestion = Ingestion(settings, embedding=FakeEmbedding())
    ingestion.run()
    ingestion.indexer.client.close()
    from rag.indexer import create_client
    reopened = create_client(settings.qdrant_url)
    assert index_status(reopened, settings)["indexed_chunks"] == 1
    reopened.close()
import asyncio
import httpx
from scraping.scraping import GCPDocsCrawler


def test_crawler_validates_redirects_and_respects_robots(tmp_path):
    visited = []
    def handler(request):
        visited.append(str(request.url))
        if request.url.path == "/robots.txt":
            return httpx.Response(200, text="User-agent: *\nDisallow: /vertex-ai/docs/private", headers={"Content-Type": "text/plain"})
        if request.url.path.endswith("/start"):
            return httpx.Response(302, headers={"location": "https://attacker.invalid/secrets"})
        return httpx.Response(200, text='<main><h1>Vertex AI</h1><ol><li>Enable API</li></ol><pre><code>gcloud ai models list</code></pre><a href="/vertex-ai/docs/private">private</a><a href="/vertex-ai/docs/start">start</a></main>', headers={"Content-Type": "text/html"})
    async def crawl():
        settings = Settings(data_dir=tmp_path, crawl_delay=0)
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            crawler = GCPDocsCrawler(settings, client=client)
            return await crawler.crawl_gpc_docs({"product": "Vertex AI", "url": "https://cloud.google.com/vertex-ai/docs"}, max_pages=3)
    result = asyncio.run(crawl())
    assert result["saved"] == 1
    assert result["failed"] == 1
    assert result["skipped"] == 1
    assert not any("attacker.invalid" in url for url in visited)
    assert not any(url.endswith("/private") for url in visited)


def test_crawler_blocks_non_official_seed(tmp_path):
    async def crawl():
        return await GCPDocsCrawler(Settings(data_dir=tmp_path, crawl_delay=0)).crawl_gpc_docs({"product": "Bad", "url": "https://attacker.invalid/docs"})
    with pytest.raises(ValueError):
        asyncio.run(crawl())

def test_crawler_adopts_official_seed_redirect_and_cleans_title(tmp_path):
    def handler(request):
        if request.url.path == "/robots.txt":
            return httpx.Response(200, text="User-agent: *\nAllow: /", headers={"Content-Type": "text/plain"})
        if request.url.path == "/vertex-ai/docs":
            return httpx.Response(302, headers={"location": "https://docs.cloud.google.com/new-product/docs"})
        return httpx.Response(200, text='<article><h1>New Product<devsite-actions>Bookmark UI</devsite-actions></h1><p>Instructions</p></article>', headers={"Content-Type": "text/html"})
    async def crawl():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await GCPDocsCrawler(Settings(data_dir=tmp_path, crawl_delay=0), client=client).crawl_gpc_docs({"product": "Vertex AI", "url": "https://cloud.google.com/vertex-ai/docs"}, max_pages=1)
    result = asyncio.run(crawl())
    assert result["saved"] == 1
    stored = next(DocumentStorage(Settings(data_dir=tmp_path)).documents())
    assert stored["metadata"]["source_url"] == "https://docs.cloud.google.com/new-product/docs"
    assert stored["metadata"]["title"] == "New Product"
    assert "Bookmark UI" not in stored["content"]

def test_ingestion_reports_invalid_file_and_continues(tmp_path):
    settings, client, embedding = environment(tmp_path)
    storage = DocumentStorage(settings)
    storage.save("# Vertex AI\nValid model documentation.", source())
    (storage.raw_dir / "broken.json").write_text("not json", encoding="utf-8")
    (storage.raw_dir / "missing-source.json").write_text('{"content":"text","metadata":{}}', encoding="utf-8")
    summary = Ingestion(settings, client=client, embedding=embedding).run()
    assert summary["failed"] == 2
    assert summary["updated"] == 1
    assert index_status(client, settings)["index_ready"]
    client.close()


def test_readiness_detects_dimension_fingerprint_mismatch(tmp_path):
    settings, client, embedding = environment(tmp_path)
    DocumentStorage(settings).save("# Vertex AI\nModel registry.", source())
    Ingestion(settings, client=client, embedding=embedding).run()
    documents = read_corpus(client, settings.collection_name)
    client.set_payload(settings.collection_name, payload={"embedding_dimension": 999}, points=[documents[0].id])
    assert not index_status(client, settings)["index_ready"]
    assert not index_status(client, settings)["index_compatible"]
    client.close()
