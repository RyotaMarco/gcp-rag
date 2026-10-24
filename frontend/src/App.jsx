import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import './App.css'

const examples = [
  ['DOCUMENTAÇÃO', 'Como funciona o versionamento de modelos no Vertex AI?'],
  ['MCP · DEMONSTRAÇÃO', 'Liste os buckets do projeto de demonstração.'],
  ['DOCUMENTAÇÃO + MCP', 'Quais VMs estão ativas e como posso parar uma VM no Compute Engine?'],
]
const modeNames = { rag: 'Documentação', mcp: 'MCP', hybrid: 'Documentação + MCP', clarification: 'Esclarecimento', insufficient_evidence: 'Evidência insuficiente' }
const officialHosts = new Set(['cloud.google.com', 'docs.cloud.google.com', 'ai.google.dev', 'developers.google.com'])
function safeSourceUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && officialHosts.has(url.hostname) ? url.href : null
  } catch { return null }
}
function MarkdownLink({ href, children }) {
  const safe = safeSourceUrl(href)
  return safe ? <a href={safe} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>
}
function CodeBlock({ children }) {
  const [copied, setCopied] = useState(false)
  const ref = useRef(null)
  async function copy() {
    try { await navigator.clipboard.writeText(ref.current?.textContent || ''); setCopied(true) } catch { setCopied(false) }
  }
  return <div className="code-block"><button type="button" className="copy-button" onClick={copy}>{copied ? 'Copiado' : 'Copiar código'}</button><pre ref={ref}>{children}</pre></div>
}
function Sources({ sources }) {
  if (!sources?.length) return null
  return <div className="sources"><span className="eyebrow">FONTES CONSULTADAS</span><ol>{sources.map((source) => {
    const href = safeSourceUrl(source.url)
    if (!href) return null
    return <li key={source.id}><a href={href} target="_blank" rel="noopener noreferrer"><span className="source-id">[{source.id}]</span><span>{source.title || source.product || source.url}<small>{source.product}{source.section ? ` · ${source.section}` : ''}{source.crawled_at ? ` · Coleta: ${new Date(source.crawled_at).toLocaleDateString('pt-BR')}` : ''}</small></span><span aria-hidden="true">↗</span></a></li>
  })}</ol></div>
}

