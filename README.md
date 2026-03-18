# GCP AI Copilot — RAG + MCP

> An AI Engineering portfolio project that combines **Retrieval-Augmented Generation (RAG)** over official GCP documentation with a **Model Context Protocol (MCP)** server for real-time cloud resource interaction.

---

## Overview

This project implements an AI assistant for Google Cloud Platform engineers capable of:

1. **Answering technical questions** using official GCP documentation via semantic search
2. **Interacting with real cloud resources** (list VMs, buckets, datasets) via MCP

Built to demonstrate end-to-end AI Engineering skills across scraping, storage, embedding, retrieval, orchestration, and cloud integration.

---

## Architecture

```
User Question
      ↓
  FastAPI (POST /ask)
      ↓
  RAG Pipeline
  ├── Retriever → Qdrant (semantic search)
  │       ↓
  │   Top-K chunks + metadata
  │       ↓
  └── Generator → Groq/Llama (LLM response)
      
  Background Pipeline (--setup)
  ├── Scraping   → crawl4ai → LocalStack S3 (raw/)
  ├── Chunking   → LangChain MarkdownHeaderTextSplitter
  ├── Embedding  → sentence-transformers/all-MiniLM-L6-v2
  └── Indexing   → Qdrant
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Scraping | crawl4ai + BFSDeepCrawlStrategy |
| Object Storage | LocalStack S3 (S3-compatible) |
| Chunking | LangChain MarkdownHeaderTextSplitter + RecursiveCharacterTextSplitter |
| Embeddings | sentence-transformers/all-MiniLM-L6-v2 (local) |
| Vector Store | Qdrant |
| LLM | Groq — llama-3.3-70b-versatile |
| Orchestration | LangChain (LCEL) |
| API | FastAPI + Uvicorn |
| Infrastructure | Docker Compose |

---

## Project Structure

```
gcp-rag/
├── api/
│   └── main.py              # FastAPI endpoints
├── config/
│   └── config.py            # Environment configuration
├── rag/
│   ├── chunking.py          # Markdown chunking
│   ├── embedding.py         # Embedding model wrapper
│   ├── generator.py         # LLM response generation
│   ├── indexer.py           # Qdrant indexing
│   ├── ingestion.py         # Pipeline orchestration (scrape → chunk → embed → index)
│   ├── pipeline.py          # RAG pipeline (retrieve → generate)
│   └── retriever.py         # Qdrant semantic search
├── scraping/
│   └── scraping.py          # GCP docs crawler
├── storage/
│   └── bucket_storage.py    # S3/LocalStack storage layer
├── docker-compose.yml
├── main.py                  # Entry point
└── requirements.txt
```

---

## Getting Started

### Prerequisites

- Docker Desktop
- Python 3.11+
- Groq API key (free tier at [console.groq.com](https://console.groq.com))
- LocalStack Auth Token (free tier at [localstack.cloud](https://localstack.cloud))

### Setup

**1. Clone the repository**
```bash
git clone https://github.com/your-username/gcp-rag
cd gcp-rag
```

**2. Configure environment variables**
```bash
cp .env.example .env
# Fill in your API keys in .env
```

**3. Start infrastructure**
```bash
docker compose up -d
```

**4. Install dependencies**
```bash
pip install -r requirements.txt
```

**5. Run the scraping and ingestion pipeline**
```bash
python main.py --setup
```

**6. Start the API**
```bash
uvicorn api.main:app --reload
```

Or run the CLI interface:
```bash
python main.py
```

---

## Environment Variables

```bash
# LocalStack (S3)
LOCALSTACK_AUTH_TOKEN=your_token
LOCALSTACK_URL=http://localhost:4566
GCP_DOCS_BUCKET_NAME_RAW=gcp-doc-raw
GCP_DOCS_BUCKET_NAME_PROCESSED=gcp-doc-processed
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
AWS_DEFAULT_REGION=us-east-1

# Groq
GROQ_API_KEY=your_groq_api_key

