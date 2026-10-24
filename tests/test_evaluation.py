import json
import asyncio
import math
from pathlib import Path
from urllib.parse import urlsplit

import pytest

from evaluation.run import ROOT, FixtureEmbedding, FixtureReranker, evaluate_case, load_cases, summarize
from rag.models import Document


def test_suite_covers_both_languages_and_nonretrieval_scenarios():
    cases = load_cases()
    retrieval = [c for c in cases if c["kind"] == "retrieval"]
    assert len(retrieval) >= 30
    assert {c["language"] for c in retrieval} == {"pt", "en"}
    assert {"continuation", "clarification", "insufficient_evidence", "mcp", "hybrid"}.issubset({c["kind"] for c in cases})
    assert len({c["id"] for c in cases}) == len(cases)


def test_fixture_labels_have_corresponding_official_sources():
    urls = set()
    for path in (ROOT / "corpus").glob("*.json"):
        raw = json.loads(path.read_text(encoding="utf-8"))
        assert raw["metadata"]["fixture"] is True
        assert raw["metadata"]["crawled_at"] is None
        url = raw["metadata"]["source_url"]
        assert urlsplit(url).scheme == "https"
        assert urlsplit(url).hostname == "docs.cloud.google.com"
        urls.add(url)
    for case in load_cases():
        assert set(case.get("expected_urls", [])).issubset(urls)


def test_metric_scores_sources_and_caps_at_five():
    case = {"id": "case", "language": "pt", "kind": "retrieval", "question": "question", "expected_urls": ["https://example.com/expected"]}
    expected = Document("evidence", {"source_url": "https://example.com/expected"})
    irrelevant = Document("other", {"source_url": "https://example.com/other"})
    first = evaluate_case(case, lambda _: [expected])
    sixth = evaluate_case(case, lambda _: [irrelevant] * 5 + [expected])
    assert first["hit_at_5"] and first["reciprocal_rank"] == 1
    assert not sixth["hit_at_5"] and sixth["reciprocal_rank"] == 0
    assert summarize([first, sixth])["hit_rate_at_5"] == .5


def test_continuation_includes_user_context_without_assistant_claims():
    seen = []
    case = {"id": "followup", "language": "en", "kind": "continuation", "question": "What about versions?", "history": [{"role": "user", "content": "Vertex AI Registry"}, {"role": "assistant", "content": "unsupported claim"}], "expected_urls": ["x"]}
    evaluate_case(case, lambda q: seen.append(q) or [])
    assert "Vertex AI Registry" in seen[0]
    assert "unsupported claim" not in seen[0]


def test_model_doubles_are_deterministic_normalized_and_empty_safe():
    embedding = FixtureEmbedding()
    vector = embedding.embed_query("model versions")
    assert vector == embedding.embed_documents(["model versions"])[0]
    assert math.isclose(sum(x * x for x in vector), 1)
    assert len(embedding.embed_query("")) == embedding.dimension
    assert FixtureReranker().score("", ["foo"]) == [0]


def test_duplicate_case_ids_fail(tmp_path: Path):
    path = tmp_path / "cases.json"
    path.write_text('[{"id":"duplicate"},{"id":"duplicate"}]', encoding="utf-8")
    with pytest.raises(ValueError, match="unique"):
        load_cases(path)


@pytest.mark.parametrize("case", [c for c in load_cases() if c["kind"] not in {"retrieval", "continuation"}], ids=lambda c: c["id"])
def test_benchmark_behavior_cases_use_actual_pipeline_routing(case):
    """Exercise the benchmark's ten non-retrieval expectations without a paid API.

    Resource calls and generation are replaced at their I/O boundary. Routing,
    clarification, evidence handling and result contracts use the real pipeline.
    """
    from config.config import Settings
    from rag.pipeline import Pipeline

    class Evidence:
        def retrieve(self, question):
            if "acesso uniforme" in question.lower():
                return [Document("Uniform bucket-level access uses IAM policies. [S1]", {"source_url": "https://docs.cloud.google.com/storage/docs/buckets", "title": "Cloud Storage", "product": "Cloud Storage", "section": "Access", "crawled_at": ""}, id="storage", score=.9)]
            return []

    class Tools:
        calls = []

        async def call(self, name, arguments):
            self.calls.append((name, arguments))
            return {"simulated": True, "project": "demo", "resources": []}

    class Model:
        def generate_with_context(self, context, question, history):
            assert "[S1]" in context
            return "O acesso uniforme usa políticas IAM. [S1]"

    tools = Tools()
    pipe = Pipeline(Settings(), retriever=Evidence(), generator=Model(), mcp=tools)
    answer = asyncio.run(pipe.run(case["question"], case.get("history", [])))
    assert answer["mode"] == case["expected_mode"]
    assert answer["simulated"] is case.get("expected_simulated", False)
    if case["kind"] in {"mcp", "hybrid"}:
        assert tools.calls
    else:
        assert not tools.calls
