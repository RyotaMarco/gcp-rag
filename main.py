from scraping.scraping import GCPDocsCrawler
from rag.ingestion import Ingestion
from rag.pipeline import Pipeline
import asyncio
import argparse

parser = argparse.ArgumentParser()
parser.add_argument("--setup", action="store_true")


async def main():
    args = parser.parse_args()
    if args.setup:
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
        print("Ingestion process completed successfully.")
    else:
        pipeline = Pipeline()
        while True:
            ask = input("\nAsk a question (or 'exit' to quit): ")
            if ask.lower() == 'exit':
                break
            response = pipeline.run(ask)
            print(f"\n{response}")
if __name__ == "__main__":
    asyncio.run(main())