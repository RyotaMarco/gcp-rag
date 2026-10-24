"""Bounded, robots-aware crawler preserving Markdown lists and code examples."""
import asyncio
from collections import deque
from datetime import datetime, timezone
import logging
from urllib.parse import urljoin, urlsplit
from urllib.robotparser import RobotFileParser
import httpx
from bs4 import BeautifulSoup
from markdownify import markdownify
from config.config import Settings, get_settings
from scraping.services import SERVICES
from storage.bucket_storage import DocumentStorage, canonical_url

logger = logging.getLogger(__name__)
USER_AGENT = "GCPDocsAssistant/2.0 (+https://github.com/RyotaMarco/gcp-rag)"


def extract_markdown(html: str) -> tuple[str, str, list[str]]:
    soup = BeautifulSoup(html, "html.parser")
    article = soup.select_one("article") or soup.select_one("main") or soup.body or soup
    for node in article.select("script,style,nav,aside,footer,header,devsite-actions,devsite-feature-tooltip,.devsite-feedback-positioner,.nocontent"):
        node.decompose()
    title = article.find("h1")
    title_text = title.get_text(" ", strip=True) if title else "Google Cloud documentation"
    links = [link.get("href", "") for link in article.find_all("a", href=True)]
    content = markdownify(str(article), heading_style="ATX", bullets="-", strip=["img"])
    return title_text, content.strip(), links


class GCPDocsCrawler:
    def __init__(self, settings: Settings | None = None, storage=None, client=None):
        self.settings = settings or get_settings()
        self.storage = storage or DocumentStorage(self.settings)
        self.client = client
        self.gcp_services = [{"product": product, "url": url} for product, url in SERVICES]
        self._robots = {}

    async def _get(self, client, url: str, respect_robots: bool = False):
        for _ in range(6):
            canonical_url(url)
            if respect_robots and not await self._allowed(client, url):
                raise ValueError("Redirect target blocked by robots.txt")
            response = await client.get(url, follow_redirects=False)
            if response.is_redirect:
                url = urljoin(url, response.headers.get("location", ""))
                canonical_url(url)
                continue
            response.raise_for_status()
            return response
        raise ValueError("Too many documentation redirects")

    async def _allowed(self, client, url: str) -> bool:
        host = urlsplit(url).netloc
        if host not in self._robots:
            parser = RobotFileParser()
            robots_url = f"https://{host}/robots.txt"
            try:
                response = await self._get(client, robots_url)
                parser.parse(response.text.splitlines())
            except httpx.HTTPStatusError as error:
                parser.parse([] if error.response.status_code == 404 else ["User-agent: *", "Disallow: /"])
            except (httpx.HTTPError, ValueError):
                parser.parse(["User-agent: *", "Disallow: /"])
            self._robots[host] = parser
        return self._robots[host].can_fetch(USER_AGENT, url)

    async def crawl_gpc_docs(self, service: dict, max_pages: int | None = None) -> dict:
        if self.client is not None:
            return await self._crawl(self.client, service, max_pages)
        async with httpx.AsyncClient(timeout=self.settings.request_timeout, headers={"User-Agent": USER_AGENT}) as client:
            return await self._crawl(client, service, max_pages)

    async def _crawl(self, client, service: dict, max_pages: int | None):
        seed = canonical_url(service["url"])
        prefix = urlsplit(seed).path.rstrip("/")
        queue, visited = deque([(seed, 0)]), set()
        summary = {"product": service["product"], "saved": 0, "failed": 0, "skipped": 0}
        while queue and len(visited) < (max_pages or self.settings.crawl_max_pages):
            url, depth = queue.popleft()
            if url in visited:
                continue
            visited.add(url)
            if not await self._allowed(client, url):
                summary["skipped"] += 1
                continue
            try:
                response = await self._get(client, url, respect_robots=True)
                final = canonical_url(str(response.url))
                final_path = urlsplit(final).path
                # Product documentation can move between official Google paths.
                # Adopt the validated seed redirect once, then keep traversal bounded.
                if url == seed and depth == 0:
                    prefix = final_path.rstrip("/")
                if not (final_path == prefix or final_path.startswith(prefix + "/")):
                    summary["skipped"] += 1
                    continue
                if "text/html" not in response.headers.get("content-type", ""):
                    summary["skipped"] += 1
                    continue
                title, content, links = extract_markdown(response.text)
                if not content:
                    summary["skipped"] += 1
                    continue
                self.storage.save(content, {"source_url": final, "title": title,
                    "product": service["product"], "category": "AI/ML",
                    "crawled_at": datetime.now(timezone.utc).isoformat()})
                summary["saved"] += 1
                if depth < 2:
                    for link in links:
                        try:
                            target = canonical_url(urljoin(final, link))
                        except ValueError:
                            continue
                        path = urlsplit(target).path
                        if (path == prefix or path.startswith(prefix + "/")) and target not in visited:
                            queue.append((target, depth + 1))
            except (httpx.HTTPError, ValueError):
                summary["failed"] += 1
                logger.exception("Failed to crawl %s", url)
            await asyncio.sleep(self.settings.crawl_delay)
        return summary

    async def run(self, services: str | None = None, max_pages: int | None = None):
        selected = self.gcp_services
        if services:
            terms = [term.strip().casefold() for term in services.split(",")]
            selected = [service for service in selected if service["product"].casefold() in terms]
            if not selected:
                raise ValueError("No matching service; use a product name from scraping/services.py")
        return [await self.crawl_gpc_docs(service, max_pages=max_pages) for service in selected]
