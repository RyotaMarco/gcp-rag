import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App.jsx'

const ready = { status: 'ready', checks: { qdrant: true, d1: true, vectorize: true, index: true, provider_configured: true, mcp: true }, indexed_chunks: 142, issues: [] }
const coverage = { version: 'docs-v1', services: ['Vertex AI', 'Cloud Storage'], pages: 20, chunks: 142, collectedAt: '2026-10-24T12:00:00Z', enabled: true }
function response(data, status = 200, headers = {}) { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } }) }
function mockApi(answer = { answer: 'Vertex AI organizes model versions. [S1]', sources: [], mode: 'rag', simulated: false }) {
  const fetchMock = vi.fn(async url => url.includes('/health/ready') ? response(ready) : url.includes('/coverage') ? response(coverage) : response(answer))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
async function ask(text) {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Ask the copilot'), text)
  await user.click(screen.getByRole('button', { name: 'Send question' }))
}
beforeEach(() => {
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs()
  localStorage.clear(); history.replaceState(null, '', '/'); document.documentElement.dataset.theme = 'dark'
})

describe('GCP AI Copilot', () => {
  it('shows live readiness and indexed count, without claiming inference has been verified', async () => {
    mockApi(); render(<App />)
    expect(await screen.findByText('Ready to explore')).toBeInTheDocument()
    expect(screen.getByText('142')).toBeInTheDocument()
    expect(screen.getByText('Configured')).toBeInTheDocument()
    expect(screen.queryByText('2594')).not.toBeInTheDocument()
  })
  it('shows missing local configuration while leaving simulated tools usable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ ...ready, status: 'not_ready', checks: { ...ready.checks, index: false, provider_configured: false }, indexed_chunks: 0, issues: ['Configure GROQ_API_KEY no backend.'] }, 503)))
    render(<App />)
    expect(await screen.findByText('Preparation pending')).toBeInTheDocument()
    expect(screen.getByText('Not configured')).toBeInTheDocument()
    expect(screen.getByText('Configure GROQ_API_KEY no backend.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /List the buckets/ })).not.toBeDisabled()
  })
  it('keeps the local Docker payload compatible and bounds conversation history', async () => {
    const fetchMock = mockApi(); render(<App />)
    await ask('What is Vertex AI?'); await screen.findByText('Vertex AI organizes model versions. [S1]')
    await ask('And its versions?')
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url === '/api/ask/')).toHaveLength(2))
    const calls = fetchMock.mock.calls.filter(([url]) => url === '/api/ask/')
    expect(JSON.parse(calls[1][1].body)).toEqual({ question: 'And its versions?', history: [{ role: 'user', content: 'What is Vertex AI?' }, { role: 'assistant', content: 'Vertex AI organizes model versions. [S1]' }] })
    expect(calls[0][1].headers).not.toHaveProperty('Authorization')
  })
  it('renders safe Markdown, exact allowed source hosts, excerpts and simulation badges', async () => {
    mockApi({ answer: '## Buckets\n\n**Fictional data**\n\n<script>alert(1)</script>\n\n[Unsafe](javascript:alert(1))\n\n![tracking](https://evil.example/image.png)', mode: 'hybrid', simulated: true, sources: [
      { id: 'S1', title: 'Cloud Storage docs Stay organized with collections Save and categorize content based on your preferences.', url: 'https://docs.cloud.google.com/storage/docs', product: 'Cloud Storage', excerpt: '<script>plain text only</script>' },
      { id: 'S2', title: 'Malicious', url: 'https://docs.cloud.google.com@evil.example' },
      { id: 'S3', title: 'Credentials', url: 'https://user:password@docs.cloud.google.com/storage/docs' },
      { id: 'S4', title: 'Port', url: 'https://docs.cloud.google.com:444/storage/docs' },
    ] }); render(<App />)
    await ask('List demo buckets')
    expect(await screen.findByRole('heading', { name: 'Buckets' })).toBeInTheDocument()
    expect(screen.getByText('SIMULATED DATA')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Cloud Storage docs/ })).toHaveAttribute('href', 'https://docs.cloud.google.com/storage/docs')
    expect(screen.queryByRole('link', { name: /Malicious|Credentials|Port|Unsafe/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Cloud Storage docs/ })).not.toHaveTextContent('Stay organized with collections')
    await userEvent.click(screen.getByText('Supporting passage'))
    expect(screen.getByText('<script>plain text only</script>')).toBeInTheDocument()
    expect(document.querySelector('script')).not.toBeInTheDocument()
    expect(document.querySelector('img')).not.toBeInTheDocument()
  })
  it('honors retry waiting, keeps failed questions editable and does not automatically retry', async () => {
    const fetchMock = vi.fn(async url => url.includes('/health/ready') ? response(ready) : response({ detail: { code: 'rate_limited', message: 'Untrusted provider detail', retry_after: 30 } }, 429, { 'Retry-After': '30' }))
    vi.stubGlobal('fetch', fetchMock); render(<App />); await ask('What is GCP?')
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many questions in a short time.')
    expect(screen.queryByText('Untrusted provider detail')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send question' })).toBeDisabled()
    expect(screen.getByText('Please wait 30s before trying again.')).toBeInTheDocument()
    expect(screen.getByLabelText('Ask the copilot')).toHaveValue('What is GCP?')
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/ask/')).toHaveLength(1)
  })
  it('omits failed turns from subsequent model history', async () => {
    let attempts = 0
    const fetchMock = vi.fn(async url => {
      if (url.includes('/health/ready')) return response(ready)
      return ++attempts === 1 ? response({ detail: { code: 'provider_unavailable' } }, 503) : response({ answer: 'Confirmed answer.', sources: [], mode: 'rag', simulated: false })
    })
    vi.stubGlobal('fetch', fetchMock); render(<App />)
    await ask('First question'); await screen.findByRole('alert')
    await userEvent.clear(screen.getByLabelText('Ask the copilot')); await ask('Second question'); await screen.findByText('Confirmed answer.')
    const calls = fetchMock.mock.calls.filter(([url]) => url === '/api/ask/')
    expect(JSON.parse(calls.at(-1)[1].body).history).toEqual([])
  })
  it('limits prior message length and clears the conversation explicitly', async () => {
    const fetchMock = mockApi({ answer: 'A'.repeat(2500), mode: 'rag', sources: [] }); render(<App />)
    await ask('Explain Vertex AI'); await screen.findByText('A'.repeat(2500)); await ask('And its versions?')
    await waitFor(() => expect(screen.getByRole('button', { name: /New conversation/ })).not.toBeDisabled())
    const calls = fetchMock.mock.calls.filter(([url]) => url === '/api/ask/')
    expect(JSON.parse(calls.at(-1)[1].body).history[1].content).toHaveLength(2000)
    await userEvent.click(screen.getByRole('button', { name: /New conversation/ }))
    expect(screen.queryByText('A'.repeat(2500))).not.toBeInTheDocument()
    await ask('How does it work?')
    expect(JSON.parse(fetchMock.mock.calls.filter(([url]) => url === '/api/ask/').at(-1)[1].body).history).toEqual([])
  })
  it('changes URL and interface language without losing messages or the draft', async () => {
    mockApi(); render(<App />)
    await ask('What is Vertex AI?'); await screen.findByText('Vertex AI organizes model versions. [S1]')
    await userEvent.type(screen.getByLabelText('Ask the copilot'), 'Draft preserved')
    await userEvent.click(screen.getByRole('button', { name: 'PT', exact: true }))
    expect(location.pathname).toBe('/pt')
    expect(document.documentElement.lang).toBe('pt-BR')
    expect(screen.getByLabelText('Pergunte ao copilot')).toHaveValue('Draft preserved')
    expect(screen.getByText('Vertex AI organizes model versions. [S1]')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Voltar ao portfólio/ })).toHaveAttribute('href', 'https://marco-ryota.com/pt?theme=dark')
    expect(localStorage.getItem('gcp-locale')).toBe('pt')
  })
  it('parses SSE progress but only renders the validated final result', async () => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream({ start(controller) {
      controller.enqueue(encoder.encode('event: progress\ndata: {"stage":"generating"}\n\nevent: token\ndata: {"text":"Do not display"}\n\n'))
      controller.enqueue(encoder.encode('event: result\ndata: {"answer":"Final verified answer.","sources":[],"mode":"rag","simulated":false}\n\n'))
      controller.close()
    } })
    vi.stubGlobal('fetch', vi.fn(async url => url.includes('/health/ready') ? response(ready) : new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })))
    render(<App />); await ask('How does GCP work?')
    expect(await screen.findByText('Final verified answer.')).toBeInTheDocument()
    expect(screen.queryByText('Do not display')).not.toBeInTheDocument()
  })
  it('blocks Cloudflare requests until real readiness and a verification token are available', async () => {
    vi.stubEnv('VITE_DEPLOY_TARGET', 'cloudflare'); vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'test-sitekey')
    let verify
    vi.stubGlobal('turnstile', { render: vi.fn((node, options) => { verify = options.callback; return 'widget' }), remove: vi.fn(), reset: vi.fn() })
    const fetchMock = mockApi(); render(<App />)
    await screen.findByText('Ready to explore')
    await userEvent.type(screen.getByLabelText('Ask the copilot'), 'What is Vertex AI?')
    expect(screen.getByRole('button', { name: 'Send question' })).toBeDisabled()
    await waitFor(() => expect(verify).toBeTypeOf('function'))
    const { act } = await import('@testing-library/react')
    await act(async () => verify('single-use-token'))
    await userEvent.click(screen.getByRole('button', { name: 'Send question' }))
    await screen.findByText('Vertex AI organizes model versions. [S1]')
    const call = fetchMock.mock.calls.find(([url]) => url === '/api/ask/')
    expect(call[1].headers['X-Turnstile-Token']).toBe('single-use-token')
    expect(JSON.parse(call[1].body).locale).toBe('en')
    expect(window.turnstile.reset).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Send question' })).toBeDisabled()
  })
  it('fails closed in the public demo if Turnstile is not configured', async () => {
    vi.stubEnv('VITE_DEPLOY_TARGET', 'cloudflare'); vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '')
    const fetchMock = mockApi(); render(<App />)
    await screen.findByText('Ready to explore')
    expect(screen.getByText(/The security check is unavailable/)).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Ask the copilot'), 'Question')
    expect(screen.getByRole('button', { name: 'Send question' })).toBeDisabled()
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/ask/')).toBe(false)
  })
  it('allows cancellation without sending a retry or retaining an unfinished model turn', async () => {
    const fetchMock = vi.fn(async (url, options) => {
      if (url.includes('/health/ready')) return response(ready)
      return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))))
    })
    vi.stubGlobal('fetch', fetchMock); render(<App />)
    await ask('Question to cancel')
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel request' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Request cancelled.')
    expect(screen.getByLabelText('Ask the copilot')).toHaveValue('Question to cancel')
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/ask/')).toHaveLength(1)
  })

})
