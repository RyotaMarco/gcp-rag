const MAX_RESPONSE_BYTES = 128 * 1024
const modes = new Set(['rag', 'mcp', 'hybrid', 'clarification', 'insufficient_evidence'])
const hosts = new Set(['cloud.google.com', 'docs.cloud.google.com', 'ai.google.dev'])

export class ApiProblem extends Error {
  constructor(code = 'internal_error', retryAfter = 0) { super(code); this.code = code; this.retryAfter = retryAfter }
}
export function safeSourceUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && hosts.has(url.hostname) ? url.href : null
  } catch { return null }
}
function validateAnswer(data) {
  if (!data || typeof data.answer !== 'string' || data.answer.length > 20000 || !Array.isArray(data.sources) || data.sources.length > 8 || !modes.has(data.mode)) throw new ApiProblem('invalid_response')
  return { answer: data.answer, sources: data.sources.filter(source => source && typeof source.id === 'string' && safeSourceUrl(source.url)), mode: data.mode, simulated: data.simulated === true }
}
function retrySeconds(value) {
  const number = Number(value)
  if (Number.isFinite(number) && number > 0) return Math.min(number, 86400)
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? Math.max(0, Math.min(86400, Math.ceil((timestamp - Date.now()) / 1000))) : 0
}
function problem(data, response) {
  return new ApiProblem(typeof data?.detail?.code === 'string' ? data.detail.code : response.status === 429 ? 'rate_limited' : 'internal_error', retrySeconds(data?.detail?.retry_after ?? response.headers.get('Retry-After')) || (response.status === 429 ? 60 : 0))
}
// Both JSON and SSE are read incrementally so an unbounded or incomplete response is rejected.
export async function readAnswer(response, onProgress = () => {}) {
  const sse = response.ok && response.headers.get('Content-Type')?.includes('text/event-stream')
  if (!response.body) throw new ApiProblem('invalid_response')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0, buffer = '', result = null
  function event(block) {
    let name = 'message'
    const lines = []
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) name = line.slice(6).trim()
      if (line.startsWith('data:')) lines.push(line.slice(5).trimStart())
    }
    if (!lines.length) return
    let data
    try { data = JSON.parse(lines.join('\n')) } catch { throw new ApiProblem('invalid_response') }
    if (name === 'error') throw problem(data, response)
    if (name === 'progress' && ['retrieving', 'generating', 'tools', 'verifying'].includes(data.stage)) onProgress(data.stage)
    if (name === 'result') { if (result) throw new ApiProblem('invalid_response'); result = validateAnswer(data) }
  }
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_RESPONSE_BYTES) throw new ApiProblem('invalid_response')
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n')
      if (sse) {
        let boundary
        while ((boundary = buffer.indexOf('\n\n')) !== -1) { event(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 2) }
      }
    }
    buffer += decoder.decode()
    if (sse) { if (buffer.trim()) event(buffer); if (!result) throw new ApiProblem('invalid_response'); return result }
    let data
    try { data = JSON.parse(buffer) } catch { throw new ApiProblem('invalid_response') }
    if (!response.ok) throw problem(data, response)
    return validateAnswer(data)
  } catch (error) { await reader.cancel().catch(() => {}); throw error }
  finally { reader.releaseLock() }
}
