# GCP AI Assistant

Assistente instalável para perguntas técnicas sobre Google Cloud, com RAG sobre documentação oficial, fontes verificáveis e ferramentas MCP de demonstração. Interface em português; perguntas em português e inglês.

**Stack:** React + NGINX → FastAPI → Qdrant/embeddings multilíngues locais → Groq. Um servidor MCP separado consulta recursos fictícios. Docker Compose mantém documentos, vetores e modelos em volumes persistentes. A aplicação inicia sem índice e sem chave; informa o que falta e permite testar o MCP.

## Instalação

Requisitos: Git, Docker Engine/Desktop com Compose v2 e conexão para baixar imagens, modelos e documentação. A geração ocorre por API; GPU não é obrigatória. Reserve memória e disco para PyTorch, embeddings e reranker; o primeiro download é maior que os seguintes.

```bash
git clone https://github.com/RyotaMarco/gcp-rag.git
cd gcp-rag
cp .env.example .env
# Windows PowerShell: Copy-Item .env.example .env
```

Edite `.env`: configure `GROQ_API_KEY` de uma conta Groq Free sua. O padrão `GROQ_MODEL=openai/gpt-oss-20b` usa exclusivamente a API da Groq, sem conta OpenAI. Não coloque a chave no código, frontend ou Git. Sem chave, as ferramentas MCP demonstrativas continuam disponíveis.

```bash
docker compose config --quiet
docker compose up --build --detach --wait
```

