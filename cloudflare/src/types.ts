export const EMBEDDING_MODEL = '@cf/baai/bge-m3';
export const GENERATION_MODEL = '@cf/meta/llama-3.1-8b-instruct-fp8-fast';
export const EMBEDDING_DIMENSIONS = 1024;
export const BUDGET_OBJECT = 'gcp-demo-budget-v1';
export type Locale = 'en' | 'pt';
export type Message = { role: 'user' | 'assistant'; content: string };
export type Question = { question: string; history: Message[]; locale: Locale };
export type Source = { id: string; title: string; url: string; product: string; section: string; crawled_at: string; excerpt?: string };
export type Answer = { answer: string; sources: Source[]; mode: 'rag' | 'mcp' | 'hybrid' | 'clarification' | 'insufficient_evidence'; simulated: boolean };
export type Chunk = { id: string; version: string; text: string; url: string; title: string; product: string; section: string; crawled_at: string };
export type CorpusVersion = { version: string; embedding_model: string; dimensions: number; chunk_count: number; page_count: number; created_at: string; manifest_sha: string; ready: number };
export type BudgetResult = { allowed: true; lease: string } | { allowed: false; code: 'rate_limited' | 'daily_limit' | 'busy'; retryAfter: number };
export interface BudgetStub {
  reserve(identity: string, environment: string): Promise<BudgetResult>;
  release(lease: string): Promise<void>;
  healthy(): Promise<boolean>;
}
// Resource bindings come from the checked-in Wrangler-generated declaration.
// AI is deliberately narrowed for provider-independent tests. Vectorize uses
// the GA type: this Wrangler version still generates the legacy beta alias.
export interface Env extends Pick<GeneratedBindings, 'ASSETS' | 'DB' | 'BUDGET'> {
  AI: { run(model: string, inputs: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<unknown> };
  VECTORIZE: Vectorize;
  MCP: Fetcher;
  EDGE_RATE_LIMIT?: { limit(input: { key: string }): Promise<{ success: boolean }> };
  CORPUS_VERSION: string;
  DEMO_ENABLED?: string;
  ENVIRONMENT?: string;
  ALLOWED_ORIGINS?: string;
  TURNSTILE_HOSTNAMES?: string;
  TURNSTILE_SECRET_KEY?: string;
  IP_HASH_SECRET?: string;
  MIN_DENSE_SCORE?: string;
}
export function budgetStub(env: Env): BudgetStub {
  return env.BUDGET.get(env.BUDGET.idFromName(BUDGET_OBJECT));
}
