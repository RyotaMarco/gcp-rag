"""Operator commands. Crawling and indexing never run during API startup."""
import argparse
import asyncio
import json
import logging
from pathlib import Path
import sys
from config.config import get_settings


def parser():
    root = argparse.ArgumentParser(description="GCP AI Assistant maintenance")
    root.add_argument("command", nargs="?", choices=["setup", "crawl", "ingest", "status", "chat"], default="chat")
    root.add_argument("--setup", action="store_true", help="Compatibility alias for setup")
    root.add_argument("--rebuild", action="store_true", help="Rebuild only the configured v2 collection")
    root.add_argument("--services", help="Comma-separated exact product names, e.g. 'Vertex AI,Document AI'")
    root.add_argument("--max-pages", type=int)
    root.add_argument("--from-directory", type=Path, help="Import JSON documents containing content and metadata")
    return root


def main(argv=None) -> int:
    args = parser().parse_args(argv)
    settings = get_settings()
    command = "setup" if args.setup else args.command
    if args.max_pages is not None and args.max_pages <= 0:
        raise ValueError("--max-pages must be positive")
    if command == "status":
        from rag.retriever import Retriever
        print(json.dumps(Retriever(settings).status(), ensure_ascii=False, indent=2))
        return 0
    failed = False
    if args.from_directory:
        from storage.bucket_storage import DocumentStorage
        storage = DocumentStorage(settings)
        if not args.from_directory.is_dir():
            raise ValueError("--from-directory must be an existing directory")
        count = 0
        for item in storage.documents(args.from_directory):
            storage.save(item["content"], item["metadata"])
            count += 1
        if not count:
            raise ValueError("No JSON documents found in --from-directory")
    if command in {"setup", "crawl"} and not args.from_directory:
        from scraping.scraping import GCPDocsCrawler
        summaries = asyncio.run(GCPDocsCrawler(settings).run(services=args.services, max_pages=args.max_pages))
        print(json.dumps({"crawl": summaries}, ensure_ascii=False, indent=2))
        failed = any(summary["failed"] or not summary["saved"] for summary in summaries)
    if command in {"setup", "ingest"}:
        from rag.ingestion import Ingestion
        from rag.embedding import warm_models
        ingestion = Ingestion(settings)
        summary = ingestion.run(rebuild=args.rebuild)
        if summary["chunks"] and not summary["failed"]:
            warm_models(settings, embedding=ingestion.indexer.embedding)
            summary["models_ready"] = True
        print(json.dumps({"ingestion": summary}, ensure_ascii=False, indent=2))
        failed = failed or bool(summary["failed"]) or summary["chunks"] == 0
    if command == "chat":
        from rag.pipeline import Pipeline
        pipeline = Pipeline(settings)
        while True:
            question = input("Pergunta (exit para sair): ").strip()
            if question.lower() in {"exit", "quit", "sair"}:
                break
            if not question:
                continue
            result = pipeline.run(question)
            if hasattr(result, "__await__"):
                result = asyncio.run(result)
            print(json.dumps(result, ensure_ascii=False, indent=2) if isinstance(result, dict) else str(result))
    return int(failed)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    try:
        sys.exit(main())
    except (ValueError, RuntimeError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