Abra [http://localhost:8080](http://localhost:8080). A porta é configurável em `HTTP_PORT`. O bind padrão `127.0.0.1` atende a instalação local; API, MCP e Qdrant não publicam portas próprias. A stack é instalável em um host escolhido pelo operador, sem depender do computador do autor.

### Preparar a documentação

Coleta e indexação são comandos de manutenção; nunca rodam no startup da API.

```bash
# Comece por um serviço e uma coleta limitada:
docker compose --profile tools run --rm ingest setup --services "Vertex AI" --max-pages 10
# Ou colete todos os serviços configurados, respeitando limites e robots.txt:
docker compose --profile tools run --rm ingest setup
```

A primeira ingestão baixa os modelos locais no volume `models`. O crawler preserva listas e código, limita profundidade/páginas, respeita robots.txt e só admite fontes oficiais permitidas. Uma falha é registrada e o comando retorna erro; consulte o resumo antes de considerar a preparação concluída.

A prontidão total só aparece quando há índice compatível, configuração de provedor, Qdrant e MCP disponíveis. Chave configurada não significa que sua autenticação/cota foi testada: isso só é confirmado ao gerar uma resposta real.

```bash
curl http://localhost:8080/api/health/live
curl http://localhost:8080/api/health/ready
curl -X POST http://localhost:8080/api/ask/ -H "Content-Type: application/json" -d '{"question":"Como funciona o Vertex AI?"}'
```

`/health/ready` devolve HTTP 503 enquanto faltar algum requisito. Isso não derruba a aplicação. A interface apresenta os motivos e a contagem real do índice.

## Respostas e ferramentas

- Embeddings multilíngues `intfloat/multilingual-e5-small`, busca semântica + BM25 e reordenação local com `cross-encoder/mmarco-mMiniLMv2-L12-H384-v1`.
- Trechos preservam URL, produto, título, seção e data de coleta. Respostas técnicas citam identificadores associados a fontes oficiais.
- Contexto e histórico têm limites configuráveis; perguntas curtas de continuidade recuperam contexto anterior do usuário.
- Quando faltam evidências, o assistente informa a limitação ou pede esclarecimento. A validação de referências reduz citações inventadas, mas não prova que cada afirmação esteja correta: revise o relatório de avaliação.
- Documentos e histórico são tratados como dados não confiáveis, sem execução de instruções encontradas neles.

O MCP é um servidor real, com protocolo MCP e ferramentas somente de leitura. **Os dados são sempre fictícios**; não há credencial GCP nem acesso à sua conta de nuvem.

Exemplos: `Liste os buckets do projeto demo.`, `List the virtual machines in the demo project.`, `Liste os datasets do BigQuery no projeto demo.` O resultado é marcado como demonstração. Perguntas que pedem recursos e explicação combinam MCP com RAG quando a documentação indexada sustenta a explicação.

### API

A API mantém `POST /ask/` e `answer`. Pelo NGINX, use `/api/ask/`.

```json
{
  "question": "E como funcionam as versões?",
  "history": [
    {"role": "user", "content": "Explique o Vertex AI Model Registry."},
    {"role": "assistant", "content": "Ele organiza modelos registrados."}
  ]
}
```

A resposta acrescenta `sources`, `mode` e `simulated`. Cada fonte tem `id`, `title`, `url`, `product`, `section` e `crawled_at`. Os modos são `rag`, `mcp`, `hybrid`, `clarification` e `insufficient_evidence`. Erros operacionais usam `detail.code` e `detail.message`; limites incluem `Retry-After`. A documentação interativa está em `/api/docs`.

## Custos e configuração

Não há serviços pagos obrigatórios de armazenamento, busca ou embeddings. A aplicação não contrata hospedagem nem garante hospedagem gratuita. Hardware, energia e servidor são do operador. Na Groq Free, o uso é sujeito às cotas e aos modelos disponíveis para sua conta.

- O código não faz upgrade de plano nem troca automaticamente para provedor/modelo pago.
- HTTP 429 interrompe a geração; o tempo informado pelo provedor é respeitado e exibido. Não há retentativas automáticas.
- Para declarar uso pago, configure `API_PLAN=paid` **e** `ALLOW_PAID_API=true`. Essa dupla configuração explicita a intenção do operador.
- **O aplicativo não consegue descobrir o plano de cobrança de uma chave.** `API_PLAN=free` não impede cobrança se a chave já pertencer a uma conta paga. Confirme o plano no console do provedor.
- Não há login multiusuário nem gestão de chaves no navegador. Hospedagem pública compartilhada e controle de usuários estão fora desta versão.

Consulte [limites da Groq](https://console.groq.com/docs/rate-limits), [modelos](https://console.groq.com/docs/models) e [cobrança](https://console.groq.com/docs/billing-faqs). Não presuma as antigas cotas fixas descritas na versão inicial deste projeto.

As opções estão em `.env.example`: modelo, limites de contexto/saída/histórico, timeout, quantidade de resultados, limiar de relevância, páginas e intervalo de coleta. O backend lê os segredos. Após editar o ambiente, recrie os contêineres com `docker compose up -d`.

## Atualização, operação e testes

O [guia operacional](docs/OPERATIONS.md) descreve atualização incremental, reconstrução, backup, restauração e falhas comuns.

```bash
python -m pip install -r requirements-dev.txt
python -m pytest -q
python -m evaluation.run --mode fixture --output evaluation-report.json
cd frontend
npm ci
npm test -- --run
npm run lint
npm run build
```

O benchmark tem 42 casos em português e inglês e gate de Hit@5 de 85% nas perguntas respondíveis. `fixture` usa modelos de teste determinísticos: **não mede qualidade de modelos reais**. `--mode real` executa os modelos locais sobre o mesmo corpus pequeno e curado. A comparação é busca semântica versus híbrida com o mesmo embedding. Veja [metodologia e limites](evaluation/README.md) e [relatório de validação](docs/TEST_REPORT.md).

O workflow `.github/workflows/ci.yml` testa backend, frontend e instalação real via Compose sem segredo de API. O smoke verifica índice vazio, ingestão, MCP, reingestão e persistência após reinício. Geração Groq real exige credencial e é reportada separadamente; os testes automatizados não fazem chamadas faturáveis.
