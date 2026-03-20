# GCP AI Copilot — RAG + MCP

> An AI Engineering portfolio project that combines **Retrieval-Augmented Generation (RAG)** over official GCP documentation with a **Model Context Protocol (MCP)** server for real-time cloud resource interaction.

---

## Overview

This project implements an AI assistant for Google Cloud Platform engineers capable of:

1. **Answering technical questions** using official GCP documentation via semantic search
2. **Interacting with real cloud resources** (list VMs, buckets, datasets) via MCP — *in progress*

Built to demonstrate end-to-end AI Engineering skills across scraping, storage, embedding, retrieval, orchestration, and cloud integration.

---

## Architecture

```
User
  ↓
Frontend (React + NGINX)
  ↓
FastAPI (POST /ask)
  ↓
RAG Pipeline
├── Retriever → Qdrant (semantic search)
│       ↓
│   Top-K chunks + metadata
│       ↓
└── Generator → Groq/Llama (LLM response)

Background Pipeline (--setup flag)
├── Scraping   → crawl4ai → LocalStack S3 (raw bucket)
├── Chunking   → LangChain MarkdownHeaderTextSplitter
├── Embedding  → sentence-transformers/all-MiniLM-L6-v2
└── Indexing   → Qdrant (2594 vectors)
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Scraping | crawl4ai + BFSDeepCrawlStrategy |
| Object Storage | LocalStack S3 (S3-compatible, two buckets: raw/processed) |
| Chunking | LangChain MarkdownHeaderTextSplitter + RecursiveCharacterTextSplitter |
| Embeddings | sentence-transformers/all-MiniLM-L6-v2 (local, no API required) |
| Vector Store | Qdrant |
| LLM | Groq — llama-3.3-70b-versatile |
| Orchestration | LangChain (LCEL) |
| API | FastAPI + Uvicorn |
| Frontend | React + Vite + NGINX |
| Infrastructure | Docker Compose (4 containers) |

---

## Project Structure

```
gcp-rag/
├── api/
│   ├── main.py              # FastAPI endpoints + CORS
│   └── Dockerfile
├── config/
│   └── config.py            # Environment configuration (fail-fast pattern)
├── frontend/
│   ├── src/
│   │   └── App.jsx          # React chat interface (anime noir aesthetic)
│   └── Dockerfile
├── rag/
│   ├── chunking.py          # Markdown chunking strategy
│   ├── embedding.py         # HuggingFace embedding wrapper
│   ├── generator.py         # LLM response generation (LCEL pipeline)
│   ├── indexer.py           # Qdrant indexing
│   ├── ingestion.py         # Pipeline orchestration
│   ├── pipeline.py          # RAG pipeline (retrieve → generate)
│   └── retriever.py         # Qdrant semantic search
├── scraping/
│   └── scraping.py          # GCP docs crawler (BFS + URL filtering)
├── storage/
│   └── bucket_storage.py    # S3/LocalStack storage layer
├── docker-compose.yml
├── main.py                  # Entry point (--setup flag for ingestion)
├── requirements.txt
└── .env.example
```

---

## Getting Started

### Prerequisites

- Docker Desktop
- Python 3.11+ (for running setup pipeline)
- Groq API key — free at [console.groq.com](https://console.groq.com)
- LocalStack Auth Token — free at [localstack.cloud](https://localstack.cloud)

### 1. Clone and configure

```bash
git clone https://github.com/your-username/gcp-rag
cd gcp-rag
cp .env.example .env
# Fill in your API keys in .env
```

### 2. Start infrastructure

```bash
docker compose up -d
```

### 3. Run the scraping and ingestion pipeline

```bash
pip install -r requirements.txt
python main.py --setup
```

This will:
- Scrape 24 GCP AI/ML documentation endpoints
- Chunk and embed all documents locally
- Index ~2594 vectors into Qdrant
- Move processed files to the processed S3 bucket

### 4. Access the interface

Open [http://localhost:80](http://localhost:80) in your browser.

The FastAPI docs are available at [http://localhost:8000/docs](http://localhost:8000/docs).

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

## API

```bash
curl -X POST http://localhost:8000/ask/ \
  -H "Content-Type: application/json" \
  -d '{"question": "How does Vertex AI handle model versioning?"}'
```

Response:
```json
{
  "answer": "Vertex AI Model Registry allows you to..."
}
```

---

## GCP Services Covered

24 GCP AI/ML services across 8 categories:

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

- [x] Web scraping of GCP AI/ML documentation (crawl4ai + BFS + URL filtering)
- [x] Raw document storage in LocalStack S3 (two-bucket pipeline control)
- [x] Markdown chunking with header-aware splitting
- [x] Local embedding with sentence-transformers (no API rate limits)
- [x] Vector indexing in Qdrant (2594 chunks)
- [x] RAG pipeline (semantic retrieval + LLM generation via LCEL)
- [x] FastAPI REST endpoint with CORS support
- [x] React frontend with anime noir aesthetic
- [x] Full Docker Compose setup (4 containers)

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

---

## Design Decisions

**Why LocalStack over MongoDB for raw storage?**
Object storage (S3) is the industry standard for data lake architectures. Two buckets (`raw/` and `processed/`) provide clear pipeline state control without requiring a separate database. In production this would migrate to GCS or AWS S3 with no code changes beyond credentials.

**Why local embeddings (all-MiniLM-L6-v2)?**
Eliminates external dependencies, rate limits, and costs. The LangChain abstraction makes swapping to any embedding model a one-line change — demonstrating architectural flexibility.

**Why LangChain + LCEL?**
Higher visibility in AI Engineering job postings. The declarative pipeline pattern (`prompt | model`) demonstrates modern LLM orchestration skills valued by hiring teams.

**Why Groq/Llama over OpenAI or Gemini?**
Generous free tier (14,400 RPD), no credit card required, and demonstrates vendor-agnostic LLM integration — a key skill for AI Engineering roles.

---

## Production Considerations

This project is designed for local development and portfolio demonstration. In production:

| Component | Local | Production |
|---|---|---|
| Object Storage | LocalStack | AWS S3 / Google Cloud Storage |
| Embeddings | all-MiniLM-L6-v2 | Vertex AI text-embedding-004 |
| LLM | Groq/Llama | Vertex AI Gemini / OpenAI GPT-4 |
| Infrastructure | Docker Compose | Kubernetes / Cloud Run |
| Pipeline State | S3 buckets | DynamoDB / Cloud Spanner |

---

## Author

Built as an AI Engineering portfolio project demonstrating end-to-end LLM system design — from data ingestion to dockerized production-ready API with frontend.
