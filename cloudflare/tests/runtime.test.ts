import { afterAll, expect, test } from 'bun:test';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const active: Miniflare[] = [];
afterAll(async () => { await Promise.all(active.map(instance => instance.dispose())); });
async function bundled(entry: string, stdin?: string) {
  const result = await build({ ...(stdin ? { stdin: { contents: stdin, resolveDir: fileURLToPath(new URL('../src/', import.meta.url).href), sourcefile: 'runtime-test.ts', loader: 'ts' } } : { entryPoints: [fileURLToPath(new URL(entry, import.meta.url).href)] }), bundle: true, write: false, format: 'esm', platform: 'browser', external: ['cloudflare:workers'], target: 'es2022' });
  return result.outputFiles[0].text;
}
test('real workerd SQLite Durable Object admits at most two concurrent reservations and persists counters across stubs', async () => {
  const script = await bundled('', `import {BudgetGuard} from './budget';export{BudgetGuard};export default{async fetch(request,env){const data=await request.json();const stub=env.BUDGET.get(env.BUDGET.idFromName('gcp-demo-budget-v1'));return Response.json(data.release?await stub.release(data.release)??{}:await stub.reserve(data.identity,'production'))}}`);
  const mf = new Miniflare({ modules: true, script, compatibilityDate: '2026-08-06', durableObjects: { BUDGET: { className: 'BudgetGuard', useSQLite: true } } }); active.push(mf);
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => mf.dispatchFetch('https://test.internal/reserve', { method: 'POST', body: JSON.stringify({ identity: (i + 1).toString(16).padStart(64, '0') }) }).then(response => response.json() as Promise<{ allowed: boolean; lease?: string; code?: string }>)));
  expect(results.filter(result => result.allowed)).toHaveLength(2);
  expect(results.filter(result => !result.allowed).every(result => result.code === 'busy')).toBe(true);
  for (const result of results.filter(result => result.allowed)) await mf.dispatchFetch('https://test.internal/release', { method: 'POST', body: JSON.stringify({ release: result.lease }) });
  const fresh = await mf.dispatchFetch('https://test.internal/reserve', { method: 'POST', body: JSON.stringify({ identity: 'f'.repeat(64) }) });
  expect(await fresh.json()).toMatchObject({ allowed: true });
}, 20000);
test('private MCP default network handler is 404 while only the named binding serves protocol requests', async () => {
  const server = await bundled('../src/mcp-worker.ts');
  const caller = `export default{fetch(request,env){return env.MCP.fetch(request)}}`;
  const mf = new Miniflare({ workers: [{ name: 'mcp-private', modules: true, script: server, compatibilityDate: '2026-08-06' }, { name: 'test-caller', modules: true, script: caller, compatibilityDate: '2026-08-06', serviceBindings: { MCP: { name: 'mcp-private', entrypoint: 'McpPrivate' } } }] }); active.push(mf);
  const options = { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }) };
  const direct = await (await mf.getWorker('mcp-private')).fetch('https://private.test/mcp', options);
  expect(direct.status).toBe(404);
  const internal = await (await mf.getWorker('test-caller')).fetch('https://private.test/mcp', options);
  expect(internal.status).toBe(200);
  expect(await internal.json()).toMatchObject({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18' } });
}, 20000);
test('budget SQLite counters survive runtime restart rather than relying on isolate memory', async () => {
  const script = await bundled('', `import {BudgetGuard} from './budget';export{BudgetGuard};export default{async fetch(request,env){const stub=env.BUDGET.get(env.BUDGET.idFromName('persistent-budget'));const result=await stub.reserve('a'.repeat(64),'production');if(result.allowed)await stub.release(result.lease);return Response.json(result)}}`);
  const directory = await mkdtemp(join(tmpdir(), 'gcp-copilot-budget-test-'));
  let runtime: Miniflare | undefined;
  try {
    const options = { modules: true, script, compatibilityDate: '2026-08-06', durableObjects: { BUDGET: { className: 'BudgetGuard', useSQLite: true } }, durableObjectsPersist: directory };
    runtime = new Miniflare(options);
    for (let n = 0; n < 3; n++) expect(await (await runtime.dispatchFetch('https://test.internal/')).json()).toMatchObject({ allowed: true });
    await runtime.dispose(); runtime = new Miniflare(options);
    expect(await (await runtime.dispatchFetch('https://test.internal/')).json()).toMatchObject({ allowed: false, code: 'rate_limited' });
  } finally {
    await runtime?.dispose();
    // mkdtemp creates one known test-owned directory beneath the system temp root.
    if (resolve(directory).startsWith(resolve(tmpdir()) + '\\') || resolve(directory).startsWith(resolve(tmpdir()) + '/')) await rm(directory, { recursive: true, force: true });
  }
}, 20000);
