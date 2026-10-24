"""Offline-only collection for the public demo. Never imported by the Worker.

Fetches only the versioned seed allowlist, obeys robots.txt and validates each
redirect. No credentials, visitors' inputs, or evaluation fixtures are accepted.
Run from the repository root with the lightweight requirements-ingest.txt.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlsplit, urlunsplit
from urllib.robotparser import RobotFileParser

import httpx
from bs4 import BeautifulSoup
from markdownify import markdownify

ROOT = Path(__file__).resolve().parents[1]
CORPUS = ROOT / 'corpus'
CACHE = ROOT / '.cache' / 'pages'
HOSTS = {'cloud.google.com', 'docs.cloud.google.com'}
MODEL = '@cf/baai/bge-m3'
USER_AGENT = 'GCPDocsCopilot/1.0 (+https://github.com/RyotaMarco/gcp-rag)'
MAX_PAGE_BYTES = 3_000_000


def safe_url(value: str, prefix: str | None = None) -> str:
    parts = urlsplit(value)
    if (parts.scheme != 'https' or parts.hostname not in HOSTS or parts.username
            or parts.password or parts.port not in (None, 443)
            or (prefix and not any(parts.path == p.rstrip('/') or parts.path.startswith(p.rstrip('/') + '/') for p in ([prefix] if isinstance(prefix, str) else prefix)))):
        raise ValueError('URL is outside the fixed documentation allowlist')
    return urlunsplit(('https', parts.hostname, parts.path.rstrip('/') or '/', '', ''))


def fetch(client: httpx.Client, url: str, prefix=None, allowed=None) -> tuple[str, str]:
    for _ in range(6):
        url = safe_url(url, prefix)
        if allowed and not allowed(url):
            raise ValueError('robots.txt disallows this source')
        with client.stream('GET', url, follow_redirects=False) as response:
            if response.is_redirect:
                url = urljoin(url, response.headers.get('location', ''))
                continue
            response.raise_for_status()
            if 'text/' not in response.headers.get('content-type', ''):
                raise ValueError('Expected a text documentation page')
            size, pieces = 0, []
            for piece in response.iter_bytes():
                size += len(piece)
                if size > MAX_PAGE_BYTES:
                    raise ValueError('Documentation page exceeds byte limit')
                pieces.append(piece)
            return url, b''.join(pieces).decode('utf-8', errors='replace')
    raise ValueError('Too many redirects')


def extract(html: str) -> tuple[str, str]:
    soup = BeautifulSoup(html, 'html.parser')
    article = soup.select_one('.devsite-article-body') or soup.select_one('article') or soup.select_one('main')
    if not article:
        raise ValueError('Missing documentation article')
    title = soup.find('h1')
    for node in article.select('script,style,nav,aside,footer,header,devsite-actions,devsite-feedback,devsite-feature-tooltip,.nocontent,.devsite-feedback-positioner'):
        node.decompose()
    content = markdownify(str(article), heading_style='ATX', bullets='-', strip=['img']).strip()
    if len(content) < 300:
        raise ValueError('Document body is unexpectedly short')
    return title.get_text(' ', strip=True) if title else 'Google Cloud documentation', content


def split_chunks(page: dict) -> list[dict]:
    """Split at headings/newlines with overlap; retain code/list text verbatim."""
    import re
    sections, lines, headings, fenced = [], [], {}, False
    for line in page['content'].splitlines(keepends=True):
        if line.lstrip().startswith(('```', '~~~')):
            fenced = not fenced
        match = re.match(r'^(#{1,6})\s+(.+?)\s*$', line) if not fenced else None
        if match:
            if ''.join(lines).strip():
                sections.append((' > '.join(headings.values()), ''.join(lines)))
            level = len(match[1])
            headings = {k: v for k, v in headings.items() if k < level}
            headings[level] = match[2]
            lines = [line]
        else:
            lines.append(line)
    if ''.join(lines).strip():
        sections.append((' > '.join(headings.values()), ''.join(lines)))
    chunks = []
    for section, text in sections:
        offset = 0
        while offset < len(text):
            end = min(offset + 1800, len(text))
            if end < len(text):
                boundary = text.rfind('\n', offset + 900, end)
                if boundary > offset:
                    end = boundary + 1
            body = text[offset:end].strip()
            if len(body) >= 80:
                digest = hashlib.sha256((page['url'] + '\n' + section + '\n' + body).encode()).hexdigest()[:32]
                chunks.append({k: page[k] for k in ['url', 'title', 'product', 'crawled_at']} | {'section': section, 'text': body, 'digest': digest})
            if end >= len(text):
                break
            offset = max(offset + 1, end - 180)
    return chunks


def check() -> None:
    manifest = json.loads((CORPUS / 'manifest.json').read_text(encoding='utf-8'))
    chunks = [json.loads(line) for line in (CORPUS / 'chunks.jsonl').read_text(encoding='utf-8').splitlines() if line]
    if not 1 <= len(chunks) <= 750 or manifest['chunks'] != len(chunks) or not 1 <= manifest['pages'] <= 30:
        raise ValueError('Invalid corpus size')
    if manifest['embeddingModel'] != MODEL or manifest['dimensions'] != 1024:
        raise ValueError('Incompatible embedding configuration')
    if len({c['id'] for c in chunks}) != len(chunks):
        raise ValueError('Duplicate chunk IDs')
    sources = json.loads((CORPUS / 'sources.json').read_text(encoding='utf-8'))
    prefixes = {service['product']: service['prefix'] for service in sources['services']}
    for chunk in chunks:
        safe_url(chunk['url'], prefixes[chunk['product']])
        if chunk.get('fixture') or not chunk['crawled_at'] or not chunk['id'].startswith(manifest['version'] + ':'):
            raise ValueError('Fixture or incompatible chunk in production corpus')
        if len(chunk['text']) > 1800 or not chunk['text'].strip():
            raise ValueError('Invalid chunk text')
    digest = hashlib.sha256('\n'.join(json.dumps(c, sort_keys=True, ensure_ascii=False) for c in chunks).encode()).hexdigest()
    if digest != manifest['chunksSha256']:
        raise ValueError('Corpus checksum mismatch')
    print(f"Verified {manifest['pages']} pages / {manifest['chunks']} real chunks, {manifest['version']}")


def collect(refresh: bool) -> None:
    sources = json.loads((CORPUS / 'sources.json').read_text(encoding='utf-8'))
    entries = [(service, path) for service in sources['services'] for path in service['pages']]
    if len(entries) > 30:
        raise ValueError('The seed manifest exceeds 30 pages')
    CACHE.mkdir(parents=True, exist_ok=True)
    pages, parsers, failures = [], {}, []
    with httpx.Client(timeout=25, headers={'User-Agent': USER_AGENT, 'Accept': 'text/html,text/plain'}) as client:
        def allowed(url):
            host = urlsplit(url).hostname
            if host not in parsers:
                parser = RobotFileParser()
                try:
                    _, robots = fetch(client, f'https://{host}/robots.txt')
                    parser.parse(robots.splitlines())
                except httpx.HTTPStatusError as error:
                    parser.parse([] if error.response.status_code == 404 else ['User-agent: *', 'Disallow: /'])
                except (ValueError, httpx.HTTPError):
                    parser.parse(['User-agent: *', 'Disallow: /'])
                parsers[host] = parser
            return parsers[host].can_fetch(USER_AGENT, url)
        for service, path in entries:
            url = safe_url('https://docs.cloud.google.com' + path, service['prefix'])
            cached = CACHE / (hashlib.sha256(url.encode()).hexdigest() + '.json')
            try:
                if cached.exists() and not refresh:
                    page = json.loads(cached.read_text(encoding='utf-8'))
                    safe_url(page['url'], service['prefix'])
                else:
                    time.sleep(1)
                    final, html = fetch(client, url, service['prefix'], allowed)
                    title, content = extract(html)
                    page = {'url': final, 'title': title, 'product': service['product'], 'content': content,
                            'crawled_at': datetime.now(timezone.utc).isoformat(), 'fixture': False}
                    cached.write_text(json.dumps(page, ensure_ascii=False), encoding='utf-8')
                pages.append(page)
                print('Collected', service['product'], page['url'])
            except (ValueError, httpx.HTTPError) as error:
                failures.append({'url': url, 'error': str(error)[:200]})
        if failures:
            print(json.dumps({'failed': failures}, indent=2), file=sys.stderr)
            raise ValueError('Incomplete collection; previous version was not overwritten')
    chunks = [chunk for page in pages for chunk in split_chunks(page)]
    # Never silently discard sources to squeeze under a quota.
    if len(chunks) > 750:
        raise ValueError(f'{len(chunks)} chunks exceeds the cap; explicitly narrow the seed manifest')
    unique = {c['digest']: c for c in chunks}
    signature = hashlib.sha256('\n'.join(sorted(unique)).encode()).hexdigest()
    version = 'docs-' + signature[:12]
    chunks = [dict(id=version + ':' + digest, version=version, **{k:v for k,v in c.items() if k != 'digest'}) for digest,c in sorted(unique.items())]
    digest = hashlib.sha256('\n'.join(json.dumps(c, sort_keys=True, ensure_ascii=False) for c in chunks).encode()).hexdigest()
    manifest = {'version': version, 'manifestSha': signature, 'chunksSha256': digest, 'embeddingModel': MODEL, 'dimensions': 1024,
                'services': [s['product'] for s in sources['services']], 'pages': len(pages), 'chunks': len(chunks),
                'collectedAt': max(p['crawled_at'] for p in pages), 'fixture': False,
                'sources': [{'url':p['url'],'title':p['title'],'product':p['product'],'crawled_at':p['crawled_at'],
                             'sha256':hashlib.sha256(p['content'].encode()).hexdigest()} for p in pages]}
    (CORPUS / 'chunks.jsonl').write_text('\n'.join(json.dumps(c, ensure_ascii=False) for c in chunks) + '\n', encoding='utf-8')
    (CORPUS / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    check()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--collect', action='store_true', help='Explicitly collect only fixed official seeds')
    parser.add_argument('--refresh', action='store_true', help='Re-fetch cached pages during collection')
    args = parser.parse_args()
    try:
        collect(args.refresh) if args.collect else check()
    except (ValueError, OSError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
