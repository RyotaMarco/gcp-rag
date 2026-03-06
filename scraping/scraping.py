import asyncio
from crawl4ai import *
from config.config import Config


class GCPDocsCrawler:
    def __init__(self, config: type[Config] = Config) -> None:
        self.base_url = config.BASE_URL
        self.gcp_services = config.GCP_SERVICES

    async def crawl_gpc_docs(self, endpoint: str):
        service_doc = f"{self.base_url}/{endpoint}"
        async with AsyncWebCrawler() as crawler:
            result = await crawler.arun(url=service_doc)
            print(result.markdown)