import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, type Chunk } from '../src/types';
import { validChunk } from '../src/retrieval';

export const root = fileURLToPath(new URL('../', import.meta.url).href);
export const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export type Manifest = { version: string; manifestSha: string; chunksSha256: string; embeddingModel: string; dimensions: number; services: string[]; pages: number; chunks: number; collectedAt: string; fixture: boolean; sources: { url: string; title: string; product: string; crawled_at: string; sha256: string }[] };
export async function loadCorpus() {
  const manifest = JSON.parse(await readFile(resolve(root, 'corpus/manifest.json'), 'utf8')) as Manifest;
  const raw = await readFile(resolve(root, 'corpus/chunks.jsonl'));
  const chunks = raw.toString('utf8').trim().split(/\r?\n/).map(line => JSON.parse(line) as Chunk);
  // Match the collector's Python json.dumps(sort_keys=True, ensure_ascii=False)
  // representation; the stored JSONL's key order and trailing newline differ.
  const canonical = chunks.map(chunk => '{' + Object.keys(chunk).sort().map(key => JSON.stringify(key) + ': ' + JSON.stringify(chunk[key as keyof Chunk])).join(', ') + '}').join('\n');
  if (manifest.fixture || manifest.embeddingModel !== EMBEDDING_MODEL || manifest.dimensions !== EMBEDDING_DIMENSIONS || manifest.pages > 30 || manifest.chunks > 750 || manifest.chunks !== chunks.length || sha256(canonical) !== manifest.chunksSha256 || new Set(chunks.map(chunk => chunk.id)).size !== chunks.length || chunks.some(chunk => !validChunk(chunk, manifest.version) || Buffer.byteLength(chunk.id) > 64 || !manifest.sources.some(source => source.url === chunk.url))) throw new Error('Corpus manifest, source provenance or chunk limits are invalid. No remote operation was performed.');
  return { manifest, chunks };
}
export function argumentsFor(values = process.argv.slice(2)) {
  const args = new Map<string, string>();
  for (let i = 0; i < values.length; i++) {
    if (!values[i].startsWith('--')) throw new Error('Use named command arguments.');
    const name = values[i].slice(2); args.set(name, values[i + 1] && !values[i + 1].startsWith('--') ? values[++i] : 'true');
  }
  return args;
}
export async function authentication(): Promise<string> {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  const result = Bun.spawnSync({ cmd: [process.execPath, 'x', 'wrangler', 'auth', 'token', '--json'], cwd: root, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_WRITE_LOGS: 'false' } });
  if (result.exitCode !== 0) throw new Error('Wrangler authentication is unavailable. Run the documented login flow; never paste a token into chat.');
  try {
    const value = JSON.parse(new TextDecoder().decode(result.stdout));
    if (typeof value.token !== 'string' || value.token.length < 12) throw new Error();
    return value.token;
  } catch { throw new Error('Wrangler did not return a usable authentication token. Its output has not been logged.'); }
}
export async function remote(target: string) {
  if (!['preview', 'production'].includes(target)) throw new Error('Target must be explicitly preview or production.');
  const config = JSON.parse((await readFile(resolve(root, target === 'preview' ? 'wrangler.preview.jsonc' : 'wrangler.jsonc'), 'utf8')).replace(/^\uFEFF/, ''));
  const account = process.env.CLOUDFLARE_ACCOUNT_ID || config.account_id || '6b436fdf69ec96a83f094e931d764468';
  const database = config.d1_databases.find((item: { binding: string }) => item.binding === 'DB').database_id as string;
  const index = config.vectorize.find((item: { binding: string }) => item.binding === 'VECTORIZE').index_name as string;
  if (!/^[a-f0-9]{32}$/.test(account) || !/^[a-f0-9-]{36}$/.test(database) || !/^[a-z0-9-]{1,64}$/.test(index)) throw new Error('Remote bindings must be provisioned explicitly in the selected Wrangler config.');
  const token = await authentication();
  async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers); headers.set('Authorization', 'Bearer ' + token);
    if (typeof init.body === 'string' && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const response = await fetch('https://api.cloudflare.com/client/v4/accounts/' + account + path, { ...init, headers, signal: AbortSignal.timeout(60000) });
    let data: { success?: boolean; result?: T; errors?: { code?: number }[] };
    try { data = await response.json() as typeof data; } catch { throw new Error('Cloudflare returned a non-JSON response (' + response.status + ').'); }
    if (!response.ok || data.success === false) throw new Error('Cloudflare operation failed (HTTP ' + response.status + '; code ' + (data.errors?.[0]?.code ?? 'unknown') + '). No automatic retry was made.');
    return data.result as T;
  }
  async function query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await api<{ success: boolean; results: T[] }[]>('/d1/database/' + database + '/query', { method: 'POST', body: JSON.stringify({ sql, params }) });
    if (!Array.isArray(result) || result.some(item => item.success === false)) throw new Error('D1 query failed.');
    return result.flatMap(item => item.results || []);
  }
  const minimumDenseScore = String(config.vars?.MIN_DENSE_SCORE ?? '.45');
  if (!Number.isFinite(Number(minimumDenseScore)) || Number(minimumDenseScore) < .3 || Number(minimumDenseScore) > .9) throw new Error('Configured dense relevance threshold is invalid.');
  return { api, query, account, database, index, minimumDenseScore, vectorPath: '/vectorize/v2/indexes/' + index };
}
export async function embedCached(texts: string[], api: Awaited<ReturnType<typeof remote>>['api']): Promise<number[][]> {
  const directory = resolve(root, '.cache/embeddings-bge-m3'); await mkdir(directory, { recursive: true });
  const entries: { text: string; file: string; vector: number[] | null }[] = await Promise.all(texts.map(async text => {
    const file = resolve(directory, sha256(EMBEDDING_MODEL + '\n' + text) + '.json');
    try {
      const cached = JSON.parse(await readFile(file, 'utf8'));
      if (cached.model === EMBEDDING_MODEL && cached.textSha === sha256(text) && Array.isArray(cached.vector) && cached.vector.length === EMBEDDING_DIMENSIONS && cached.vector.every(Number.isFinite)) return { text, file, vector: cached.vector as number[] };
    } catch { /* A missing/incompatible cache is regenerated only by this explicit maintenance command. */ }
    return { text, file, vector: null };
  }));
  const missing: typeof entries = entries.filter(entry => !entry.vector);
  for (let offset = 0; offset < missing.length; offset += 8) {
    const batch = missing.slice(offset, offset + 8);
    const value = await api<{ data: number[][] }>('/ai/run/' + EMBEDDING_MODEL, { method: 'POST', body: JSON.stringify({ text: batch.map(entry => entry.text) }) });
    if (!Array.isArray(value?.data) || value.data.length !== batch.length || value.data.some(vector => vector.length !== EMBEDDING_DIMENSIONS || !vector.every(Number.isFinite))) throw new Error('Embedding response has incompatible dimensions.');
    for (let index = 0; index < batch.length; index++) {
      batch[index].vector = value.data[index];
      await writeFile(batch[index].file, JSON.stringify({ model: EMBEDDING_MODEL, textSha: sha256(batch[index].text), vector: batch[index].vector }) + '\n');
    }
    console.log(JSON.stringify({ stage: 'embeddings', completed: Math.min(offset + batch.length, missing.length), requested: missing.length }));
  }
  return entries.map(entry => entry.vector!);
}
export const VECTORIZE_READ_BATCH = 20;
export async function vectorsByIds(client: Pick<Awaited<ReturnType<typeof remote>>, 'api' | 'vectorPath'>, ids: string[]) {
  if (!ids.length || ids.length > VECTORIZE_READ_BATCH) throw new Error('Vectorize reads require between 1 and 20 identifiers.');
  return client.api<{ id: string; metadata?: { version?: string } }[]>(client.vectorPath + '/get_by_ids', { method: 'POST', body: JSON.stringify({ ids }) });
}
