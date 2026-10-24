"""Explicit routing, bounded evidence and genuine read-only demo MCP calls."""
import asyncio
import json
import re
import unicodedata
from storage.bucket_storage import canonical_url
from config.config import Settings, get_settings
from demo_mcp.client import DemoClient
from rag.generator import Generator


def normalize(text):
    return "".join(c for c in unicodedata.normalize("NFKD", text.lower()) if not unicodedata.combining(c))


def portuguese(text):
    return bool(re.search(r"\b(o que|como|qual|quais|meu|minha|meus|minhas|liste|listar|explique|existe|tabela|preciso|voce|isso|ele|ela|criar|nao|e os|e as|quanto|configuro)\b", normalize(text)))


def tool_route(question):
    q = normalize(question)
    first_request = re.split(r"\s+(?:and|e)\s+(?:explain|explique|describe|descreva|how|como|why|por que)\b", q)[0]
    # Technical questions mentioning operations are documentation questions.
    # A historical inventory request must not turn a follow-up about pricing into a tool call.
    if re.search(r"\b(iam|roles?|permissoes|permissions?|praticas|practices|pricing|precos?|custos?|how|como|why|por que)\b", first_request):
        return None
    action = (re.match(r"\s*(?:(?:please|por favor)[, ]+)?(?:list|show|check|liste|listar|mostre|verifique|verificar|consulte)\b", q)
              or re.search(r"\b(my|our|meu|minha|meus|minhas|exists|existe|existem)\b", q)
              or re.match(r"\s*(?:quais|which)\s+(?:demo\s+)?(?:buckets|vms|datasets|instances|instancias|virtual machines)\b", q))
    if not action:
        return None
    table = re.search(r"\b([a-zA-Z_][\w-]*)\.([a-zA-Z_][\w-]*)\b", question)
    if re.search(r"\b(table|tabela)\b", q) and table:
        return "check_table", {"dataset": table[1], "table": table[2]}
    if re.search(r"\b(bucket|buckets)\b", q):
        name = re.search(r"\bdemo-[a-z0-9-]+\b", q)
        if name and re.search(r"\b(public|publico|acesso|access|check|verifique)\b", q):
            return "check_bucket_access", {"bucket": name[0]}
        return "list_buckets", {}
    if re.search(r"\b(vms?|instances?|machines?|instancias?|maquinas?|compute engine)\b", q):
        return "list_vms", {}
    if re.search(r"\b(datasets?|bigquery|tabelas?|tables?)\b", q):
        return "list_datasets", {}
    return None


def contextual_question(question, history):
    q = normalize(question.strip())
    if len(q.split()) < 16 and re.search(r"\b(it|its|them|that|this|those|isso|ele|ela|eles|elas|disso|deles|desses)\b|^(e |and |what about|how about)", q):
        previous = next((m["content"] for m in reversed(history or []) if m.get("role") == "user"), "")
        if previous:
            return previous[:1500] + "\nFollow-up: " + question
    return question


class Pipeline:
    def __init__(self, settings: Settings | None = None, retriever=None, generator=None, mcp=None):
        self.settings = settings or get_settings()
        if retriever is None:
            from rag.retriever import Retriever
            retriever = Retriever(self.settings)
        self.retriever = retriever
        self.generator = generator or Generator(self.settings)
        self.mcp = mcp or DemoClient(self.settings)

    async def run(self, question, history=None):
        history = (history or [])[-self.settings.max_history_messages:]
        query = contextual_question(question, history)
        pt = portuguese(question) or (query != question and portuguese(query))
        route = tool_route(question)
        if route is None and query != question and re.match(r"\s*(?:please\s+)?(?:show|list|check|liste|mostre|verifique)\b", normalize(question)):
            route = tool_route(query)
        wants_explanation = bool(re.search(r"\b(explain|why|how|explique|explique-me|por que|como|o que significa)\b", normalize(question)))
        demo_text = ""
        if route:
            result = await self.mcp.call(*route)
            label = "Demonstração: recursos fictícios, sem acesso ao GCP real." if pt else "Demonstration: fictional resources; no real GCP access."
            demo_text = label + "\n\n```json\n" + json.dumps(result, ensure_ascii=False, indent=2) + "\n```"
            if not wants_explanation:
                return {"answer": demo_text, "sources": [], "mode": "mcp", "simulated": True}
        if query == question and re.fullmatch(r"(como (configuro|faco|uso) (isso|ele|ela)\??|how (do i|to) (configure|use) (it|this)\??|e agora\??|and now\??)", normalize(question).strip()):
            return {"answer": "Qual serviço GCP e qual objetivo você quer configurar?" if pt else "Which GCP service and task do you want to configure?", "sources": [], "mode": "clarification", "simulated": False}
        documents = await asyncio.to_thread(self.retriever.retrieve, query)
        if not documents:
            message = "Não encontrei evidências suficientes na documentação indexada. Especifique o serviço e o objetivo, ou atualize o índice." if pt else "I could not find sufficient evidence in the indexed documentation. Specify the service and goal, or update the index."
            return {"answer": (demo_text + "\n\n" if demo_text else "") + message, "sources": [], "mode": "hybrid" if route else "insufficient_evidence", "simulated": bool(route)}
        context, sources = [], []
        used_chars = 0
        for doc in documents:
            try:
                url = canonical_url(doc.metadata.get("source_url", ""))
            except (ValueError, TypeError):
                continue
            sid = f"S{len(sources) + 1}"
            title = str(doc.metadata.get("title", doc.metadata.get("product", "GCP documentation")))
            header = f"[{sid}] {title}\nSection: {doc.metadata.get('section', '')}\n"
            budget = self.settings.max_context_chars - used_chars - len(header) - 2
            if budget < 200:
                break
            block = header + doc.page_content[:budget]
            context.append(block)
            used_chars += len(block) + 2
            sources.append({"id": sid, "title": title, "url": url, "product": doc.metadata.get("product") or "", "section": doc.metadata.get("section") or "", "crawled_at": doc.metadata.get("crawled_at") or ""})
        if not sources:
            return {"answer": "As evidências disponíveis não possuem fontes oficiais verificáveis." if pt else "The available evidence has no verifiable official sources.", "sources": [], "mode": "insufficient_evidence", "simulated": bool(route)}
        answer = await asyncio.to_thread(self.generator.generate_with_context, "\n\n".join(context), question, history)
        referenced = set(re.findall(r"\[(S\d+)\]", answer))
        known = {s["id"] for s in sources}
        if not referenced or not referenced <= known:
            answer = "Não foi possível produzir uma resposta com citações verificáveis. Reformule a pergunta ou atualize a documentação." if pt else "I could not produce an answer with verifiable citations. Rephrase the question or update the documentation."
            return {"answer": (demo_text + "\n\n" if demo_text else "") + answer, "sources": [], "mode": "hybrid" if route else "insufficient_evidence", "simulated": bool(route)}
        return {"answer": (demo_text + "\n\n" if demo_text else "") + answer, "sources": [s for s in sources if s["id"] in referenced], "mode": "hybrid" if route else "rag", "simulated": bool(route)}
