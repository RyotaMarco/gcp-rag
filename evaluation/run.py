"""Run with `python -m evaluation.run --mode fixture --output report.json`.

Fixture mode tests plumbing using deterministic lexical model doubles. It is not
an estimate of model quality. Real mode downloads the configured local models;
both modes use a small, hand-authored corpus, never a production documentation
snapshot. Expected labels are used only by the metric, not by either retriever.
"""
from __future__ import annotations

import argparse
from collections import Counter
from contextlib import closing
from dataclasses import replace
from hashlib import blake2b
import json
import math
from pathlib import Path
import re
import tempfile
import unicodedata
from uuid import NAMESPACE_URL, uuid5

ROOT = Path(__file__).resolve().parent

STOPWORDS = set("a o e as os de da do das dos um uma em no na com por para que qual como the a an and of to in on is are how what does do for can my it i os at with".split())
ALIASES = {
    "modelos": "model", "modelo": "model", "models": "model",
    "versoes": "version", "versao": "version", "versions": "version", "versionar": "version",
    "texto": "text", "textos": "text", "audio": "audio", "fala": "spoken",
    "transcreve": "transcribe", "transcribes": "transcribe", "transcricao": "transcribe",
    "imagens": "image", "imagem": "image", "images": "image",
    "extrair": "extract", "extrai": "extract", "extracts": "extract",
    "faturas": "invoice", "invoices": "invoice", "campos": "field", "fields": "field",
    "estruturados": "structured", "paginas": "page", "pages": "page",
    "fluxos": "flow", "flows": "flow", "conversa": "conversation",
    "dados": "data", "tabelas": "table", "tables": "table", "conjuntos": "datasets",
    "papeis": "role", "roles": "role", "permissoes": "permission", "permissions": "permission",
    "privilegio": "privilege", "minimo": "least", "maquina": "machine", "machines": "machine",
    "virtuais": "virtual", "instancias": "instance", "instances": "instance",
    "objetos": "object", "objects": "object", "armazenam": "store", "armazena": "store",
    "topicos": "topic", "topics": "topic", "assinaturas": "subscription", "subscriptions": "subscription",
    "consumidores": "subscriber", "subscribers": "subscriber", "produtores": "publisher", "publishers": "publisher",
    "glossarios": "glossary", "glossaries": "glossary", "traduzir": "translate", "traducao": "translate",
    "terminologia": "terminology", "termos": "term", "bancos": "database", "databases": "database",
    "relacionais": "relational", "gerenciados": "managed", "gerenciado": "managed",
    "aceleradores": "accelerator", "accelerators": "accelerator", "tensores": "tensor",
    "tensors": "tensor", "lote": "batch", "predicao": "prediction", "endpoints": "endpoint",
}


def tokens(text: str) -> list[str]:
    normalized = "".join(c for c in unicodedata.normalize("NFKD", text.lower()) if not unicodedata.combining(c))
    return [ALIASES.get(word, word) for word in re.findall(r"[a-z0-9]+", normalized) if word not in STOPWORDS]


class FixtureEmbedding:
    """Model double: signed hashing of words, with no benchmark-label access."""
    model_name = "fixture-lexical-hash-v1"
    dimension = 256

    def embed_query(self, text: str) -> list[float]:
        counts = Counter(tokens(text))
        vector = [0.0] * self.dimension
        for word, count in counts.items():
            digest = blake2b(word.encode(), digest_size=8).digest()
            vector[int.from_bytes(digest[:4], "big") % self.dimension] += math.log1p(count) * (1 if digest[4] % 2 else -1)
        norm = math.sqrt(sum(x * x for x in vector)) or 1.0
        return [x / norm for x in vector]

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [self.embed_query(text) for text in texts]


class FixtureReranker:
    """Deterministic query-token coverage; intentionally not a neural reranker."""
    def score(self, query: str, passages: list[str]) -> list[float]:
        query_tokens = set(tokens(query))
        return [len(query_tokens & set(tokens(passage))) / max(len(query_tokens), 1) for passage in passages]


