from crawl4ai import *
from config.config import Config


class GCPDocsCrawler:
    def __init__(self, config: type[Config] = Config) -> None:
        self.base_url = config.BASE_URL
        self.gcp_services = config.GCP_SERVICES

    async def crawl_gpc_docs(self, endpoint: str):
        service_url = f"{self.base_url}/{endpoint}"

        base_path = "/".join(endpoint.split("/")[:2])
        allowed_base = f"{self.base_url}/{base_path}"

        run_config = CrawlerRunConfig(
            excluded_tags=['li', 'ul', 'picture'],
            deep_crawl_strategy=BFSDeepCrawlStrategy(
                max_depth=2,
                max_pages=50,
                filter_chain=FilterChain([
                    URLPatternFilter(patterns=[f"{allowed_base}*"])
                ])
            ),
            markdown_generator=DefaultMarkdownGenerator(
                content_filter=PruningContentFilter(threshold=0.5)
            )
        )
        skip_urls = {
            'https://docs.cloud.google.com',
            'https://console.cloud.google.com',
            'https://docs.cloud.google.com/docs',
        }

        async with AsyncWebCrawler() as crawler:
            results = await crawler.arun(url=service_url, config=run_config)

            for result in results:
                if not result.url.startswith(allowed_base):
                    continue
                if any(result.url.startswith(skip) for skip in skip_urls):
                    continue

                print(f"URL: {result.url}")
                print(result.markdown.fit_markdown)