export default function App() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [health, setHealth] = useState(null)
  const [healthError, setHealthError] = useState(false)
  const [error, setError] = useState(null)
  const [retryAt, setRetryAt] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [refresh, setRefresh] = useState(0)
  const bottom = useRef(null)
  const inputRef = useRef(null)
  const inFlight = useRef(false)
  const request = useRef(null)
  const retrySeconds = Math.max(0, Math.ceil((retryAt - now) / 1000))

  useEffect(() => {
    let alive = true
    let controller
    async function check() {
      controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 8000)
      try {
        const res = await fetch('/api/health/ready', { signal: controller.signal })
        const data = await res.json()
        if (!res.ok && res.status !== 503) throw new Error('health')
        if (!data.checks) throw new Error('health')
        if (alive) { setHealth(data); setHealthError(false) }
      } catch { if (alive) { setHealth(null); setHealthError(true) } }
      finally { clearTimeout(timeout) }
    }
    check()
    const interval = setInterval(check, 30000)
    return () => { alive = false; controller?.abort(); clearInterval(interval) }
  }, [refresh])
  useEffect(() => {
    if (!retryAt) return
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [retryAt])
  useEffect(() => { bottom.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' }) }, [messages, loading, error])
  useEffect(() => () => request.current?.abort(), [])

  async function sendMessage(value) {
    const question = (value ?? input).trim()
    if (!question || inFlight.current || Date.now() < retryAt) return
    inFlight.current = true
    const history = messages.filter((m) => m.role === 'user' || m.role === 'assistant').slice(-6).map(({ role, content }) => ({ role, content: content.slice(0, 2000) }))
    setInput(''); setError(null); setLoading(true)
    setMessages((previous) => [...previous, { role: 'user', content: question }])
    const controller = new AbortController()
    request.current = controller
    const timeout = setTimeout(() => controller.abort(), 60000)
    try {
      const res = await fetch('/api/ask/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, history }), signal: controller.signal,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const detail = data.detail
        let seconds = Number(detail?.retry_after ?? res.headers.get('Retry-After'))
        if (!Number.isFinite(seconds)) seconds = Math.ceil((Date.parse(res.headers.get('Retry-After')) - Date.now()) / 1000)
        if (res.status === 429 && (!Number.isFinite(seconds) || seconds <= 0)) seconds = 60
        if (res.status === 429) { const current = Date.now(); setRetryAt(current + seconds * 1000); setNow(current) }
        const fallback = res.status === 429 ? 'A cota da API foi atingida. Aguarde antes de tentar novamente.' : 'Não foi possível concluir a consulta. Verifique o estado dos serviços.'
        throw new Error(typeof detail === 'object' && detail?.message ? detail.message : fallback)
      }
      if (typeof data.answer !== 'string') throw new Error('A API retornou uma resposta inválida. Tente novamente.')
      setMessages((previous) => [...previous, { role: 'assistant', content: data.answer, sources: data.sources, mode: data.mode, simulated: data.simulated }])
    } catch (err) {
      setError(err.name === 'AbortError' ? 'A consulta excedeu o tempo de espera. Tente novamente em instantes.' : err instanceof TypeError ? 'Sem conexão com a API. Verifique os serviços e tente novamente.' : err.message || 'Não foi possível concluir a consulta.')
      setInput(question)
      // Failed turns are omitted from subsequent model context.
      setMessages((previous) => previous.slice(0, -1))
    } finally {
      clearTimeout(timeout); inFlight.current = false; request.current = null; setLoading(false); inputRef.current?.focus()
    }
  }
  const ready = health?.status === 'ready'
  const disabled = loading || retrySeconds > 0
  return <div className="app-shell">
    <header className="masthead"><a className="brand" href="#" aria-label="GCP AI Assistant, início"><span className="brand-mark" aria-hidden="true">G<span>_</span></span><span><small>GOOGLE CLOUD · KNOWLEDGE COPILOT</small><strong>GCP AI ASSISTANT<span className="brand-dot">.</span></strong></span></a><span className="edition">RAG + MCP<span>PORTFÓLIO / 01</span></span></header>
    <main className="workspace">
      <aside className="sidebar" aria-label="Estado e recursos">
        <div className="sidebar-title"><span className="eyebrow">CENTRAL DE CONHECIMENTO</span><span className="chapter">01 /</span></div>
        <h1>Respostas com<br /><em>fundamento.</em></h1>
        <p className="intro">Documentação oficial do Google Cloud e ferramentas de demonstração, em uma conversa.</p>
        <section className="status-panel" aria-label="Estado dos serviços"><div className="status-heading"><span className={`status-dot ${ready ? 'ready' : ''}`} /><strong>{healthError ? 'API indisponível' : !health ? 'Verificando serviços' : ready ? 'Sistema pronto' : 'Preparação pendente'}</strong><button type="button" className="icon-button" aria-label="Atualizar estado dos serviços" onClick={() => setRefresh((v) => v + 1)}>↻</button></div>{health && <><dl><div><dt>Índice Qdrant</dt><dd>{health.checks?.index && health.checks?.qdrant ? 'Pronto' : 'Pendente'}</dd></div><div><dt>Trechos indexados</dt><dd>{Number(health.indexed_chunks || 0).toLocaleString('pt-BR')}</dd></div><div><dt>API de geração</dt><dd>{health.checks?.provider_configured ? 'Configurada' : 'Sem chave'}</dd></div><div><dt>MCP demonstrativo</dt><dd>{health.checks?.mcp ? 'Disponível' : 'Indisponível'}</dd></div></dl>{health.issues?.length > 0 && <ul className="health-issues">{health.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}</>}{healthError && <p className="health-issues">Não foi possível consultar o backend. Atualize o estado após iniciar os serviços.</p>}</section>
        <div className="sidebar-note"><span aria-hidden="true">↗</span><p>As respostas incluem fontes. Recursos de nuvem no MCP são fictícios e identificados como demonstração.</p></div>
        <div className="stack-label">REACT / FASTAPI / QDRANT / GROQ</div>
      </aside>
      <section className="chat-panel" aria-label="Conversa com o assistente"><div className="chat-toolbar"><div><span className="eyebrow">SEU ESPAÇO DE CONSULTA</span><h2>Converse com a documentação</h2></div><button type="button" className="secondary-button" disabled={loading || !messages.length} onClick={() => { setMessages([]); setError(null); inputRef.current?.focus() }}>Nova conversa <span aria-hidden="true">＋</span></button></div>
        <div className="conversation" role="log" aria-label="Mensagens" aria-live="polite" aria-busy={loading}>
          {!messages.length && !loading && <div className="welcome"><span className="welcome-kicker">DOCUMENTAÇÃO → EVIDÊNCIA → RESPOSTA</span><h3>Qual é a sua próxima<br />pergunta sobre GCP?</h3><p>Explore conceitos, encontre instruções ou consulte o projeto simulado.</p><div className="example-list">{examples.map(([label, question]) => <button type="button" key={question} onClick={() => sendMessage(question)} disabled={disabled}><span><small>{label}</small>{question}</span><span aria-hidden="true">↗</span></button>)}</div></div>}
          {messages.map((message, index) => <article key={index} className={`message ${message.role}`}><div className="message-heading"><strong>{message.role === 'user' ? 'VOCÊ' : 'ASSISTANT'}</strong>{message.mode && <span className="mode-label">{modeNames[message.mode] || message.mode}</span>}{message.simulated && <span className="simulation-badge">DADOS SIMULADOS</span>}</div><div className="message-body"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: MarkdownLink, pre: CodeBlock, img: () => null }}>{message.content}</ReactMarkdown></div><Sources sources={message.sources} /></article>)}
          {loading && <div className="thinking" role="status"><span className="thinking-bars" aria-hidden="true"><i /><i /><i /></span>Consultando evidências…</div>}
          {error && <div className="error-message" role="alert"><strong>Consulta não concluída</strong><p>{error}</p></div>}
          <div ref={bottom} />
        </div>
        <form className="composer" onSubmit={(event) => { event.preventDefault(); sendMessage() }}><label htmlFor="question">PERGUNTE AO ASSISTENTE</label><div className="composer-input"><textarea id="question" ref={inputRef} value={input} onChange={(event) => setInput(event.target.value)} maxLength={2000} rows={2} placeholder="Ex.: Como publicar um modelo no Vertex AI?" onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); sendMessage() } }} /><button type="submit" disabled={disabled || !input.trim()} aria-label="Enviar pergunta">{loading ? 'Buscando…' : retrySeconds ? `${retrySeconds}s` : 'Enviar'}<span aria-hidden="true">↗</span></button></div><div className="composer-meta"><span>{retrySeconds ? `Limite da API: tente novamente em ${retrySeconds}s.` : 'Enter para enviar · Shift + Enter para nova linha'}</span><span>{input.length}/2000</span></div></form>
      </section>
    </main>
    <footer className="app-footer"><span>CONHECIMENTO OFICIAL. CONTEXTO VERIFICÁVEL.</span><span>A qualidade depende das fontes disponíveis. Confira instruções antes de aplicá-las.</span></footer>
  </div>
}
