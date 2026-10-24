"""Offline provenance and SSRF regression checks; no model calls or collection."""
import importlib.util
import json
from pathlib import Path

import httpx
import pytest

spec = importlib.util.spec_from_file_location('prepare_corpus', Path(__file__).parents[1] / 'scripts' / 'prepare-corpus.py')
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)


@pytest.mark.parametrize('url', [
    'http://docs.cloud.google.com/storage/docs/introduction',
    'https://docs.cloud.google.com.attacker.test/storage/docs/introduction',
    'https://attacker.test@docs.cloud.google.com/storage/docs/introduction',
    'https://docs.cloud.google.com:8443/storage/docs/introduction',
    'https://127.0.0.1/storage/docs/introduction',
    'https://docs.cloud.google.com/iam/docs/overview',
    'https://docs.cloud.google.com/storage-other/docs/introduction',
])
def test_rejects_sources_outside_official_service_scope(url):
    with pytest.raises(ValueError):
        collector.safe_url(url, '/storage/')


def test_each_redirect_is_checked_before_fetching_the_target():
    requested = []
    def response(request):
        requested.append(str(request.url))
        return httpx.Response(302, headers={'location': 'https://127.0.0.1/private'})
    with httpx.Client(transport=httpx.MockTransport(response)) as client:
        with pytest.raises(ValueError):
            collector.fetch(client, 'https://docs.cloud.google.com/storage/docs/introduction', '/storage/', lambda _: True)
    assert requested == ['https://docs.cloud.google.com/storage/docs/introduction']


def test_robots_denial_prevents_a_network_request():
    def response(_):
        raise AssertionError('Denied documents must never be requested')
    with httpx.Client(transport=httpx.MockTransport(response)) as client:
        with pytest.raises(ValueError, match='robots'):
            collector.fetch(client, 'https://docs.cloud.google.com/storage/docs/introduction', '/storage/', lambda _: False)


def test_limits_decompressed_response_bytes(monkeypatch):
    monkeypatch.setattr(collector, 'MAX_PAGE_BYTES', 100)
    with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200, text='x' * 101))) as client:
        with pytest.raises(ValueError, match='byte limit'):
            collector.fetch(client, 'https://docs.cloud.google.com/storage/docs/introduction', '/storage/')


def test_production_manifest_is_real_bounded_and_checksum_verified(capsys):
    collector.check()
    manifest = json.loads((collector.CORPUS / 'manifest.json').read_text())
    assert manifest['fixture'] is False
    assert len(manifest['services']) == 6
    assert len(manifest['sources']) == manifest['pages'] <= 30
    assert 0 < manifest['chunks'] <= 750
    assert all(item['crawled_at'] and len(item['sha256']) == 64 for item in manifest['sources'])
    assert 'real chunks' in capsys.readouterr().out


def test_fixture_or_tampered_text_cannot_pass_the_production_gate(tmp_path, monkeypatch):
    manifest = json.loads((collector.CORPUS / 'manifest.json').read_text())
    chunks = (collector.CORPUS / 'chunks.jsonl').read_text().splitlines()
    source = (collector.CORPUS / 'sources.json').read_text()
    first = json.loads(chunks[0]); first['text'] += 'tampered'; chunks[0] = json.dumps(first)
    (tmp_path / 'manifest.json').write_text(json.dumps(manifest))
    (tmp_path / 'chunks.jsonl').write_text('\n'.join(chunks))
    (tmp_path / 'sources.json').write_text(source)
    monkeypatch.setattr(collector, 'CORPUS', tmp_path)
    with pytest.raises(ValueError, match='checksum'):
        collector.check()
    first['fixture'] = True; chunks[0] = json.dumps(first)
    (tmp_path / 'chunks.jsonl').write_text('\n'.join(chunks))
    with pytest.raises(ValueError, match='Fixture'):
        collector.check()
