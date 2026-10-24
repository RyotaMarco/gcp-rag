# Interface do GCP AI Assistant

React, Vite e NGINX. A identidade escura com vermelho e dourado acompanha estados reais de operação, Markdown seguro, fontes oficiais e consultas MCP demonstrativas.

## Desenvolvimento

Use Node.js 22.22.2 ou superior compatível e npm:

```sh
npm ci
npm run dev
npm test
npm run lint
npm run build
```

O servidor Vite encaminha `/api/*` para o backend em `127.0.0.1:8000` durante o desenvolvimento. No Compose, o NGINX encaminha essas rotas para `api:8000`. O navegador usa exclusivamente URLs relativas: nenhuma chave de API faz parte do bundle ou do armazenamento do navegador.

## Comportamento

- Consulta `/api/health/ready` ao abrir e a cada 30 segundos; aceita HTTP 503 com diagnóstico de preparação pendente.
- Envia `/api/ask/` com até seis mensagens anteriores, limitadas a 2000 caracteres por mensagem, e pergunta de até 2000 caracteres.
- Não repete chamadas automaticamente. HTTP 429 bloqueia novos envios durante o `Retry-After` informado; sem indicação válida, espera 60 segundos.
- Cancela chamadas de conversa após 60 segundos; erros mantêm a pergunta no campo para revisão e não entram no histórico enviado ao modelo.
- Markdown não executa HTML. Imagens remotas são omitidas e links ficam limitados a HTTPS nos domínios oficiais Google Cloud/Google AI.
- Mostra fontes com data de coleta e identifica resultados simulados do MCP.

## Container

O Dockerfile compila os arquivos estáticos e os serve no NGINX. O endpoint `/healthz` verifica o frontend. A configuração de proxy, limites e fallback da SPA está em `nginx.conf`.

## Testes

Vitest + Testing Library verificam saúde, configuração ausente, roteamento relativo, histórico, fontes, Markdown seguro, sinalização de simulação, cota esgotada e limpeza da conversa. Os testes usam API simulada e não consomem tokens.
