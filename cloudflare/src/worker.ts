import { ApiError, apiError, assertOrigin, csv, errorResponse, identityFor, localeFor, parseQuestion, secureResponse, verifyTurnstile } from './security';
import { budgetStub, EMBEDDING_DIMENSIONS, type Answer, type Env, type Question } from './types';
import { corpusVersion } from './retrieval';
import { pipeline } from './pipeline';
import { callMcp } from './mcp';

type Dependencies = { verify?: typeof verifyTurnstile; run?: typeof pipeline };
// Only completed public readiness data is cached, never request-bound I/O or promises.
const readinessCache = new Map<string, { expires: number; result: Record<string, unknown> }>();
async function coverage(env: Env) {
  const version = await corpusVersion(env);
  const products = await env.DB.prepare('SELECT DISTINCT product FROM chunks WHERE version=? ORDER BY product').bind(env.CORPUS_VERSION).all<{ product: string }>();
  return { version: version.version, services: products.results.map(row => row.product), pages: version.page_count, chunks: version.chunk_count, collectedAt: version.created_at, enabled: env.DEMO_ENABLED === 'true' };
}
async function checkReady(env: Env) {
  const checks = { d1: false, index: false, vectorize: false, provider_configured: Boolean(env.AI), mcp: false, budget: false, enabled: env.DEMO_ENABLED === 'true', verification_configured: Boolean(env.TURNSTILE_SECRET_KEY && csv(env.TURNSTILE_HOSTNAMES).length && env.IP_HASH_SECRET && env.IP_HASH_SECRET.length >= 32 && env.EDGE_RATE_LIMIT) };
  let indexedChunks = 0;
  try {
    const version = await corpusVersion(env); checks.d1 = true; indexedChunks = version.chunk_count;
    const actual = await env.DB.prepare('SELECT COUNT(*) AS total FROM chunks WHERE version=?').bind(env.CORPUS_VERSION).first<{ total: number }>();
    const fts = await env.DB.prepare('SELECT COUNT(*) AS total FROM chunks_fts WHERE version=?').bind(env.CORPUS_VERSION).first<{ total: number }>();
    checks.index = actual?.total === version.chunk_count && fts?.total === version.chunk_count;
    const first = await env.DB.prepare('SELECT id FROM chunks WHERE version=? LIMIT 1').bind(env.CORPUS_VERSION).first<{ id: string }>();
    const description = await env.VECTORIZE.describe();
    const sample = first ? await env.VECTORIZE.getByIds([first.id]) : [];
    checks.vectorize = description.dimensions === EMBEDDING_DIMENSIONS && sample.some(vector => vector.id === first?.id && vector.values.length === EMBEDDING_DIMENSIONS);
  } catch { /* Public readiness exposes checks, never provider/database exception text. */ }
  const signal = AbortSignal.timeout(4000);
  const external = await Promise.allSettled([callMcp(env, null, signal), budgetStub(env).healthy()]);
  checks.mcp = external[0].status === 'fulfilled';
  checks.budget = external[1].status === 'fulfilled' && external[1].value === true;
  const issues = Object.entries(checks).filter(([, ready]) => !ready).map(([name]) => name + '_not_ready');
  return { status: issues.length ? 'not_ready' : 'ready', checks, indexed_chunks: indexedChunks, issues, provider_tested: false };
}
async function readiness(env: Env) {
  const key = [env.ENVIRONMENT, env.CORPUS_VERSION, env.DEMO_ENABLED].join(':');
  let cached = readinessCache.get(key);
  if (!cached || cached.expires <= Date.now()) {
    cached = { expires: Date.now() + 30000, result: await checkReady(env) }; readinessCache.set(key, cached);
    if (readinessCache.size > 4) for (const [name, value] of readinessCache) if (value.expires <= Date.now()) readinessCache.delete(name);
  }
  const result = cached.result;
  return Response.json(result, { status: result.status === 'ready' ? 200 : 503 });
}
function controlledRun(env: Env, input: Question, request: Request, run: typeof pipeline) {
  const controller = new AbortController();
  if (request.signal.aborted) controller.abort();
  const timeout = setTimeout(() => controller.abort(), 25000);
  const abort = () => controller.abort(); request.signal.addEventListener('abort', abort, { once: true });
  let cleaned = false;
  let completed: Promise<void> = Promise.resolve();
  function cleanup() { if (cleaned) return; cleaned = true; clearTimeout(timeout); request.signal.removeEventListener('abort', abort); }
  function execute(progress: Parameters<typeof pipeline>[3]): Promise<Answer> {
    const aborted = new Promise<never>((_, reject) => {
      if (controller.signal.aborted) reject(new ApiError('timeout', 504, 60));
      else controller.signal.addEventListener('abort', () => reject(new ApiError('timeout', 504, 60)), { once: true });
    });
    const pending = Promise.resolve().then(() => {
      if (controller.signal.aborted) throw new ApiError('timeout', 504, 60);
      return run(env, input, controller.signal, progress);
    });
    completed = pending.then(() => {}, () => {});
    return Promise.race([pending, aborted]).finally(cleanup);
  }
  return { controller, execute, cleanup, finished: () => completed };
}
export async function handleRequest(request: Request, env: Env, ctx: ExecutionContext, dependencies: Dependencies = {}): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  let locale = localeFor(request);
  try {
    if (!path.startsWith('/api/')) return secureResponse(await env.ASSETS.fetch(request));
    if (path === '/api/health/live' && request.method === 'GET') return secureResponse(Response.json({ status: 'ok' }), true);
    if ((path === '/api/health/ready' || path === '/api/coverage') && request.method === 'GET') {
      if (!env.EDGE_RATE_LIMIT || !env.IP_HASH_SECRET || !request.headers.get('CF-Connecting-IP')) throw new ApiError('verification_unavailable', 503, 60);
      const identity = await identityFor(request.headers.get('CF-Connecting-IP')!, env.IP_HASH_SECRET);
      if (!(await env.EDGE_RATE_LIMIT.limit({ key: identity })).success) throw new ApiError('rate_limited', 429, 60);
      try { return secureResponse(path === '/api/coverage' ? Response.json(await coverage(env)) : await readiness(env), true); }
      catch { throw new ApiError('index_unavailable', 503, 60); }
    }
    if (path !== '/api/ask/' && path !== '/api/ask') return secureResponse(Response.json({ detail: { code: 'not_found', message: 'Not found' } }, { status: 404 }), true);
    if (request.method !== 'POST') throw new ApiError('method_not_allowed', 405);
    assertOrigin(request, env);
    const input = await parseQuestion(request); locale = input.locale;
    if (env.DEMO_ENABLED !== 'true') throw new ApiError('demo_disabled', 503, 60);
    if (!env.EDGE_RATE_LIMIT || !env.IP_HASH_SECRET || !request.headers.get('CF-Connecting-IP')) throw new ApiError('verification_unavailable', 503, 60);
    const identity = await identityFor(request.headers.get('CF-Connecting-IP')!, env.IP_HASH_SECRET);
    if (!(await env.EDGE_RATE_LIMIT.limit({ key: identity })).success) throw new ApiError('rate_limited', 429, 60);
    await (dependencies.verify || verifyTurnstile)(request, env, AbortSignal.timeout(5000));
    const budget = budgetStub(env);
    let reservation;
    try { reservation = await budget.reserve(identity, env.ENVIRONMENT === 'preview' ? 'preview' : 'production'); }
    catch { throw new ApiError('busy', 503, 60); }
    if (!reservation.allowed) throw new ApiError(reservation.code, 429, reservation.retryAfter);
    const lease = reservation.lease;
    let released = false;
    async function release() {
      if (released) return; released = true;
      // A failed release leaves a short-lived lease; admission remains closed at
      // the concurrency cap until expiration. Daily counts are never refunded.
      try { await budget.release(lease); } catch { /* No fallback that bypasses the guard. */ }
    }
    const work = controlledRun(env, input, request, dependencies.run || pipeline);
    if (request.headers.get('Accept')?.includes('text/event-stream')) {
      const encoder = new TextEncoder(); let closed = false;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          function send(event: string, value: unknown) { if (!closed) controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`)); }
          const task = work.execute(stage => send('progress', { stage })).then(result => send('result', result)).catch(error => send('error', apiError(error).payload(input.locale))).finally(async () => {
            // Closing the client stream is not proof that an upstream inference stopped.
            // Keep its admission until the actual work settles (or the lease expires).
            ctx.waitUntil(work.finished().then(release));
            if (!closed) { closed = true; controller.close(); }
          });
          ctx.waitUntil(task);
        },
        cancel() { closed = true; work.controller.abort(); work.cleanup(); ctx.waitUntil(work.finished().then(release)); },
      });
      return secureResponse(new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'X-Accel-Buffering': 'no' } }), true);
    }
    try { return secureResponse(Response.json(await work.execute(() => {})), true); }
    finally { ctx.waitUntil(work.finished().then(release)); }
  } catch (error) { return errorResponse(error, locale); }
}
export default { fetch: handleRequest };
