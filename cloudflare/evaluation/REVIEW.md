# Cloudflare validation review — 2026-10-24

Reviewed by Codex against the versioned real corpus and generated excerpts. This is an agent editorial review, not a claim of human approval or a guarantee of correctness.

Corpus: `docs-d91e5f5e46cf`, 29 official pages, 467 chunks. Final real report: `real-retrieval-report.json`, generated at `2026-10-24T21:42:09Z`. Its implementation checksum covers the retrieval and generation source used in that evaluation.

Retrieval passes the unchanged minimum Hit@5 of 85% separately: English 18/18 (100%); Portuguese 16/18 (88.9%). The two Portuguese misses remain recorded. No synthetic local evaluation document was added to the public index.

## Generation sample review

| Sample | Finding against its returned supporting passage |
| --- | --- |
| Model Registry, EN | Lifecycle management, organization, tracking and new versions are supported. The source now uses Google's Gemini Enterprise Agent Platform branding. |
| Buckets, PT | Storage foundation and storage backend statements are supported, but the answer omits the requested bucket/object relationship even though the quote contains it. “Base de dados” is an imprecise rendering of “data foundation.” |
| BigQuery datasets, EN | Top-level container, tables and views are supported. Earlier unsupported dataset hierarchy claims are absent from this version. |
| Compute instances, PT | Bare-metal and VM subtype distinction is supported. This is an indirect definition, and “metal bruto” is awkward Portuguese. |
| IAM roles, EN | Roles contain permissions and are granted to principals. The answer is supported. |
| Cloud Run, PT | HTTPS endpoint infrastructure and application TCP/HTTP obligations are supported. “Lidere com” is an awkward translation of “handles.” |

These are deliberately brief summaries of one selected passage, not a complete Google Cloud assistant. Source fidelity improved after isolating the writer from unselected excerpts. Known incompleteness and translation quality remain limitations; a valid citation alone is not evidence that every possible generated answer is correct. The supporting original is available in the interface.

One admitted RAG question can consume one embedding call, one fixed-model selection call (32 output tokens maximum), and one fixed-model writing call (512 maximum). There are no automatic retries. Both model calls consume the account's shared Workers AI allowance.

## Security and compatibility evidence

- TypeScript and 31 backend tests / 290 assertions pass, including real workerd SQLite persistence/concurrency, private MCP network isolation, fail-closed admission, source validation, bounded parsing, cancellation, daily identifiers and midnight cleanup scheduling.
- An independent read-only agent audit found no additional high or critical issue after the cleanup scheduling repair. This is scoped code review, not a penetration-test certification.
- Frontend tests preserve the strict Docker request schema; the optional locale field is sent only to Cloudflare. Existing Docker/Python validation remains in CI.
- The separately provisioned preview and production indexes contain the same complete corpus version. Both use the same central Durable Object and HMAC secret; Turnstile host-scoped secrets differ.
- Live protected preview validation and production/domain publication remain separate release steps. This review does not assert that a successful public Turnstile request or production deployment has already occurred.
