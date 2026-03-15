from scraping.scraping import GCPDocsCrawler
from rag.ingestion import Ingestion
import asyncio

async def main():
    crawler = GCPDocsCrawler()
    ingestion = Ingestion()
    for service in crawler.gcp_services:
        try:
            print(f"\n Crawling: {service['product']}")
            await crawler.crawl_gpc_docs(service)
        except Exception as e:
                print(f"Error crawling {service['product']}: {e}")
                continue

    print("Crawling process completed successfully.")
    ingestion.run()
if __name__ == "__main__":
    asyncio.run(main())