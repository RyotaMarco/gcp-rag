import { expect, test } from 'bun:test';
import { ApiError } from '../src/security';
import { handleRequest } from '../src/worker';
import { answer, askRequest, environment } from './helpers';

const verified = async () => {};
test('origin, input, anti-bot and disabled mode are enforced before any AI or budget reservation', async () => {
  const f = environment(); let verifies = 0;
  const verify = async () => { verifies++; };
  const wrongOrigin = askRequest({}, { Origin: 'https://evil.test' });
  expect((await handleRequest(wrongOrigin, f.env, f.ctx, { verify })).status).toBe(403);
  expect((await handleRequest(askRequest({ question: '' }), f.env, f.ctx, { verify })).status).toBe(400);
  f.env.DEMO_ENABLED = 'false';
  expect((await handleRequest(askRequest(), f.env, f.ctx, { verify })).status).toBe(503);
  expect(f.reserves).toBe(0); expect(verifies).toBe(0); expect(f.calls.length).toBe(0);
  f.env.DEMO_ENABLED = 'true';
  const request = askRequest(); request.headers.delete('X-Turnstile-Token');
  expect((await handleRequest(request, f.env, f.ctx)).status).toBe(403);
  expect(f.reserves).toBe(0); expect(f.calls.length).toBe(0);
  f.close();
});
test('JSON and SSE preserve the public answer contract, with validated results only and release on completion', async () => {
  const f = environment();
  const json = await handleRequest(askRequest(), f.env, f.ctx, { verify: verified });
  expect(json.status).toBe(200); expect((await json.json() as { mode: string }).mode).toBe('rag');
  const sse = await handleRequest(askRequest(undefined, { Accept: 'text/event-stream' }), f.env, f.ctx, { verify: verified });
  const events = await sse.text();
  expect(sse.headers.get('Content-Type')).toContain('text/event-stream');
  expect(events).toContain('event: progress\ndata: {"stage":"retrieving"}');
  expect(events).toContain('event: progress\ndata: {"stage":"generating"}');
  expect(events).toContain('event: result');
  expect(events).not.toContain('event: token');
  await f.settled(); expect(f.released).toBe(2); expect(f.reserves).toBe(2);
  expect(sse.headers.get('Cache-Control')).toBe('no-store');
  expect(json.headers.get('Access-Control-Allow-Origin')).toBeNull();
  expect(json.headers.get('X-Frame-Options')).toBe('DENY');
  f.close();
});
test('counter failures and limits fail closed without invoking AI', async () => {
  const f = environment();
  f.env.BUDGET.get = (() => ({ reserve: async () => { throw new Error('private internal error'); } })) as never;
  let response = await handleRequest(askRequest(), f.env, f.ctx, { verify: verified });
  expect(response.status).toBe(503); expect(await response.text()).not.toContain('private');
  f.env.BUDGET.get = (() => ({ reserve: async () => ({ allowed: false, code: 'daily_limit', retryAfter: 600 }) })) as never;
  response = await handleRequest(askRequest(), f.env, f.ctx, { verify: verified });
  expect(response.status).toBe(429); expect(response.headers.get('Retry-After')).toBe('600'); expect(f.calls.length).toBe(0);
  f.close();
});
test('provider errors are sanitized, never retried, and failed admitted attempts remain counted', async () => {
  const f = environment();
  f.env.AI.run = async () => { throw new Error('3036: daily free allocation; private credentials detail'); };
  const response = await handleRequest(askRequest(), f.env, f.ctx, { verify: verified });
  expect(response.status).toBe(429);
  const body = await response.text(); expect(body).toContain('provider_quota'); expect(body).not.toContain('credentials');
  await f.settled(); expect(f.reserves).toBe(1); expect(f.released).toBe(1);
  const rows = f.budgetDb.query('SELECT total FROM counts WHERE kind="global"').get() as { total: number };
  expect(rows.total).toBe(1);
  f.close();
});
test('SSE errors have the same structured codes and do not leak provider exception text', async () => {
  const f = environment();
  const response = await handleRequest(askRequest(undefined, { Accept: 'text/event-stream' }), f.env, f.ctx, { verify: verified, run: async (_env, _input, _signal, progress) => { progress?.('retrieving'); throw new ApiError('provider_unavailable', 503, 60); } });
  const text = await response.text();
  expect(text).toContain('event: error'); expect(text).toContain('"code":"provider_unavailable"'); expect(text).not.toContain('event: result');
  await f.settled(); expect(f.released).toBe(1); f.close();
});
test('assets receive defensive headers and client-provided infrastructure fields are rejected', async () => {
  const f = environment();
  const response = await handleRequest(new Request('https://gcp.marco-ryota.com/'), f.env, f.ctx);
  expect(response.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
  expect(response.headers.get('Strict-Transport-Security')).toContain('31536000');
  expect((await handleRequest(askRequest({ question: 'hello', mcp_url: 'http://169.254.169.254' }), f.env, f.ctx, { verify: verified, run: async () => answer })).status).toBe(400);
  f.close();
});


test('cancelling SSE keeps admission while upstream work is still pending', async () => {
  const f = environment();
  let finish: (value: typeof answer) => void = () => {};
  const pending = new Promise<typeof answer>(resolve => { finish = resolve; });
  const response = await handleRequest(askRequest(undefined, { Accept: 'text/event-stream' }), f.env, f.ctx, { verify: verified, run: async () => pending });
  const reader = response.body!.getReader();
  await reader.cancel();
  await Promise.resolve();
  expect(f.released).toBe(0);
  const second = f.ledger.reserve('b'.repeat(64), 'production', Date.now());
  expect(second.allowed).toBe(true);
  expect(f.ledger.reserve('c'.repeat(64), 'production', Date.now())).toMatchObject({ allowed: false, code: 'busy' });
  finish(answer);
  await f.settled();
  expect(f.released).toBe(1);
  if (second.allowed) f.ledger.release(second.lease);
  f.close();
});
