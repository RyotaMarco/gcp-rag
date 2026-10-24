# Relatório de validação

Verificações executadas em 24/10/2026. Testes simulados e testes de serviços/modelos reais são descritos separadamente; nenhuma chamada Groq foi realizada.

## Resultados executados

| Verificação | Resultado | Escopo |
| --- | --- | --- |
| `python -m pytest -q` | **61 testes passaram** | Backend, armazenamento, ingestão, recuperação, API, geração HTTP simulada, handshake MCP real por HTTP e benchmark. |
| Testes frontend (`npm test -- --run`) | **8 testes passaram** | Comportamento da interface; respostas de API simuladas. |
| Frontend lint e build | **Passaram**, conforme validação da implementação | Build estático e análise do código. |
| Auditoria de dependências frontend | **0 vulnerabilidades reportadas** na execução | Estado da base de auditoria no momento do teste. |
| Recuperação `--mode fixture` | **32/32 Hit@5**, gate de 85% passou | Modelo de teste determinístico; não é qualidade neural. |
| Recuperação `--mode real` | **32/32 Hit@5**, gate de 85% passou | E5 multilíngue + crossencoder reais sobre 15 documentos curados. |
| Coleta HTTP real de documentação | **3 páginas salvas; 0 falhas** | Uma página de cada serviço: Vertex AI, Document AI e Cloud Translation. |

A coleta real de uma página de cada serviço Vertex AI, Document AI e Cloud Translation também passou (três páginas salvas, sem falhas). A interface foi verificada em Edge headless em desktop e celular de 390 px, sem overflow horizontal. Um segundo teste conectou a interface ao FastAPI, Qdrant persistente e MCP reais, sem interceptação da API: consultou VMs fictícias e exibiu corretamente o erro de chave Groq ausente.

### Benchmark

São **42 casos**: 30 perguntas de recuperação em português/inglês, duas perguntas de continuidade e dez casos de comportamento. Os dez casos de comportamento foram executados por testes parametrizados do pipeline real com I/O simulado: ambiguidade, ausência de evidência, consultas MCP e resposta híbrida. Não entram no denominador de recuperação.

O smoke determinístico resultou em Hit@5 de 100% para a baseline e a híbrida; MRR foi 0,9765625 e 1,0. A execução com modelos reais resultou em Hit@5 e MRR de 100% para ambas. **Não houve ganho mensurável de Hit@5 nesse corpus**. A baseline inicial usa o mesmo embedding E5 e isola o efeito da busca híbrida/reordenação.

A comparação `--mode real --compare-original` também foi executada: o MiniLM inglês original, sem prefixos, atingiu 32/32 Hit@5 e MRR 1,0, assim como a abordagem atual. O relatório está em `evaluation/before-after-report.json`; não houve ganho mensurável nesse corpus pequeno.

**Limites:** o corpus contém 15 paráfrases escritas como fixtures, com URLs de referência oficiais e `crawled_at: null`. Não é uma coleta completa ou atualizada da documentação. Esses resultados não estabelecem precisão em produção, correção das respostas geradas nem melhoria estatística geral. O relatório JSON registra modo, modelos, métricas e essa limitação. Casos usados para ajuste não devem substituir um conjunto independente de avaliação.

A coleta real foi executada por `GCPDocsCrawler(Settings(data_dir=Path('../live-docs-smoke'), crawl_delay=0)).run(services='Vertex AI,Document AI,Cloud Translation', max_pages=1)`, via Python/asyncio. Cada serviço retornou `saved=1`, `failed=0` e `skipped=0`. Os JSONs dessa verificação estão fora do repositório; a suíte de recuperação usa as fixtures identificadas, não esses três snapshots.

## Stack completa e limites de validação

- **Docker Compose completo: validado em Linux no GitHub Actions.** Backend, frontend e `compose-smoke` passaram na [execução 40127306934](https://github.com/RyotaMarco/gcp-rag/actions/runs/40127306934), commit `bafe872d16220d0cde3588c9547313b8ba2c4e17`. Confirmados: build das imagens, início sem índice/chave, ingestão com modelos reais, MCP por HTTP, idempotência e persistência após reinício. O host Windows não tem Docker; a validação da stack ocorreu no CI.
- **Groq real:** não validada sem credencial disponível. Respostas HTTP simuladas verificam chave ausente, rate limit e timeout, mas não confirmam autenticação, cota, disponibilidade do modelo ou qualidade da geração real.
- **Hospedagem pública, login multiusuário e recursos GCP reais:** fora do escopo; MCP opera exclusivamente sobre dados fictícios.

## Reprodução e CI

```bash
python -m pytest -q
python -m evaluation.run --mode fixture --output evaluation/report-fixture.json
python -m evaluation.run --mode real --output evaluation/real-report.json
python -m evaluation.run --mode real --compare-original --output evaluation/before-after-report.json
cd frontend
npm ci
npm test -- --run
npm run lint
npm run build
```

O workflow `.github/workflows/ci.yml` valida backend, frontend e stack Compose em runner Linux. O job de stack usa modelos locais reais para indexar as fixtures, verifica inicialização sem índice, prontidão sem chave, consultas MCP, repetição de ingestão e persistência após reinício. Exporta o benchmark real e os resultados de contagem como artefatos. A execução citada acima confirmou as três frentes; o status do PR permite acompanhar as revisões seguintes.
