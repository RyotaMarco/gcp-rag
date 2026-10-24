import { Database } from 'bun:sqlite';
import { BudgetLedger, type LedgerSql } from '../src/budget-ledger';
import { mcpResponse } from '../src/mcp';
import { EMBEDDING_MODEL, type Answer, type Chunk, type Env } from '../src/types';

export function sqlAdapter(db: Database): LedgerSql {
  return { exec(query, ...bindings) { const statement = db.query(query); const rows = statement.all(...bindings); return { toArray: () => rows as never[] }; } };
}
export const chunk: Chunk = { id: 'test-v1:storage-1', version: 'test-v1', title: 'Cloud Storage buckets', url: 'https://docs.cloud.google.com/storage/docs/buckets', product: 'Cloud Storage', section: 'Buckets', crawled_at: '2026-10-24T00:00:00Z', text: 'Buckets are the basic containers that hold your data in Cloud Storage. Objects are stored inside buckets. Configure IAM permissions to control access.' };
export const generated = { response: JSON.stringify({ answer: 'Buckets hold data in Cloud Storage. [S1]', citations: [{ id: 'S1', quote: 'Buckets are the basic containers that hold your data in Cloud Storage.' }] }) };
export const answer: Answer = { answer: 'Buckets hold data. [S1]', sources: [{ id: 'S1', title: chunk.title, url: chunk.url, product: chunk.product, section: chunk.section, crawled_at: chunk.crawled_at }], mode: 'rag', simulated: false };
export function environment() {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE corpus_versions(version TEXT PRIMARY KEY,embedding_model TEXT,dimensions INTEGER,chunk_count INTEGER,page_count INTEGER,created_at TEXT,manifest_sha TEXT,ready INTEGER); CREATE TABLE chunks(id TEXT PRIMARY KEY,version TEXT,url TEXT,title TEXT,product TEXT,section TEXT,crawled_at TEXT,text TEXT); CREATE VIRTUAL TABLE chunks_fts USING fts5(id UNINDEXED,version UNINDEXED,text,title,product,tokenize="unicode61 remove_diacritics 2")');
  db.query('INSERT INTO corpus_versions VALUES(?,?,?,?,?,?,?,?)').run(chunk.version, EMBEDDING_MODEL, 1024, 1, 1, chunk.crawled_at, 'abc', 1);
  db.query('INSERT INTO chunks VALUES(?,?,?,?,?,?,?,?)').run(chunk.id, chunk.version, chunk.url, chunk.title, chunk.product, chunk.section, chunk.crawled_at, chunk.text);
  db.query('INSERT INTO chunks_fts VALUES(?,?,?,?,?)').run(chunk.id, chunk.version, chunk.text, chunk.title, chunk.product);
  const budgetDb = new Database(':memory:');
  const ledger = new BudgetLedger(sqlAdapter(budgetDb));
  const calls: { model: string; inputs: Record<string, unknown> }[] = [];
  let released = 0; let reserves = 0;
  const env = {
    DEMO_ENABLED: 'true', ENVIRONMENT: 'production', CORPUS_VERSION: chunk.version,
    ALLOWED_ORIGINS: 'https://gcp.marco-ryota.com', TURNSTILE_HOSTNAMES: 'gcp.marco-ryota.com', TURNSTILE_SECRET_KEY: 'test-only-secret', IP_HASH_SECRET: 'a'.repeat(48),
    AI: { async run(model: string, inputs: Record<string, unknown>) { calls.push({ model, inputs }); return model === EMBEDDING_MODEL ? { data: [Array(1024).fill(.1)] } : inputs.max_tokens === 32 ? { response: { evidence_id: 'E1' } } : generated; } },
    DB: { prepare(query: string) { let bound: (string | number | null)[] = []; return { bind(...values: (string | number | null)[]) { bound = values; return this; }, async first() { return db.query(query).get(...bound); }, async all() { return { results: db.query(query).all(...bound), success: true }; } }; } },
    VECTORIZE: { async query() { return { matches: [{ id: chunk.id, score: .8 }], count: 1 }; }, async describe() { return { dimensions: 1024, vectorCount: 1 }; }, async getByIds() { return [{ id: chunk.id, values: Array(1024).fill(.1) }]; } },
    BUDGET: { idFromName() { return 'budget'; }, get() { return { async reserve(identity: string, environment: string) { reserves++; return budgetDb.transaction(() => ledger.reserve(identity, environment, Date.now()))(); }, async release(lease: string) { released++; ledger.release(lease); }, async healthy() { return true; } }; } },
    EDGE_RATE_LIMIT: { async limit() { return { success: true }; } },
    MCP: { fetch: mcpResponse }, ASSETS: { async fetch() { return new Response('<main>demo</main>', { headers: { 'Content-Type': 'text/html' } }); } },
  } as unknown as Env;
  const waiting: Promise<unknown>[] = [];
  const ctx = { waitUntil(promise: Promise<unknown>) { waiting.push(promise); } } as ExecutionContext;
  return { env, db, budgetDb, ledger, calls, ctx, async settled() { await Promise.allSettled(waiting); }, get released() { return released; }, get reserves() { return reserves; }, close() { db.close(); budgetDb.close(); } };
}
export function askRequest(body: unknown = { question: 'What are Cloud Storage buckets?' }, headers: Record<string, string> = {}) {
  return new Request('https://gcp.marco-ryota.com/api/ask/', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Origin': 'https://gcp.marco-ryota.com', 'CF-Connecting-IP': '192.0.2.1', 'X-Turnstile-Token': 'test-token', ...headers }, body: JSON.stringify(body) });
}
