# Demo pública do GCP AI Copilot

Esta modalidade acrescenta um destino Cloudflare à aplicação, sem substituir a stack Docker. O endereço de produção previsto é `https://gcp.marco-ryota.com`; existir código ou recursos provisionados não comprova que a demo esteja liberada. A publicação exige os gates abaixo e `DEMO_ENABLED=true` no ambiente aprovado.

## Arquitetura

- O Worker público serve os arquivos React e os endpoints `/api/*`. Inglês usa `/`; português usa `/pt`. Tema, fontes locais, paleta e movimento acompanham o portfólio. Conversas e rascunhos permanecem na memória ao mudar o idioma; respostas anteriores não são traduzidas automaticamente.
- Workers AI usa exclusivamente `@cf/baai/bge-m3` para embeddings multilíngues de 1024 dimensões e `@cf/meta/llama-3.1-8b-instruct-fp8-fast` para geração, limitada a 512 tokens. Não há fallback automático para outro modelo, provedor ou plano.
- Uma consulta RAG admitida pode usar um embedding, uma seleção com o modelo fixo (até 32 tokens de saída) e uma escrita baseada apenas no trecho selecionado (até 512 tokens). As duas chamadas de geração consomem a franquia compartilhada. As respostas são resumos breves que podem omitir detalhes; consulte a fonte original e as limitações em `cloudflare/evaluation/REVIEW.md`.
- Vectorize recupera candidatos semânticos. D1 FTS5/BM25 recupera candidatos textuais. A fusão RRF usa `k=60` e entrega até cinco trechos. O crossencoder local não faz parte desta modalidade; o relatório local não comprova qualidade equivalente na Cloudflare.
- D1 armazena versões e trechos atribuídos às fontes. O filtro do Vectorize e as consultas D1 usam o mesmo `CORPUS_VERSION`. Fontes ou vetores de outra versão são descartados.
- Um Durable Object SQLite central admite consultas e mantém contadores persistentes. Preview aponta para o mesmo objeto de produção; mudar Worker ou localização não cria uma nova cota global.
- Um segundo Worker implementa MCP com cinco ferramentas somente de leitura e dados fictícios. O transporte realiza `initialize`, `notifications/initialized`, `tools/list` e `tools/call`. O named entrypoint `McpPrivate` é acessível pelo Service binding; o handler de rede padrão retorna 404. Esse Worker não tem domínio, rota, `workers.dev` nem URL de preview públicos.

Os recursos públicos nunca operam uma conta GCP real. Nomes de recursos retornados por ferramentas são acompanhados de `simulated:true`, inclusive em respostas híbridas.

## API e interface

`POST /api/ask/` mantém `question`, `history` e acrescenta `locale` opcional (`en` ou `pt`). O modo público exige `X-Turnstile-Token`. O frontend local envia apenas `question` e `history`, preservando o esquema estrito do backend Python; `locale` é enviado somente à Cloudflare. A resposta JSON mantém `answer`, `sources`, `mode` e `simulated`; fontes validadas podem incluir `excerpt`, um trecho literal do contexto recuperado.

Com `Accept: text/event-stream`, o servidor emite `progress` com a etapa real (`retrieving`, `generating` ou `tools`), seguido de `result` com a resposta final validada ou `error` com o mesmo envelope de erro JSON. Tokens provisórios do modelo não são mostrados. A interface aceita JSON como fallback para o backend Docker.

Erros usam `{detail:{code,message,retry_after?}}`, com HTTP correspondente. `Retry-After` e códigos de quota são respeitados sem reenviar a pergunta automaticamente. Cancelamento é encaminhado ao trabalho em andamento; a admissão permanece ocupada enquanto o trabalho real não termina, dentro da concessão temporária. Tentativas já admitidas não são reembolsadas.