def load_cases(path: Path = ROOT / "cases.json") -> list[dict]:
    cases = json.loads(path.read_text(encoding="utf-8"))
    ids = [case["id"] for case in cases]
    if len(ids) != len(set(ids)):
        raise ValueError("Benchmark case IDs must be unique")
    return cases


def evaluate_case(case: dict, retrieve) -> dict:
    # This is an explicitly defined retrieval-context baseline, not an LLM rewrite.
    history = " ".join(item["content"] for item in case.get("history", []) if item["role"] == "user")
    query = f"{history} {case['question']}".strip()
    docs = retrieve(query)
    returned = [doc.metadata.get("source_url", "") for doc in docs[:5]]
    expected = set(case["expected_urls"])
    hit = any(url in expected for url in returned)
    rank = next((i for i, url in enumerate(returned, 1) if url in expected), None)
    return {"id": case["id"], "language": case["language"], "kind": case["kind"], "hit_at_5": hit, "reciprocal_rank": 1 / rank if rank else 0, "returned_urls": returned, "expected_urls": sorted(expected)}


def summarize(rows: list[dict]) -> dict:
    total = len(rows)
    return {"answerable_cases": total, "hits_at_5": sum(row["hit_at_5"] for row in rows), "hit_rate_at_5": sum(row["hit_at_5"] for row in rows) / total if total else 0, "mean_reciprocal_rank": sum(row["reciprocal_rank"] for row in rows) / total if total else 0}


