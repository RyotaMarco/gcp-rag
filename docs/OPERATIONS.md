# Guia operacional

## Comandos e volumes

Use os comandos na raiz do repositório. O Compose usa `documents` para JSONs da coleta, `vectors` para Qdrant e `models` para cache dos modelos Hugging Face. Remover contêineres com `docker compose down` preserva esses volumes. `down --volumes` apaga os dados; use-o somente para instalações descartáveis.

```bash
docker compose ps
docker compose logs --tail 100 api mcp qdrant
docker compose --profile tools run --rm ingest status
```

A interface é publicada pelo NGINX. Qdrant, MCP e API são acessíveis apenas na rede interna do Compose. O servidor MCP usa `/mcp`, mas não é publicado pelo proxy da interface.

## Coleta e indexação

```bash
# Atualização de um serviço: coleta as páginas novamente e atualiza o índice.
docker compose --profile tools run --rm ingest setup --services "Vertex AI" --max-pages 25
# Coleta sem indexar:
docker compose --profile tools run --rm ingest crawl --services "Document AI" --max-pages 10
# Indexação dos JSONs já armazenados, sem nova coleta:
docker compose --profile tools run --rm ingest ingest
```

Uma ingestão bem-sucedida também prepara os caches de embedding e reranker locais antes de emitir `models_ready=true`, evitando downloads na primeira pergunta. O primeiro download exige rede e pode demorar.

A lista de produtos está em `scraping/services.py`; `--services` aceita nomes exatos separados por vírgula. Documentos são identificados por URL canônica e gravados atomicamente. Chunks usam identificadores estáveis. Documentos inalterados não recalculam embeddings; documentos alterados substituem seus chunks e removem os antigos que ficaram obsoletos.

Uma coleta limitada não determina se uma página antiga foi removida da documentação. Arquivos previamente coletados continuam no armazenamento até manutenção explícita. Não execute duas ingestões simultaneamente sobre a mesma coleção.

### Reconstruir

A coleção `gcp_docs_v2` é independente da antiga `embedded_files`, que não possui os metadados necessários. Os dados S3/LocalStack da versão anterior não são migrados automaticamente. Faça uma nova coleta, ou importe documentos no formato JSON documentado abaixo.

```bash
docker compose --profile tools run --rm ingest ingest --rebuild
```

`--rebuild` remove **somente a coleção configurada** e a recria a partir dos documentos armazenados. Faça backup antes e execute em janela de manutenção: durante a reconstrução, o índice pode estar vazio ou parcial. Após trocar o modelo de embedding, reconstrua o índice; modelo/dimensão incompatíveis não devem ser usados silenciosamente.

Para testar a ingestão sem coleta externa:

```bash
docker compose --profile tools run --rm ingest ingest --from-directory /app/evaluation/corpus
```

Esse corpus é uma fixture de demonstração e **não substitui documentação atual**. Cada arquivo JSON tem `content` e `metadata`, incluindo `source_url` HTTPS de domínio oficial permitido, `title`, `product`, `section` e `crawled_at`. Para importar outros arquivos, monte um diretório no contêiner e forneça seu caminho interno em `--from-directory`.

## Backup e restauração

Pare a stack para copiar documentos e vetores no mesmo ponto consistente. Os exemplos usam o nome de projeto padrão `gcp-assistant`. Se usar `COMPOSE_PROJECT_NAME` ou `-p`, substitua o prefixo dos volumes. Execute em Bash; ajuste o caminho absoluto de `backups` no PowerShell.

```bash
mkdir -p backups
docker compose stop
docker volume inspect gcp-assistant_documents gcp-assistant_vectors
docker run --rm -v gcp-assistant_documents:/source:ro -v "$PWD/backups:/backup" alpine:3.22 tar czf /backup/documents.tgz -C /source .
docker run --rm -v gcp-assistant_vectors:/source:ro -v "$PWD/backups:/backup" alpine:3.22 tar czf /backup/vectors.tgz -C /source .
docker compose start
```

Guarde também a versão do código, configuração dos modelos e `.env` em local seguro fora do repositório. O cache `models` pode ser baixado novamente e não é essencial ao backup.

Restaure **em volumes vazios de uma instalação nova**, usando a mesma versão de Qdrant e configuração de embedding. Não sobreponha um índice ativo:

```bash
docker compose create
docker run --rm -v gcp-assistant_documents:/target -v "$PWD/backups:/backup:ro" alpine:3.22 tar xzf /backup/documents.tgz -C /target
docker run --rm -v gcp-assistant_vectors:/target -v "$PWD/backups:/backup:ro" alpine:3.22 tar xzf /backup/vectors.tgz -C /target
docker compose up -d --wait
```

Confirme `/api/health/ready`, a contagem do índice e uma consulta após restaurar. Alternativamente, restaure os documentos e reconstrua o índice; isso evita transportar vetores entre versões incompatíveis. Permissões de arquivos devem continuar permitindo o UID 10001 no backend.

## Diagnóstico

| Sintoma | Verificação e ação |
| --- | --- |
| UI abre, prontidão HTTP 503 | Leia `checks` e `issues` em `/api/health/ready`; a aplicação permanece viva com recursos parciais. |
| Índice vazio | Execute `setup` ou importe documentos e rode `ingest`; confira o resumo e código de saída. |
| Índice incompatível | Confira modelo/coleção e execute `ingest --rebuild` depois do backup. |
| Chave não configurada | Configure `GROQ_API_KEY` no `.env` e recrie `api`. MCP demonstrativo continua disponível. |
| Groq 401/403 ou modelo recusado | Confirme chave e disponibilidade do modelo na própria conta; não há fallback automático. |
| Groq 429 | Aguarde o `Retry-After`; reveja quotas no provedor. Não altere plano automaticamente. |
| Timeout de geração | Verifique conexão, provedor e `REQUEST_TIMEOUT`; a pergunta não é repetida automaticamente. |
| Qdrant indisponível | Consulte `docker compose logs qdrant`; confira volume e rede interna. |
| Download de modelos falha | Verifique rede/espaço no volume `models`; downloads iniciais exigem acesso ao Hugging Face. |
| Coleta com falhas | Consulte logs; robots.txt, redirecionamento, erros HTTP e limites podem impedir páginas específicas. |
| Sem evidências | Especifique serviço/objetivo e amplie a coleta pertinente. Ausência de resposta é preferível a uma instrução inventada. |

## Atualizar a aplicação

Faça backup, atualize o checkout para a versão desejada, revise `.env.example` e execute `docker compose up --build -d --wait`. Se a versão mudar o contrato do índice ou embedding, reconstrua. Para voltar, restaure código/configuração e backups compatíveis; não suponha compatibilidade de índices entre versões.
