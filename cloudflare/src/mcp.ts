import { ApiError, normalize } from './security';
import type { Env } from './types';

export const MCP_VERSION = '2025-06-18';
const buckets = [
  { name: 'demo-documents-private', location: 'US', public: false },
  { name: 'demo-public-assets', location: 'SOUTHAMERICA-EAST1', public: true },
];
const vms = [
  { name: 'demo-api-01', zone: 'us-central1-a', status: 'RUNNING', machine_type: 'e2-small' },
  { name: 'demo-worker-01', zone: 'us-central1-b', status: 'TERMINATED', machine_type: 'e2-medium' },
];
const datasets = [{ name: 'demo_analytics', location: 'US', tables: ['events', 'daily_usage'] }];
type ToolName = 'list_buckets' | 'list_vms' | 'list_datasets' | 'check_bucket_access' | 'check_table';
export type ToolRoute = { name: ToolName; arguments: Record<string, string> };
const definitions = [
  ['list_buckets', 'List fictional Cloud Storage buckets.', {}],
  ['list_vms', 'List fictional Compute Engine instances.', {}],
  ['list_datasets', 'List fictional BigQuery datasets.', {}],
  ['check_bucket_access', 'Check the simulated access of a fictional bucket.', { bucket: { type: 'string', maxLength: 64 } }],
  ['check_table', 'Check whether a fictional dataset contains a table.', { dataset: { type: 'string', maxLength: 64 }, table: { type: 'string', maxLength: 64 } }],
] as const;
export const toolDefinitions = definitions.map(([name, description, properties]) => ({ name, description, inputSchema: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }));
function toolValue(name: unknown, args: unknown) {
  const definition = toolDefinitions.find(tool => tool.name === name);
  if (!definition || !args || typeof args !== 'object' || Array.isArray(args)) throw new Error('invalid_tool');
  const values = args as Record<string, unknown>;
  const expected = Object.keys(definition.inputSchema.properties);
  if (Object.keys(values).length !== expected.length || expected.some(key => typeof values[key] !== 'string' || !/^[a-zA-Z_][\w-]{0,63}$/.test(String(values[key])))) throw new Error('invalid_arguments');
  if (Object.keys(values).some(key => !expected.includes(key))) throw new Error('invalid_arguments');
  let data: unknown;
  if (name === 'list_buckets') data = buckets;
  else if (name === 'list_vms') data = vms;
  else if (name === 'list_datasets') data = datasets;
  else if (name === 'check_bucket_access') {
    const found = buckets.find(bucket => bucket.name === values.bucket);
    data = { bucket: values.bucket, exists: Boolean(found), public: found?.public ?? null };
  } else {
    const found = datasets.find(dataset => dataset.name === values.dataset);
    data = { dataset: values.dataset, table: values.table, exists: Boolean(found?.tables.includes(String(values.table))) };
  }
  return { simulated: true, project: 'gcp-copilot-demo', data };
}
/** Stateless MCP Streamable HTTP JSON transport. No public network route calls this. */
export async function mcpResponse(request: Request): Promise<Response> {
  if (new URL(request.url).pathname !== '/mcp' || request.method !== 'POST') return new Response(null, { status: 404 });
  if (request.headers.get('Content-Type')?.split(';')[0] !== 'application/json' || Number(request.headers.get('Content-Length') || 0) > 8192) return new Response(null, { status: 415 });
  const accept = request.headers.get('Accept') || '';
  if (!accept.includes('application/json') || !accept.includes('text/event-stream')) return new Response(null, { status: 406 });
  const text = await request.text();
  if (new TextEncoder().encode(text).length > 8192) return new Response(null, { status: 413 });
  let rpc: Record<string, unknown>;
  try { rpc = JSON.parse(text); } catch { return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, { status: 400 }); }
  if (!rpc || rpc.jsonrpc !== '2.0' || typeof rpc.method !== 'string' || Array.isArray(rpc)) return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } }, { status: 400 });
  const id = typeof rpc.id === 'number' || typeof rpc.id === 'string' ? rpc.id : null;
  if (rpc.method === 'notifications/initialized' && rpc.id === undefined) return new Response(null, { status: 202 });
  const params = (rpc.params || {}) as Record<string, unknown>;
  let result: unknown;
  if (rpc.method === 'initialize') {
    if (!['2025-06-18', '2025-03-26', '2024-11-05'].includes(String(params.protocolVersion))) return Response.json({ jsonrpc: '2.0', id, error: { code: -32602, message: 'Unsupported protocol version' } });
    result = { protocolVersion: MCP_VERSION, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'GCP demonstration (fictional resources)', version: '1.0.0' }, instructions: 'Read-only fictional fixtures. Never access a real Google Cloud account.' };
  } else {
    if (request.headers.get('MCP-Protocol-Version') !== MCP_VERSION) return new Response(null, { status: 400 });
    if (rpc.method === 'ping') result = {};
    else if (rpc.method === 'tools/list') result = { tools: toolDefinitions };
    else if (rpc.method === 'tools/call') {
      try { const value = toolValue(params.name, params.arguments || {}); result = { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value, isError: false }; }
      catch { return Response.json({ jsonrpc: '2.0', id, error: { code: -32602, message: 'Unknown tool or invalid arguments' } }); }
    } else return Response.json({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
  }
  return Response.json({ jsonrpc: '2.0', id, result }, { headers: { 'Cache-Control': 'no-store' } });
}
export function toolRoute(question: string): ToolRoute | null {
  const q = normalize(question);
  const first = q.split(/\s+(?:and|e)\s+(?:explain|explique|describe|descreva|how|como|why|por que)\b/)[0];
  if (/\b(iam|roles?|permissoes|permissions?|praticas|practices|pricing|precos?|custos?|how|como|why|por que)\b/.test(first)) return null;
  const action = /^\s*(?:(?:please|por favor)[, ]+)?(?:list|show|check|liste|listar|mostre|verifique|verificar|consulte)\b/.test(q) || /\b(my|our|meu|minha|meus|minhas|exists|existe|existem)\b/.test(q) || /^\s*(?:quais|which)\s+(?:demo\s+)?(?:buckets|vms|datasets|instances|instancias|virtual machines)\b/.test(q);
  if (!action) return null;
  const table = question.match(/\b([a-zA-Z_][\w-]{0,63})\.([a-zA-Z_][\w-]{0,63})\b/);
  if (/\b(table|tabela)\b/.test(q) && table) return { name: 'check_table', arguments: { dataset: table[1], table: table[2] } };
  if (/\b(bucket|buckets)\b/.test(q)) {
    const name = q.match(/\bdemo-[a-z0-9-]{1,58}\b/);
    if (name && /\b(public|publico|acesso|access|check|verifique)\b/.test(q)) return { name: 'check_bucket_access', arguments: { bucket: name[0] } };
    return { name: 'list_buckets', arguments: {} };
  }
  if (/\b(vms?|instances?|machines?|instancias?|maquinas?|compute engine)\b/.test(q)) return { name: 'list_vms', arguments: {} };
  if (/\b(datasets?|bigquery|tabelas?|tables?)\b/.test(q)) return { name: 'list_datasets', arguments: {} };
  return null;
}
export async function callMcp(env: Env, route: ToolRoute | null, signal?: AbortSignal): Promise<unknown> {
  let sequence = 1;
  async function rpc(method: string, params?: unknown, notification = false) {
    if (signal?.aborted) throw new ApiError('timeout', 504, 60);
    const id = sequence++;
    let response: Response;
    try { response = await env.MCP.fetch(new Request('https://mcp.internal/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', 'MCP-Protocol-Version': MCP_VERSION }, body: JSON.stringify({ jsonrpc: '2.0', ...(notification ? {} : { id }), method, ...(params === undefined ? {} : { params }) }), signal })); }
    catch { throw new ApiError('mcp_unavailable', 503, 60); }
    if (notification && response.status === 202) return null;
    if (!response.ok || !response.headers.get('Content-Type')?.includes('application/json')) throw new ApiError('mcp_unavailable', 503, 60);
    const value = await response.json() as { jsonrpc?: string; id?: number; result?: Record<string, unknown>; error?: unknown };
    if (value.error || value.jsonrpc !== '2.0' || value.id !== id || !value.result) throw new ApiError('mcp_unavailable', 503, 60);
    return value.result;
  }
  const initialized = await rpc('initialize', { protocolVersion: MCP_VERSION, capabilities: {}, clientInfo: { name: 'gcp-copilot-worker', version: '1.0.0' } });
  if (initialized?.protocolVersion !== MCP_VERSION) throw new ApiError('mcp_unavailable', 503, 60);
  await rpc('notifications/initialized', undefined, true);
  const catalog = await rpc('tools/list');
  const tools = catalog?.tools as { name?: string }[];
  if (!Array.isArray(tools) || tools.length !== 5 || tools.some(tool => !toolDefinitions.some(allowed => allowed.name === tool.name))) throw new ApiError('mcp_unavailable', 503, 60);
  if (!route) return { healthy: true };
  const result = await rpc('tools/call', { name: route.name, arguments: route.arguments });
  const value = result?.structuredContent as { simulated?: boolean; project?: string; data?: unknown };
  if (result?.isError || !value || value.simulated !== true || value.project !== 'gcp-copilot-demo' || !Object.hasOwn(value, 'data')) throw new ApiError('mcp_unavailable', 503, 60);
  return value;
}