def run(mode: str = "fixture", corpus: Path = ROOT / "corpus", cases_path: Path = ROOT / "cases.json", threshold: float = .85, compare_original: bool = False) -> dict:
    from config.config import get_settings
    from qdrant_client import QdrantClient
    from rag.indexer import Indexer
    from rag.embedding import Embedding
    from rag.models import Document
    from rag.retriever import Retriever

    if mode not in {"fixture", "real"}:
        raise ValueError("mode must be fixture or real")
    if compare_original and mode != "real":
        raise ValueError("--compare-original requires --mode real")
    if not 0 <= threshold <= 1:
        raise ValueError("threshold must be between zero and one")
    settings = get_settings()
    embedding = FixtureEmbedding() if mode == "fixture" else Embedding(settings)
    reranker = FixtureReranker() if mode == "fixture" else None
    settings = replace(settings, collection_name="evaluation_docs", embedding_model=embedding.model_name if embedding else settings.embedding_model)
    cases = load_cases(cases_path)
    original_rows = []
    with tempfile.TemporaryDirectory(prefix="gcp-eval-") as temp:
        settings = replace(settings, data_dir=Path(temp))
        with closing(QdrantClient(location=":memory:")) as client:
            indexer = Indexer(settings, client=client, embedding=embedding)
            indexer.prepare(rebuild=True)
            count = 0
            for path in sorted(corpus.glob("*.json")):
                raw = json.loads(path.read_text(encoding="utf-8"))
                metadata = raw["metadata"]
                identifier = str(uuid5(NAMESPACE_URL, metadata["source_url"] + raw["content"]))
                indexer.upsert_source([Document(raw["content"], metadata=metadata, id=identifier)])
                count += 1
            if not count:
                raise ValueError("No corpus documents found")
            retriever = Retriever(settings, client=client, embedding=embedding, reranker=reranker)
            retrieval_cases = [case for case in cases if case["kind"] in {"retrieval", "continuation"}]
            if not retrieval_cases:
                raise ValueError("No answerable retrieval cases found")
            baseline_rows = [evaluate_case(case, lambda q: retriever.baseline_retrieve(q, k=5)) for case in retrieval_cases]
            hybrid_rows = [evaluate_case(case, lambda q: retriever.retrieve(q, top_k=5)) for case in retrieval_cases]
        if compare_original:
            class OriginalEmbedding(Embedding):
                # The initial HuggingFaceEmbeddings wrapper used unprefixed text.
                def embed_documents(self, texts):
                    return self.model.encode(texts, normalize_embeddings=False,
                                             show_progress_bar=False).tolist()

                def embed_query(self, text):
                    return self.model.encode(text, normalize_embeddings=False,
                                             show_progress_bar=False).tolist()

            original_settings = replace(settings, collection_name="evaluation_original",
                                        embedding_model="sentence-transformers/all-MiniLM-L6-v2")
            original_embedding = OriginalEmbedding(original_settings)
            with closing(QdrantClient(location=":memory:")) as original_client:
                original_indexer = Indexer(original_settings, client=original_client, embedding=original_embedding)
                original_indexer.prepare(rebuild=True)
                for path in sorted(corpus.glob("*.json")):
                    raw = json.loads(path.read_text(encoding="utf-8"))
                    identifier = str(uuid5(NAMESPACE_URL, raw["metadata"]["source_url"] + raw["content"]))
                    original_indexer.upsert_source([Document(raw["content"], metadata=raw["metadata"], id=identifier)])
                original_retriever = Retriever(original_settings, client=original_client, embedding=original_embedding)
                original_rows = [evaluate_case(case, lambda q: original_retriever.baseline_retrieve(q, k=5)) for case in retrieval_cases]
    baseline = summarize(baseline_rows)
    hybrid = summarize(hybrid_rows)
    report = {
        "schema_version": 1,
        "mode": mode,
        "corpus": str(corpus.resolve().relative_to(ROOT.parent)) if corpus.resolve().is_relative_to(ROOT.parent) else str(corpus),
        "corpus_documents": count,
        "embedding_model": settings.embedding_model,
        "reranker_model": "fixture-query-token-coverage" if mode == "fixture" else settings.reranker_model,
        "scope": "Synthetic model-double plumbing check; NOT production model accuracy" if mode == "fixture" else "Real local models against small hand-authored representative corpus; NOT live-crawl production accuracy",
        "baseline_definition": "Semantic-only top-5 using the SAME embedding model; not the original repository's English MiniLM model",
        "metric_definition": "Fraction of answerable retrieval questions with at least one expected source URL in top five (Hit@5), not Precision@5",
        "total_cases_in_suite": len(cases),
        "baseline": baseline,
        "hybrid": hybrid,
        "hit_rate_delta": hybrid["hit_rate_at_5"] - baseline["hit_rate_at_5"],
        "threshold": threshold,
        "passed": hybrid["hit_rate_at_5"] >= threshold,
        "behavior_cases_not_run_by_retrieval_benchmark": [{"id": c["id"], "expected_mode": c.get("expected_mode"), "reason": "Run backend API/routing tests; excluded from answerable-retrieval denominator"} for c in cases if c["kind"] not in {"retrieval", "continuation"}],
        "results": {"baseline": baseline_rows, "hybrid": hybrid_rows},
    }
    if compare_original:
        report["original_baseline"] = {
            **summarize(original_rows),
            "embedding_model": "sentence-transformers/all-MiniLM-L6-v2",
            "definition": "Original English embedding model with raw query/document text (no e5 prefixes), cosine dense-only top-5 on the same curated corpus; not a replay of the original live-crawl index",
        }
        report["original_to_hybrid_hit_rate_delta"] = hybrid["hit_rate_at_5"] - report["original_baseline"]["hit_rate_at_5"]
        report["results"]["original_baseline"] = original_rows
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=["fixture", "real"], default="fixture")
    parser.add_argument("--corpus", type=Path, default=ROOT / "corpus")
    parser.add_argument("--cases", type=Path, default=ROOT / "cases.json")
    parser.add_argument("--threshold", type=float, default=.85)
    parser.add_argument("--compare-original", action="store_true", help="Real mode only: compare against original English MiniLM embeddings without prefixes")
    parser.add_argument("--output", type=Path, default=Path("evaluation-report.json"))
    args = parser.parse_args()
    report = run(args.mode, args.corpus, args.cases, args.threshold, args.compare_original)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: report[key] for key in ("mode", "scope", "baseline", "hybrid", "passed")}, ensure_ascii=False, indent=2))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
