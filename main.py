from scraping.scraping import GCPDocsCrawler
import asyncio

async def main():
    crawler = GCPDocsCrawler()
    for endpoint in crawler.gcp_services:
        await crawler.crawl_gpc_docs(endpoint["endpoint"])

if __name__ == "__main__":
    asyncio.run(main())