`GET /api/health/live` indica que a API responde. `/api/health/ready` verifica o índice D1/FTS, uma amostra compatível do Vectorize, o MCP privado, o contador e a configuração necessária, sem consumir inferência para testar a IA. `provider_configured` significa binding configurado; não comprova autenticação, capacidade ou cota de uma chamada real. `/api/coverage` apresenta versão, serviços, páginas, trechos, data de coleta e liberação da demo. Cobertura indisponível não é apresentada como uma base pronta.

## Limites, segurança e privacidade

Defaults de admissão, antes de qualquer embedding ou geração:

| Limite | Comportamento |
|---|---|
| Por IP | 3 consultas por minuto e 10 por dia |
| Total diário | 100 consultas, somando preview e produção |
| Preview | Até 10 das 100 consultas diárias |
| Concorrência | 2 admissões, concessão de 30 segundos |
| Tempo da consulta | 25 segundos no Worker |
| Corpo HTTP | Até 32 KiB |
| Pergunta | Até 2.000 caracteres |
| Histórico | Até 12 itens recebidos; apenas as últimas mensagens entram no contexto limitado |
| Saída da geração | Até 512 tokens |

Os limites diários seguem UTC. Visitantes na mesma rede podem compartilhar o limite por IP. Rotacionar IP ou resolver uma verificação anti-bot não contorna o total central. A concessão temporária protege a recuperação após falhas; interromper uma conexão não é garantia de que o provedor já interrompeu fisicamente toda inferência.

