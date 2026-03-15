from crawl4ai import *
from config.config import Config
from urllib.parse import urlsplit
from storage.bucket_storage import BucketStorage
from crawl4ai.deep_crawling.filters import FilterChain, URLPatternFilter


class GCPDocsCrawler:
    def __init__(self, config: type[Config] = Config, bucket: BucketStorage = BucketStorage()) -> None:
        self.base_url = config.BASE_URL
        self.gcp_services = config.GCP_SERVICES
        self.bucket = bucket
        self.raw_bucket_name = config.RAW_BUCKET_NAME

    async def crawl_gpc_docs(self, service: dict) -> None:
        """
        Crawl GCP docs for a specific service and upload the results to the bucket in Markdown format
        parameters:
            service: Service to crawl
        """
        endpoint = service["endpoint"]
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

        async with AsyncWebCrawler() as crawler:
            results = await crawler.arun(url=service_url, config=run_config)

            existing_files = set(self.bucket.list_files(self.raw_bucket_name))

            for result in results:
                if not result.url.startswith(allowed_base):
                    continue

                parts = urlsplit(result.url).path.strip("/").split("/")
                if "docs" in parts:
                    parts.remove("docs")
                file_name = "/".join(parts) + ".md"

                if file_name in existing_files:
                    continue


                content = result.markdown.fit_markdown if result.markdown else ""
                if not content.strip():
                    continue

                self.bucket.upload_file(
                    content=content,
                    file_name=file_name,
                    metadata={
                        "source_url": result.url,
                        "product": service["product"],
                        "category": service["category"],
                        "subcategory": service["subcategory"],
                    }
                )