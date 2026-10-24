# Interface do GCP AI Assistant

React, Vite e NGINX. Grafite, lilás e ciano, fontes locais e tema claro acompanham a identidade do portfólio, com estados reais de operação, Markdown seguro, fontes oficiais e consultas MCP demonstrativas.

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
- Cancela chamadas de conversa após 35 segundos; erros mantêm a pergunta no campo para revisão e não entram no histórico enviado ao modelo.
- Markdown não executa HTML. Imagens remotas são omitidas e links ficam limitados a HTTPS nos domínios oficiais Google Cloud/Google AI.
- Mostra fontes com data de coleta e identifica resultados simulados do MCP.

## Container

O Dockerfile compila os arquivos estáticos e os serve no NGINX. O endpoint `/healthz` verifica o frontend. A configuração de proxy, limites e fallback da SPA está em `nginx.conf`.

## Testes

Vitest + Testing Library verificam saúde, configuração ausente, roteamento relativo, histórico, fontes, Markdown seguro, sinalização de simulação, cota esgotada e limpeza da conversa. Os testes usam API simulada e não consomem tokens.

## Public Cloudflare mode

The React interface also supports a Cloudflare backend without replacing the existing Docker/FastAPI installation. Set the public build values `VITE_DEPLOY_TARGET=cloudflare` and `VITE_TURNSTILE_SITE_KEY` when building the public demo. Keep the values unset for local Docker. The Turnstile **secret** and all provider credentials belong exclusively in the backend; never put them in a `VITE_` variable.

The public mode requires real readiness and an anti-bot token before enabling questions. It sends one single-use token in `X-Turnstile-Token`, handles bounded SSE progress/final results or the compatible JSON response, and does not retry AI requests automatically. The backend remains authoritative for access, quota and source validation.

English uses `/`; Portuguese uses `/pt`. Theme and language are the only browser preferences stored. Conversation messages and drafts remain in memory, including when the interface language changes, and disappear on reload or New conversation. Language changes do not translate prior AI answers or call a translation provider.

The interface uses self-hosted fonts and ships a Cloudflare `_headers` policy. Preview/production Turnstile hostnames and keys must be configured separately. Tests use mocked backend/verification responses and make no paid AI calls.

For preview builds, also set `VITE_DEPLOY_ENVIRONMENT=preview`. The postbuild step adds `X-Robots-Tag: noindex, nofollow` to the generated static asset headers and disallows crawlers in `robots.txt`. Leave this value unset for production; EN/PT metadata and the production sitemap still point to `gcp.marco-ryota.com`. These are indexing hints, not access control.
