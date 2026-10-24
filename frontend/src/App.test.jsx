import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App.jsx'

const ready = { status: 'ready', checks: { qdrant: true, index: true, provider_configured: true, mcp: true }, indexed_chunks: 142, issues: [] }
function response(data, status = 200, headers = {}) { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } }) }
function mockApi(answer = { answer: 'O Vertex AI organiza seus modelos. [S1]', sources: [], mode: 'rag', simulated: false }) {
  const fetchMock = vi.fn(async (url) => url.includes('/health/ready') ? response(ready) : response(answer))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
async function ask(text) {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('PERGUNTE AO ASSISTENTE'), text)
  await user.click(screen.getByRole('button', { name: 'Enviar pergunta' }))
}
beforeEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('GCP AI Assistant', () => {
  it('shows live readiness and count rather than a fixed online state', async () => {
    mockApi()
    render(<App />)
    expect(await screen.findByText('Sistema pronto')).toBeInTheDocument()
    expect(screen.getByText('142')).toBeInTheDocument()
    expect(screen.queryByText('2594')).not.toBeInTheDocument()
  })
  it('shows missing configuration without claiming readiness', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ ...ready, status: 'not_ready', checks: { ...ready.checks, index: false, provider_configured: false }, indexed_chunks: 0, issues: ['Configure GROQ_API_KEY no backend.'] }, 503)))
    render(<App />)
    expect(await screen.findByText('Preparação pendente')).toBeInTheDocument()
    expect(screen.getByText('Sem chave')).toBeInTheDocument()
    expect(screen.getByText('Configure GROQ_API_KEY no backend.')).toBeInTheDocument()
  })
  it('sends questions to the relative API and carries bounded conversation history', async () => {
    const fetchMock = mockApi()
    render(<App />)
    await ask('O que é Vertex AI?')
    expect(await screen.findByText('O Vertex AI organiza seus modelos. [S1]')).toBeInTheDocument()
    await ask('E suas versões?')
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url === '/api/ask/')).toHaveLength(2))
    const calls = fetchMock.mock.calls.filter(([url]) => url === '/api/ask/')
    const payload = JSON.parse(calls[1][1].body)
    expect(payload).toEqual({ question: 'E suas versões?', history: [{ role: 'user', content: 'O que é Vertex AI?' }, { role: 'assistant', content: 'O Vertex AI organiza seus modelos. [S1]' }] })
    expect(calls[0][1].headers).not.toHaveProperty('Authorization')
  })
  it('renders safe Markdown, official sources and simulated data badges', async () => {
    mockApi({ answer: '## Buckets\n\n**Dados fictícios**\n\n<script>alert(1)</script>\n\n[Inseguro](javascript:alert(1))', mode: 'hybrid', simulated: true, sources: [{ id: 'S1', title: 'Cloud Storage', url: 'https://docs.cloud.google.com/storage/docs', product: 'Cloud Storage' }, { id: 'S2', title: 'Malicious', url: 'https://example.com' }] })
    render(<App />)
    await ask('Liste os buckets')
    expect(await screen.findByRole('heading', { name: 'Buckets' })).toBeInTheDocument()
    expect(screen.getByText('DADOS SIMULADOS')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Cloud Storage/ })).toHaveAttribute('href', 'https://docs.cloud.google.com/storage/docs')
    expect(screen.queryByRole('link', { name: /Malicious/ })).not.toBeInTheDocument()
    expect(document.querySelector('script')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Inseguro' })).not.toBeInTheDocument()
  })
  it('honors rate-limit waiting without automatically retrying', async () => {
    const fetchMock = vi.fn(async (url) => url.includes('/health/ready') ? response(ready) : response({ detail: { code: 'rate_limited', message: 'Cota atingida.', retry_after: 30 } }, 429, { 'Retry-After': '30' }))
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)
    await ask('O que é GCP?')
    expect(await screen.findByRole('alert')).toHaveTextContent('Cota atingida.')
    expect(screen.getByRole('button', { name: 'Enviar pergunta' })).toBeDisabled()
    expect(screen.getByText('Limite da API: tente novamente em 30s.')).toBeInTheDocument()
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/ask/')).toHaveLength(1)
  })
  it('keeps failed questions editable and excludes them from future history', async () => {
    let attempts = 0
    const fetchMock = vi.fn(async (url) => {
      if (url.includes('/health/ready')) return response(ready)
      attempts += 1
      return attempts === 1 ? response({ detail: { code: 'provider_unavailable', message: 'Provedor indisponível.' } }, 503) : response({ answer: 'Resposta confirmada. [S1]', mode: 'rag', sources: [] })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)
    await ask('Primeira pergunta')
    expect(await screen.findByRole('alert')).toHaveTextContent('Provedor indisponível.')
    expect(screen.getByLabelText('PERGUNTE AO ASSISTENTE')).toHaveValue('Primeira pergunta')
    await userEvent.clear(screen.getByLabelText('PERGUNTE AO ASSISTENTE'))
    await ask('Segunda pergunta')
    await screen.findByText('Resposta confirmada. [S1]')
    const calls = fetchMock.mock.calls.filter(([url]) => url === '/api/ask/')
    expect(JSON.parse(calls.at(-1)[1].body).history).toEqual([])
  })
  it('limits model history message length to the backend contract', async () => {
    const fetchMock = mockApi({ answer: 'A'.repeat(2500), mode: 'rag', sources: [] })
    render(<App />)
    await ask('Explique Vertex AI')
    await screen.findByText('A'.repeat(2500))
    await ask('E suas versões?')
    const calls = fetchMock.mock.calls.filter(([url]) => url === '/api/ask/')
    const history = JSON.parse(calls.at(-1)[1].body).history
    expect(history[1].content).toHaveLength(2000)
  })
  it('clears a conversation and excludes failed turns from history', async () => {
    const fetchMock = mockApi()
    render(<App />)
    await ask('O que é Vertex AI?')
    await screen.findByText('O Vertex AI organiza seus modelos. [S1]')
    await userEvent.click(screen.getByRole('button', { name: /Nova conversa/ }))
    expect(screen.queryByText('O Vertex AI organiza seus modelos. [S1]')).not.toBeInTheDocument()
    await ask('Como funciona?')
    const calls = fetchMock.mock.calls.filter(([url]) => url === '/api/ask/')
    expect(JSON.parse(calls.at(-1)[1].body).history).toEqual([])
  })
})
