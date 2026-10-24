"""HTTP boundary: start without a key/index and expose actionable readiness."""
import asyncio
from contextlib import asynccontextmanager
import logging
from typing import Literal
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator
from config.config import Settings, get_settings
from rag.errors import AssistantError
from rag.pipeline import Pipeline

log = logging.getLogger(__name__)

class Message(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=2000)

class Question(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question: str = Field(min_length=1, max_length=2000)
    history: list[Message] = Field(default_factory=list, max_length=12)

    @field_validator("question")
    @classmethod
    def not_blank(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("A pergunta não pode estar vazia")
        return value

class Source(BaseModel):
    id: str
    title: str
    url: str
    product: str = ""
    section: str = ""
    crawled_at: str = ""

class Answer(BaseModel):
    answer: str
    sources: list[Source] = Field(default_factory=list)
    mode: Literal["rag", "mcp", "hybrid", "clarification", "insufficient_evidence"]
    simulated: bool = False


def create_app(settings=None, pipeline=None):
    @asynccontextmanager
    async def lifespan(app):
        app.state.settings = settings or get_settings()
        app.state.pipeline = pipeline or Pipeline(app.state.settings)
        app.state.gate = asyncio.Semaphore(2)
        yield
        retriever = app.state.pipeline.retriever
        client = getattr(retriever, "client", None)
        if client is not None:
            client.close()

    app = FastAPI(title="GCP AI Assistant", version="2.0.0", root_path="/api", lifespan=lifespan)

    @app.exception_handler(AssistantError)
    async def assistant_error(request: Request, exc: AssistantError):
        detail = {"code": exc.code, "message": exc.message}
        headers = {}
        if exc.retry_after is not None:
            detail["retry_after"] = exc.retry_after
            headers["Retry-After"] = str(exc.retry_after)
        return JSONResponse(status_code=exc.status_code, content={"detail": detail}, headers=headers)

    @app.get("/health/live")
    def live():
        return {"status": "ok"}

    @app.get("/health/ready")
    async def ready(request: Request):
        pipe = request.app.state.pipeline
        config = request.app.state.settings
        issues = []
        try:
            status = await asyncio.to_thread(pipe.retriever.status)
            qdrant = bool(status.get("qdrant", True))
            index = bool(status.get("index_ready"))
            if not index:
                issues.append(status.get("detail") or "Índice vazio ou incompatível. Execute a ingestão.")
        except Exception:
            status, qdrant, index = {}, False, False
            issues.append("Qdrant indisponível. Verifique o serviço qdrant.")
        mcp = await pipe.mcp.healthy()
        checks = {"qdrant": qdrant, "index": index, "provider_configured": bool(config.groq_api_key), "mcp": mcp}
        if not config.groq_api_key:
            issues.append("Configure GROQ_API_KEY no backend. MCP demonstrativo disponível sem chave.")
        if not mcp:
            issues.append("MCP demonstrativo indisponível.")
        ok = all(checks.values())
        return JSONResponse(status_code=200 if ok else 503, content={"status": "ready" if ok else "not_ready", "checks": checks, "indexed_chunks": status.get("indexed_chunks", 0), "issues": issues})

    @app.post("/ask/", response_model=Answer)
    async def ask_question(question: Question, request: Request):
        try:
            async with request.app.state.gate:
                return await request.app.state.pipeline.run(question.question, [m.model_dump() for m in question.history])
        except AssistantError:
            raise
        except Exception as exc:
            log.error("Question processing failed (%s)", type(exc).__name__)
            raise AssistantError("retrieval_unavailable", "Não foi possível consultar o índice. Verifique os serviços e execute a ingestão.") from exc

    return app

app = create_app()
