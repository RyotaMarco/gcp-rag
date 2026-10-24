import { ApiError, ftsExpression, safeSourceUrl } from './security';
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, type Chunk, type CorpusVersion, type Env } from './types';

export async function corpusVersion(env: Env): Promise<CorpusVersion> {
  const version = await env.DB.prepare('SELECT * FROM corpus_versions WHERE version=? AND ready=1').bind(env.CORPUS_VERSION).first<CorpusVersion>();
  if (!version || version.embedding_model !== EMBEDDING_MODEL || version.dimensions !== EMBEDDING_DIMENSIONS || version.chunk_count < 1 || version.chunk_count > 750 || version.page_count < 1 || version.page_count > 30) throw new ApiError('index_unavailable', 503, 60);
  return version;
}
export function validChunk(value: Chunk, version: string): boolean {
  return value.version === version && typeof value.id === 'string' && value.id.length < 180 && Boolean(safeSourceUrl(value.url)) && typeof value.text === 'string' && value.text.trim().length >= 40 && value.text.length <= 4000 && typeof value.title === 'string' && typeof value.product === 'string';
}
export async function retrieve(env: Env, query: string, signal: AbortSignal): Promise<Chunk[]> {
  await corpusVersion(env);
  if (signal.aborted) throw new ApiError('timeout', 504, 60);
  let embedding: unknown;
  try { embedding = await env.AI.run(EMBEDDING_MODEL, { text: [query.slice(0, 3500)] }, { signal }); }
  catch (error) { throw providerError(error); }
  const vector = (embedding as { data?: number[][] })?.data?.[0];
  if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSIONS || vector.some(value => !Number.isFinite(value))) throw new ApiError('provider_unavailable', 503, 60);
  if (signal.aborted) throw new ApiError('timeout', 504, 60);
  const expression = ftsExpression(query);
  const [dense, lexical] = await Promise.all([
    env.VECTORIZE.query(vector, { topK: 20, returnMetadata: 'none', filter: { version: env.CORPUS_VERSION } }),
    expression ? env.DB.prepare('SELECT chunks.* FROM chunks_fts JOIN chunks ON chunks.id=chunks_fts.id WHERE chunks.version=? AND chunks_fts MATCH ? ORDER BY bm25(chunks_fts) LIMIT 20').bind(env.CORPUS_VERSION, expression).all<Chunk>() : Promise.resolve({ results: [] as Chunk[] }),
  ]);
  const threshold = Number(env.MIN_DENSE_SCORE ?? '.45');
  if (!Number.isFinite(threshold) || threshold < .3 || threshold > .9) throw new ApiError('index_unavailable', 503, 60);
  const matches = dense.matches.filter(match => typeof match.id === 'string' && match.score >= threshold).slice(0, 20);
  let semantic: Chunk[] = [];
  if (matches.length) {
    const rows = await env.DB.prepare(`SELECT * FROM chunks WHERE version=? AND id IN (${matches.map(() => '?').join(',')})`).bind(env.CORPUS_VERSION, ...matches.map(match => match.id)).all<Chunk>();
    const byId = new Map(rows.results.map(row => [row.id, row]));
    semantic = matches.map(match => byId.get(match.id)).filter((row): row is Chunk => Boolean(row));
  }
  const scores = new Map<string, { doc: Chunk; score: number }>();
  for (const list of [semantic, lexical.results || []]) {
    list.forEach((doc, index) => {
      if (!validChunk(doc, env.CORPUS_VERSION)) return;
      const entry = scores.get(doc.id) || { doc, score: 0 };
      entry.score += 1 / (60 + index + 1); scores.set(doc.id, entry);
    });
  }
  return [...scores.values()].sort((a, b) => b.score - a.score || a.doc.id.localeCompare(b.doc.id)).slice(0, 5).map(item => item.doc);
}
export function providerError(error: unknown, now = Date.now()): ApiError {
  const value = typeof error === 'object' && error ? error as { status?: number; code?: number; message?: string } : {};
  // Inspect only to classify; provider messages are never sent to visitors or logged.
  if ([3036, 4006].includes(Number(value.code)) || /\b(3036|4006|daily free allocation)\b/i.test(value.message || '')) {
    const day = new Date(now).toISOString().slice(0, 10);
    const retry = Math.max(1, Math.ceil((Date.parse(day + 'T00:00:00Z') + 86400000 - now) / 1000));
    return new ApiError('provider_quota', 429, retry);
  }
  if (value.status === 429 || Number(value.code) === 3040 || /\b(3040|out of capacity|rate limit)\b/i.test(value.message || '')) return new ApiError('busy', 429, 60);
  return new ApiError('provider_unavailable', 503, 60);
}