# Qdrant
QDRANT_URL=http://localhost:6333
```

---

## Usage

### API

```bash
curl -X POST http://localhost:8000/ask \
  -H "Content-Type: application/json" \
  -d '{"question": "How does Vertex AI handle model versioning?"}'
```

Response:
```json
{
  "answer": "Vertex AI Model Registry allows you to..."
}
```

### CLI

```bash
python main.py

Ask a question (or 'exit' to quit): What is Vertex AI?
Vertex AI is a machine learning platform that allows you to train and deploy ML models...
```

---

## GCP Services Covered

The RAG pipeline covers **24 GCP AI/ML services** across 8 categories:

- **ML Platform** — Vertex AI, Vertex AI Generative AI
- **Generative AI** — Gemini API
- **Conversational AI** — Dialogflow CX/ES, Agent Builder, Agent Assist, Contact Center AI
- **Vision** — Cloud Vision API, Video Intelligence API, AutoML Vision, Vertex AI Vision
- **Natural Language** — Natural Language API, Cloud Translation, Healthcare NL AI
- **Speech** — Speech-to-Text, Text-to-Speech
- **Document AI** — Document AI
- **ML Infrastructure** — Cloud TPU, Deep Learning Containers, Deep Learning VM
- **Data for ML** — Timeseries Insights API, Recommendations AI, Vertex AI Search for Retail

---

## Roadmap

### Completed ✅

- [x] Web scraping of GCP AI/ML documentation (crawl4ai + BFS)
- [x] Raw document storage in LocalStack S3
- [x] Markdown chunking with header-aware splitting
- [x] Local embedding with sentence-transformers
- [x] Vector indexing in Qdrant
- [x] Pipeline state control (raw → processed buckets)
- [x] RAG pipeline (semantic retrieval + LLM generation)
- [x] CLI interface

### In Progress 🔧

- [ ] FastAPI REST endpoint (`POST /ask`)
- [ ] Docker Compose full integration (API container)

### Planned 📋

- [ ] MCP Server for real-time GCP resource interaction
  - [ ] Cloud Storage — list buckets, check public access
  - [ ] Compute Engine — list active VMs
  - [ ] BigQuery — list datasets, check table existence
- [ ] Intent Router (RAG vs MCP decision)
- [ ] Hybrid reasoning (RAG + MCP combined responses)
- [ ] RAG evaluation metrics (Precision@k, context relevance)
- [ ] LangSmith observability integration
- [ ] Re-ranking and multi-query retrieval improvements
- [ ] Cloud Run deployment guide

---

## Design Decisions

**Why LocalStack over MongoDB for raw storage?**
Object storage (S3) is the industry standard for data lake architectures. Using two buckets (`raw/` and `processed/`) provides clear pipeline state control without requiring a separate database.

**Why local embeddings (all-MiniLM-L6-v2) over API-based?**
Local embeddings eliminate external dependencies, rate limits, and costs for a portfolio project. The architecture is designed to swap embedding models with a single line change — demonstrating LangChain's abstraction benefits.

**Why LangChain?**
Higher visibility in AI Engineering job postings. The LCEL pipeline pattern demonstrates modern LLM orchestration skills valued by hiring teams.

**Why Groq/Llama over OpenAI?**
Generous free tier (14,400 RPD), no credit card required, and demonstrates vendor-agnostic LLM integration — a key skill for AI Engineering roles.

---

## Architecture Notes

This project is designed for **local development and portfolio demonstration**. In a production environment, the following changes would be applied:

- LocalStack → AWS S3 or Google Cloud Storage
- Local embeddings → Vertex AI `text-embedding-004` or similar
- Groq → Vertex AI Gemini or OpenAI GPT-4
- Docker Compose → Kubernetes or Cloud Run
- Pipeline state control → DynamoDB or Cloud Spanner

---

## Author

Built as an AI Engineering portfolio project demonstrating end-to-end LLM system design, from data ingestion to production-ready API.
