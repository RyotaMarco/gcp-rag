from crawl4ai import *
from config.config import Config


class GCPDocsCrawler:
    def __init__(self, config: type[Config] = Config) -> None:
        self.base_url = config.BASE_URL
        self.gcp_services = config.GCP_SERVICES

    async def crawl_gpc_docs(self, endpoint: str):
        service_url = f"{self.base_url}/{endpoint}"

        run_config = CrawlerRunConfig(
            excluded_tags=['li', 'lu', 'picture'],
            exclude_domains=['https://docs.cloud.google.com', 'https://console.cloud.google.com/freetrial?hl=pt-br','https://docs.cloud.google.com/free/docs/free-cloud-features?hl=pt-br#free-tier'],
            deep_crawl_strategy=BFSDeepCrawlStrategy(
                max_depth=2,
                max_pages=50
            ),
            markdown_generator = DefaultMarkdownGenerator(
                content_filter=PruningContentFilter(threshold=0.5)
            )
        )

        async with AsyncWebCrawler() as crawler:
            results = await crawler.arun(url=service_url, config=run_config)

            for result in results:
                if result.url == 'https://docs.cloud.google.com' or result.url == 'https://docs.cloud.google.com/talent-solution/job-search/docs?hl=pt-br' or result.url == 'https://docs.cloud.google.com/solutions/media-entertainment?hl=pt-br' or result.url == 'ttps://docs.cloud.google.com/telecom-subscriber-insights/docs?hl=pt-br' or  result.url == 'https://console.cloud.google.com/freetrial?hl=pt-br' or result.url == 'https://console.cloud.google.com?hl=pt-br' or result.url == 'https://docs.cloud.google.com/docs?hl=pt-br' or result.url == 'https://docs.cloud.google.com/docs/cross-product-overviews?hl=pt-br' or result.url == 'https://docs.cloud.google.com/free/docs/free-cloud-features?hl=pt-br':
                    continue
                print(f"URL: {result.url}")
                #print(result.markdown.fit_markdown)