A franquia Workers AI é da conta e também pode ser usada pelo chat do portfólio, ingestão e avaliações manuais. Os limites da demo não reservam a franquia nem descobrem o plano de cobrança da conta. Antes de qualquer manutenção que use IA, confirme Workers Free no painel; não habilite Workers Paid ou cobrança por créditos. No Free, a cota esgotada interrompe operações. Consulte as [cotas atuais do Workers AI](https://developers.cloudflare.com/workers-ai/platform/pricing/), [Vectorize](https://developers.cloudflare.com/vectorize/platform/pricing/), [D1](https://developers.cloudflare.com/d1/platform/pricing/) e [Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/).

As verificações implementadas incluem:

- Turnstile Siteverify no servidor, validando sucesso, hostname e action `gcp-demo-ask`; token expirado ou reutilizado é recusado. Chaves e hosts de preview e produção são separados.
- Método, origem, mídia, tamanho real do corpo e esquema estritos. CORS não é usado como autenticação; a verificação anti-bot continua obrigatória mesmo em chamadas fora do navegador.
- Contador transacional e proteção preliminar por localização. Falha do contador ou da verificação impede consumo de IA.
- SQL parametrizado e termos FTS limitados/quotados, sem repassar a gramática `MATCH` do visitante.
- Ausência de upload, coleta por visitante, URL/modelo/índice selecionável ou endpoint administrativo público.
- Hosts/caminhos oficiais fixos, verificação de redirecionamentos na coleta, citações vinculadas ao contexto e trechos de apoio literais. Isso reduz citações inventadas, mas não prova que toda afirmação de uma resposta esteja correta.
- Markdown sem HTML bruto ou imagens remotas. Links só apontam a hosts HTTPS autorizados, sem credenciais ou portas não padrão. CSP compatível com Turnstile, proteção contra framing, `nosniff`, política de referrer e HTTPS também se aplicam aos arquivos estáticos via `_headers`.

A aplicação não persiste conversas nem registra perguntas, histórico, prompts, tokens Turnstile, chaves ou IPs brutos. Os contadores usam HMAC diário do IP. **Use o mesmo `IP_HASH_SECRET` em preview e produção** para que os limites por IP também sejam compartilhados. Os buckets de identidade são limpos, mantendo apenas o dia UTC atual e o anterior. Não publique nem redefina esse segredo em um rollback para tentar reiniciar cotas.

A observabilidade automática da aplicação permanece desabilitada para não coletar conteúdo ou metadados além da política definida. Se acrescentar métricas, registre somente contagens, latências e códigos conhecidos; nunca objetos de requisição ou exceções completas do provedor. Cloudflare continua processando requisições e pode manter metadados de infraestrutura conforme suas próprias políticas. Não afirme que o provedor inteiro armazena zero dados.

## Configuração e validação sem IA

Requisitos: Node.js 22, Bun 1.4.4 e Python 3.12. `cloudflare/package.json` fixa Wrangler **4.151.0**: durante a preparação, 4.152 apresentou erro na etapa de subdomínio após upload. O pin evita depender desse comportamento; atualizações devem repetir os dry runs e o smoke antes de alterar a versão. A data de compatibilidade também permanece a versão validada pelos testes do runtime.

Na raiz do repositório:

```bash
python -m pip install -r cloudflare/requirements-ingest.txt
python cloudflare/scripts/prepare-corpus.py
cd frontend
npm ci
npm run lint
npm test -- --run
npm run build
cd ../cloudflare
bun install --frozen-lockfile
bun run typecheck
bun test tests
bun run check:deploy
bun x wrangler deploy --dry-run --config wrangler.preview.jsonc --outdir .wrangler/dry-run-preview
bun x wrangler deploy --dry-run --config wrangler.mcp.jsonc --outdir .wrangler/dry-run-mcp
```

Esses comandos não coletam páginas, não indexam recursos remotos, não provisionam serviços e não chamam IA real. O build frontend acima valida o modo local. Para o build público, defina `VITE_DEPLOY_TARGET=cloudflare` e a sitekey pública `VITE_TURNSTILE_SITE_KEY` antes de `npm run build`. Não use uma sitekey de testes em produção.

No build de preview, defina também `VITE_DEPLOY_ENVIRONMENT=preview`: o postbuild acrescenta `X-Robots-Tag: noindex, nofollow` aos cabeçalhos dos arquivos estáticos e gera `robots.txt` com `Disallow: /`. Deixe o valor vazio em produção. Os metadados bilíngues e o sitemap usam o domínio canônico de produção; impedir indexação não substitui Turnstile, cotas ou a liberação explícita da demo.

Os segredos `TURNSTILE_SECRET_KEY` e `IP_HASH_SECRET` pertencem exclusivamente ao Worker e devem ser configurados com prompts seguros de Wrangler ou um gerenciador de segredos. A sitekey do widget é pública; o secret não é. Nunca cole tokens em conversa, logs, comandos com valor literal ou arquivos versionados. As ferramentas de manutenção aceitam autenticação Wrangler existente ou `CLOUDFLARE_API_TOKEN` no ambiente; não imprimem o token obtido.

O CI conserva os testes Python, frontend e Compose existentes e acrescenta um job independente Cloudflare com Bun, testes do contador/runtime, verificação offline do corpus e dry runs. Nenhum job do CI de validação provisiona infraestrutura, coleta a documentação ou executa avaliação de IA real.

## Corpus, indexação e avaliação real

O corpus inicial contém **29 páginas oficiais, 467 trechos**, modelo BGE-M3 e `fixture:false`. O manifesto registra URLs finais, datas e checksums. Google e os autores mantêm os direitos sobre as páginas; a atribuição e as licenças estão em `cloudflare/corpus/NOTICE.md`.

Os seeds cobrem Vertex AI, Cloud Storage, BigQuery, Compute Engine, IAM e Cloud Run, com teto de 30 páginas e 750 trechos. Durante a coleta, algumas URLs Vertex AI passaram a redirecionar para documentação Gemini Enterprise Agent Platform. Esses destinos oficiais foram incluídos explicitamente na allowlist; o produto de origem continua identificado no manifesto. Um redirecionamento para outro host/caminho deve falhar, não ampliar a allowlist automaticamente.

Preparação manual, na raiz:

```bash
# Verifica manifesto/limites/checksums existentes sem rede.
python cloudflare/scripts/prepare-corpus.py

# Coleta explicitamente os seeds fixos; usa o cache de páginas já coletadas.
python cloudflare/scripts/prepare-corpus.py --collect

# Nova coleta explícita das páginas, respeitando robots.txt e intervalo.
python cloudflare/scripts/prepare-corpus.py --collect --refresh
```

Revise o resultado e versione as mudanças. Uma coleta incompleta ou acima dos limites falha sem substituir a versão anterior. As paráfrases de `evaluation/corpus` não entram na coleta pública.

Com os recursos Free e bindings corretos já provisionados, execute em `cloudflare/`:

```bash
# Apenas mostra a operação planejada, sem autenticar ou usar IA.
bun run index:corpus --target preview

# Consome a franquia: execute somente após confirmar Workers Free.
bun run index:corpus --target preview --apply --confirm-free

# Usa embeddings reais e perguntas independentes em EN/PT.
bun run evaluate:real --target preview --confirm-free --output evaluation/real-retrieval-report.json

# Além da recuperação, gera amostras limitadas para revisão humana.
bun run evaluate:real --target preview --confirm-free --answer-samples --output evaluation/real-answer-review.json
```

A indexação reutiliza embeddings compatíveis de `.cache`, não regenera tudo a cada build. Insere D1/FTS e vetores com a mesma versão e verifica presença/propagação antes de marcar a versão pronta. Ativar essa versão ainda exige fixar `CORPUS_VERSION` no deploy; a manutenção não muda o switch da demo ou suas cotas. Use `--target production` explicitamente para repetir a indexação no ambiente de produção aprovado.

A avaliação real exige Hit@5 de pelo menos **85% em cada idioma**, com denominadores explícitos apenas para perguntas cobertas. Uma falha bloqueia a publicação; não reduza o gate para aprovar uma execução ruim. Hit@5 mede recuperação, não fidelidade das respostas. Revise também as amostras geradas, as fontes, a recusa de perguntas fora do recorte, a continuidade e os rótulos de simulação. Relatórios determinísticos do backend local não substituem essa validação. Resultados reais e aprovação serão registrados separadamente; a existência deste guia não declara aprovação ao vivo.

## Publicação, atualização e rollback

1. Confirme o plano Free da conta e as permissões mínimas dos recursos. Mantenha preview e produção com D1/Vectorize e chaves Turnstile próprios, mas com o mesmo contador central e segredo HMAC diário.
2. Publique o MCP privado e a infraestrutura do contador sem qualquer entrada pública do MCP. Mantenha os Workers públicos com `DEMO_ENABLED=false` durante o preparo.
3. Importe o corpus no preview, conclua os gates reais e os testes de segurança, interface/idioma, quota e falhas. As chaves de teste Turnstile servem apenas aos testes automatizados isolados.
4. Prepare produção com a mesma versão aprovada. Faça build com a sitekey correta, associe `gcp.marco-ryota.com` ao Worker público e libere consultas apenas após verificar a configuração e a aprovação final.
5. Teste perguntas reais limitadas, fontes, simulação, idiomas, desktop/mobile e indisponibilidade por quota. Só então habilite o link de demo no portfólio.

Atualizações normais do frontend/Worker não coletam documentação nem geram embeddings. Uma mudança de corpus ou modelo exige uma nova versão, novos vetores e avaliação; nunca misture versões na mesma resposta. Antes de apagar vetores antigos, confirme que nenhum deploy ou rollback ainda os referencia.

Para interrupção imediata, defina `DEMO_ENABLED=false` e publique a configuração. Para rollback, restaure a versão anterior do Worker e do frontend e fixe a versão de corpus anteriormente aprovada. Mantenha o mesmo Durable Object e `IP_HASH_SECRET`; não apague seu armazenamento, recrie o namespace ou restaure contadores antigos para zerar o orçamento.

O backup lógico de recuperação é o corpus/manifesto imutável versionado, junto do esquema e dos scripts de indexação. D1 não oferece exportação comum de bancos com tabelas virtuais FTS: reconstrua a tabela FTS a partir dos trechos versionados, em vez de presumir que `wrangler d1 export` cobre esse caso. Se a versão anterior do Vectorize precisar ser recriada, mantenha a demo desabilitada até verificar a propagação e a prontidão novamente.
