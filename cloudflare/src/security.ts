import type { Env, Locale, Message, Question } from './types';

const copy: Record<string, [string, string]> = {
  invalid_request: ['Please provide a valid question and conversation.', 'Envie uma pergunta e um histórico válidos.'],
  body_too_large: ['This request is too large.', 'Esta solicitação é muito grande.'],
  origin_forbidden: ['This origin cannot use the demo.', 'Esta origem não pode usar a demonstração.'],
  method_not_allowed: ['This method is not supported.', 'Este método não é aceito.'],
  unsupported_media_type: ['Send JSON to this endpoint.', 'Envie JSON para este endpoint.'],
  verification_required: ['Complete the anti-bot verification first.', 'Conclua a verificação anti-bot antes de continuar.'],
  verification_failed: ['The verification expired or failed. Please try again.', 'A verificação expirou ou falhou. Tente novamente.'],
  verification_unavailable: ['Verification is temporarily unavailable.', 'A verificação está temporariamente indisponível.'],
  rate_limited: ['Too many questions. Please wait before trying again.', 'Muitas perguntas. Aguarde antes de tentar novamente.'],
  daily_limit: ['The daily demo allowance has been reached.', 'A cota diária da demonstração foi atingida.'],
  busy: ['The demo is busy. Please try again shortly.', 'A demonstração está ocupada. Tente novamente em instantes.'],
  demo_disabled: ['This demo is not accepting live queries yet.', 'Esta demonstração ainda não está recebendo consultas ao vivo.'],
  index_unavailable: ['The documentation index is not ready.', 'O índice de documentação ainda não está pronto.'],
  provider_unavailable: ['The AI service is temporarily unavailable.', 'O serviço de IA está temporariamente indisponível.'],
  provider_quota: ['The AI allowance is temporarily unavailable. Please try later.', 'A cota de IA está temporariamente indisponível. Tente mais tarde.'],
  timeout: ['The request timed out. Please try again later.', 'O tempo da solicitação se esgotou. Tente mais tarde.'],
  mcp_unavailable: ['The simulated tools are temporarily unavailable.', 'As ferramentas simuladas estão temporariamente indisponíveis.'],
  internal_error: ['The demo could not complete this request.', 'A demonstração não conseguiu concluir esta solicitação.'],
};
export class ApiError extends Error {
  constructor(public code: string, public status: number, public retryAfter?: number) { super(code); }
  payload(locale: Locale) {
    const values = copy[this.code] || copy.internal_error;
    return { detail: { code: this.code, message: values[locale === 'pt' ? 1 : 0], ...(this.retryAfter === undefined ? {} : { retry_after: this.retryAfter }) } };
  }
}
export function apiError(error: unknown): ApiError { return error instanceof ApiError ? error : new ApiError('internal_error', 503, 60); }
export function normalize(value: string) { return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
export function isPortuguese(value: string) { return /\b(o que|como|qual|quais|meu|minha|meus|minhas|liste|listar|explique|existe|tabela|preciso|voce|isso|ele|ela|criar|nao|quanto|configuro|permissoes)\b/.test(normalize(value)); }
export function csv(value = '') { return value.split(',').map(item => item.trim()).filter(Boolean); }
export function localeFor(request: Request): Locale { return request.headers.get('Accept-Language')?.toLowerCase().startsWith('pt') ? 'pt' : 'en'; }
export function secureResponse(response: Response, api = false): Response {
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Strict-Transport-Security', 'max-age=31536000');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  headers.set('Content-Security-Policy', "default-src 'none'; script-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; base-uri 'none'; object-src 'none'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests");
  if (api) headers.set('Cache-Control', 'no-store');
  headers.delete('Access-Control-Allow-Origin');
  headers.delete('Access-Control-Allow-Credentials');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
export function errorResponse(error: unknown, locale: Locale): Response {
  const problem = apiError(error);
  return secureResponse(Response.json(problem.payload(locale), { status: problem.status, headers: problem.retryAfter === undefined ? {} : { 'Retry-After': String(problem.retryAfter) } }), true);
}
export async function parseQuestion(request: Request): Promise<Question> {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new ApiError('unsupported_media_type', 415);
  const advertised = request.headers.get('Content-Length');
  if (advertised !== null && (!/^\d+$/.test(advertised) || Number(advertised) > 32768)) throw new ApiError('body_too_large', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError('invalid_request', 400);
  const parts: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > 32768) { await reader.cancel(); throw new ApiError('body_too_large', 413); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  parts.forEach(part => { bytes.set(part, offset); offset += part.length; });
  let body: unknown;
  try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)); } catch { throw new ApiError('invalid_request', 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError('invalid_request', 400);
  const data = body as Record<string, unknown>;
  if (Object.keys(data).some(key => !['question', 'history', 'locale'].includes(key))) throw new ApiError('invalid_request', 400);
  if (typeof data.question !== 'string' || !data.question.trim() || data.question.length > 2000) throw new ApiError('invalid_request', 400);
  if (data.locale !== undefined && data.locale !== 'en' && data.locale !== 'pt') throw new ApiError('invalid_request', 400);
  const history = data.history ?? [];
  if (!Array.isArray(history) || history.length > 12) throw new ApiError('invalid_request', 400);
  for (const item of history) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(key => !['role', 'content'].includes(key)) || !['user', 'assistant'].includes(item.role) || typeof item.content !== 'string' || !item.content.trim() || item.content.length > 2000) throw new ApiError('invalid_request', 400);
  }
  return { question: data.question.trim(), history: history as Message[], locale: data.locale as Locale || (isPortuguese(data.question) ? 'pt' : localeFor(request)) };
}
export function assertOrigin(request: Request, env: Env) {
  const origin = request.headers.get('Origin');
  const requestOrigin = new URL(request.url).origin;
  if (!origin || origin !== requestOrigin || !csv(env.ALLOWED_ORIGINS).includes(origin)) throw new ApiError('origin_forbidden', 403);
  const fetchSite = request.headers.get('Sec-Fetch-Site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') throw new ApiError('origin_forbidden', 403);
}
export async function identityFor(ip: string, secret: string, time = Date.now()): Promise<string> {
  if (!ip || ip.length > 64 || !secret || secret.length < 32) throw new ApiError('verification_unavailable', 503, 60);
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const result = await crypto.subtle.sign('HMAC', key, encoder.encode(new Date(time).toISOString().slice(0, 10) + ':' + ip));
  return [...new Uint8Array(result)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function verifyTurnstile(request: Request, env: Env, signal: AbortSignal, fetcher: typeof fetch = fetch) {
  const token = request.headers.get('X-Turnstile-Token');
  if (!token || token.length > 2048) throw new ApiError('verification_required', 403);
  if (!env.TURNSTILE_SECRET_KEY || !csv(env.TURNSTILE_HOSTNAMES).length) throw new ApiError('verification_unavailable', 503, 60);
  let response: Response;
  try {
    response = await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: token }), signal });
  } catch { throw new ApiError('verification_unavailable', 503, 60); }
  if (!response.ok) throw new ApiError('verification_unavailable', 503, 60);
  let data: { success?: boolean; hostname?: string; action?: string };
  try { data = await response.json(); } catch { throw new ApiError('verification_unavailable', 503, 60); }
  if (!data.success || !data.hostname || !csv(env.TURNSTILE_HOSTNAMES).includes(data.hostname) || data.action !== 'gcp-demo-ask' || data.hostname !== new URL(request.url).hostname) throw new ApiError('verification_failed', 403);
}
export function safeSourceUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !['cloud.google.com', 'docs.cloud.google.com'].includes(url.hostname) || url.username || url.password || url.port || !url.pathname.startsWith('/') || url.hash || url.search) return null;
    const prefixes = ['/vertex-ai/docs/', '/storage/docs/', '/bigquery/docs/', '/compute/docs/', '/iam/docs/', '/run/docs/', '/gemini-enterprise-agent-platform/machine-learning/', '/gemini-enterprise-agent-platform/models/'];
    if (!prefixes.some(prefix => (url.pathname.replace(/\/$/, '') + '/').startsWith(prefix))) return null;
    return url.href;
  } catch { return null; }
}
export function ftsExpression(value: string): string {
  const terms = [...new Set(normalize(value).match(/[\p{L}\p{N}_]{2,40}/gu) || [])].slice(0, 16);
  const stop = new Set(['the', 'what', 'how', 'does', 'and', 'this', 'that', 'with', 'para', 'como', 'quais', 'qual', 'uma', 'isso', 'que', 'por']);
  return terms.filter(term => !stop.has(term)).map(term => '"' + term.replace(/"/g, '""') + '"').join(' OR ');
}
