from scraping.scraping import GCPDocsCrawler
import asyncio

async def main():
    crawler = GCPDocsCrawler()
    for service in crawler.gcp_services:
        try:
            print(f"\n Crawling: {service['product']}")
            await crawler.crawl_gpc_docs(service)
        except Exception as e:
                print(f"Error crawling {service['product']}: {e}")

if __name__ == "__main__":
    asyncio.run(main())