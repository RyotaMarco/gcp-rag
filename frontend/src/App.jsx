import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ApiProblem, readAnswer, safeSourceUrl } from './api'
import { copy, initialTheme, pathLocale } from './i18n'
import Turnstile from './Turnstile'
import './App.css'

const services = ['Vertex AI', 'Cloud Storage', 'BigQuery', 'Compute Engine', 'IAM', 'Cloud Run']

function MarkdownLink({ href, children }) {
  const safe = safeSourceUrl(href)
  return safe ? <a href={safe} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>
}
function CodeBlock({ children, t }) {
  const [copied, setCopied] = useState(false)
  const ref = useRef(null)
  async function copyCode() {
    try { await navigator.clipboard.writeText(ref.current?.textContent || ''); setCopied(true) } catch { setCopied(false) }
  }
  return <div className="code-block"><button type="button" className="copy-button" onClick={copyCode}>{copied ? t.copied : t.copy}</button><pre ref={ref}>{children}</pre></div>
}
function Sources({ sources, t, locale }) {
  const valid = Array.isArray(sources) ? sources.filter(source => source && safeSourceUrl(source.url)) : []
  if (!valid.length) return null
  return <section className="sources" aria-label={t.sources}><h4 className="eyebrow">{t.sources}</h4><small>{t.sourceHint}</small><ul>{valid.map(source => <li key={source.id}>
    <a href={safeSourceUrl(source.url)} target="_blank" rel="noopener noreferrer"><span><strong>{String(source.title || source.product || source.url).replace(/\s+Stay organized with collections\s+Save and categorize content based on your preferences\.?\s*$/i, '').trim()}</strong><small>{source.product}{source.section ? ` · ${source.section}` : ''}{source.crawled_at && Number.isFinite(Date.parse(source.crawled_at)) ? ` · ${t.collected}: ${new Intl.DateTimeFormat(locale === 'pt' ? 'pt-BR' : 'en-US', { dateStyle: 'medium' }).format(new Date(source.crawled_at))}` : ''}</small></span><span aria-hidden="true">↗</span></a>
    {(source.excerpt || source.quote) && <details><summary>{t.excerpt}</summary><blockquote>{String(source.excerpt || source.quote).slice(0, 2000)}</blockquote></details>}
  </li>)}</ul></section>
}
function ThemeIcon({ theme }) {
  return theme === 'dark'
    ? <svg key="sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></svg>
    : <svg key="moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14.5A9 9 0 0 1 9.5 3.5a9 9 0 1 0 11 11Z" /></svg>
}

export default function App() {
  const cloudflare = import.meta.env.VITE_DEPLOY_TARGET === 'cloudflare'
  const sitekey = import.meta.env.VITE_TURNSTILE_SITE_KEY || ''
  const [locale, setLocale] = useState(pathLocale)
  const [theme, setTheme] = useState(initialTheme)
  const t = copy[locale]
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [stage, setStage] = useState('retrieving')
  const [health, setHealth] = useState(null)
  const [coverage, setCoverage] = useState(null)
  const [healthError, setHealthError] = useState(false)
  const [error, setError] = useState(null)
  const [retryAt, setRetryAt] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [refresh, setRefresh] = useState(0)
  const [token, setToken] = useState('')
  const [verificationError, setVerificationError] = useState(false)
  const bottom = useRef(null)
  const inputRef = useRef(null)
  const inFlight = useRef(false)
  const request = useRef(null)
  const turnstile = useRef(null)
  const cancelled = useRef(false)
  const retrySeconds = Math.max(0, Math.ceil((retryAt - now) / 1000))
  const ready = health?.status === 'ready' && coverage?.enabled !== false
  const disabled = loading || retrySeconds > 0 || (cloudflare && (!ready || !token || verificationError))

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0c1016' : '#eeeae3')
    try { localStorage.setItem('gcp-theme', theme) } catch { /* Theme still works when storage is blocked. */ }
  }, [theme])
  useEffect(() => {
    document.documentElement.lang = locale === 'pt' ? 'pt-BR' : 'en'
    document.title = `${t.title} — ${locale === 'pt' ? 'Demo de documentação' : 'Documentation demo'}`
    document.querySelector('meta[name="description"]')?.setAttribute('content', t.description)
    document.querySelector('link[rel="canonical"]')?.setAttribute('href', `https://gcp.marco-ryota.com${locale === 'pt' ? '/pt' : '/'}`)
    try { localStorage.setItem('gcp-locale', locale) } catch { /* URL remains the language source of truth. */ }
    const listen = () => setLocale(pathLocale())
    window.addEventListener('popstate', listen)
    return () => window.removeEventListener('popstate', listen)
  }, [locale, t])
  useEffect(() => {
    let alive = true
    const controllers = new Set()
    async function fetchStatus(path) {
      const controller = new AbortController()
      controllers.add(controller)
      const timer = setTimeout(() => controller.abort(), 8000)
      try {
        const response = await fetch(path, { signal: controller.signal })
        const data = await response.json()
        if (!response.ok && response.status !== 503) throw new Error('health')
        return data
      } finally { clearTimeout(timer); controllers.delete(controller) }
    }
    async function check() {
      try {
        const [data, docs] = await Promise.all([fetchStatus('/api/health/ready'), cloudflare ? fetchStatus('/api/coverage') : Promise.resolve(null)])
        if (!data.checks || !['ready', 'not_ready'].includes(data.status)) throw new Error('health')
        if (alive) { setHealth(data); setCoverage(docs); setHealthError(false) }
      } catch { if (alive) { setHealth(null); setHealthError(true) } }
    }
    check()
    const interval = setInterval(check, 30000)
    return () => { alive = false; controllers.forEach(controller => controller.abort()); clearInterval(interval) }
  }, [refresh, cloudflare])
  useEffect(() => {
    if (!retryAt) return
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [retryAt])
  useEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    bottom.current?.scrollIntoView?.({ behavior: reduced ? 'auto' : 'smooth', block: 'end' })
  }, [messages, loading, error])
  useEffect(() => () => request.current?.abort(), [])

  function changeLanguage(next) {
    if (!['en', 'pt'].includes(next)) return
    history.pushState(null, '', next === 'pt' ? '/pt' : '/')
    setLocale(next)
  }
  function changeTheme() {
    const update = () => setTheme(current => current === 'dark' ? 'light' : 'dark')
    if (document.startViewTransition && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      const transition = document.startViewTransition(() => flushSync(update))
      transition.finished.catch(() => {})
    } else update()
  }
  async function sendMessage(value) {
    const question = (value ?? input).trim()
    if (!question || question.length > 2000 || inFlight.current || disabled) return
    inFlight.current = true
    cancelled.current = false
    const history = messages.filter(message => message.role === 'user' || message.role === 'assistant').slice(-6).map(({ role, content }) => ({ role, content: content.slice(0, 2000) }))
    setInput(''); setError(null); setLoading(true); setStage(cloudflare ? 'verifying' : 'retrieving')
    setMessages(previous => [...previous.slice(-79), { role: 'user', content: question }])
    const controller = new AbortController()
    request.current = controller
    let timedOut = false
    const timeout = setTimeout(() => { timedOut = true; controller.abort() }, 35000)
    try {
      const headers = { 'Content-Type': 'application/json', Accept: 'text/event-stream, application/json' }
      if (cloudflare) { headers['X-Turnstile-Token'] = token; setToken('') }
      const response = await fetch('/api/ask/', { method: 'POST', headers, body: JSON.stringify({ question, history, ...(cloudflare ? { locale } : {}) }), signal: controller.signal })
      const data = await readAnswer(response, setStage)
      setMessages(previous => [...previous, { role: 'assistant', content: data.answer, sources: data.sources, mode: data.mode, simulated: data.simulated }])
    } catch (problem) {
      const code = cancelled.current ? 'cancelled' : timedOut ? 'timeout' : problem instanceof ApiProblem ? problem.code : problem.name === 'AbortError' ? 'timeout' : 'network'
      setError(code)
      if (problem.retryAfter > 0) { const current = Date.now(); setRetryAt(current + problem.retryAfter * 1000); setNow(current) }
      setInput(question)
      setMessages(previous => previous.slice(0, -1))
    } finally {
      clearTimeout(timeout); inFlight.current = false; request.current = null; setLoading(false)
      if (cloudflare) turnstile.current?.reset()
      inputRef.current?.focus()
    }
  }
  const count = Number(coverage?.chunks ?? health?.indexed_chunks ?? 0)
  const hasCoverage = Array.isArray(coverage?.services) && coverage.services.length > 0 && Number(coverage.chunks) > 0
  const covered = hasCoverage ? coverage.services : cloudflare ? services : []
  const coverageDate = coverage?.collectedAt && Number.isFinite(Date.parse(coverage.collectedAt)) ? new Intl.DateTimeFormat(locale === 'pt' ? 'pt-BR' : 'en-US', { dateStyle: 'medium' }).format(new Date(coverage.collectedAt)) : null
  const portfolioUrl = `https://marco-ryota.com${locale === 'pt' ? '/pt' : '/'}?theme=${theme}`
  return <div className="app-shell">
    <a className="skip-link" href="#conversation">{t.chatLabel}</a>
    <header className="masthead">
      <a className="portfolio-link" href={portfolioUrl}>← {t.portfolio}</a>
      <div className="preferences"><div className="language-control" role="group" aria-label={t.language}>
        <button type="button" onClick={() => changeLanguage('en')} aria-pressed={locale === 'en'} lang="en">EN</button>
        <span aria-hidden="true">/</span><button type="button" onClick={() => changeLanguage('pt')} aria-pressed={locale === 'pt'} lang="pt-BR">PT</button>
      </div><button type="button" onClick={changeTheme} className="theme-toggle" aria-label={theme === 'dark' ? t.themeLight : t.themeDark}><ThemeIcon theme={theme} /></button></div>
    </header>
    <main className="workspace">
      <aside className="sidebar" aria-label={t.statusTitle}>
        <p className="eyebrow"><span className="signal-dot" aria-hidden="true" /> {t.eyebrow}</p>
        <h1>{t.headline}<em>{t.emphasis}</em></h1>
        <p className="intro">{t.description}</p>
        <section className="status-panel" aria-label={t.statusTitle}><div className="status-heading"><span className={`status-dot ${ready ? 'ready' : ''}`} aria-hidden="true" /><strong>{healthError ? t.unavailable : !health ? t.checking : ready ? t.ready : t.notReady}</strong><button type="button" className="icon-button" aria-label={t.refresh} onClick={() => setRefresh(value => value + 1)}>↻</button></div>
          {health && <dl><div><dt>{t.index}</dt><dd>{health.checks?.index && (cloudflare ? health.checks?.vectorize && health.checks?.d1 : health.checks?.qdrant) ? t.healthy : t.pending}</dd></div><div><dt>{t.chunks}</dt><dd>{Number.isFinite(count) ? count.toLocaleString(locale === 'pt' ? 'pt-BR' : 'en-US') : '—'}</dd></div><div><dt>{t.provider}</dt><dd>{health.checks?.provider_configured ? t.configured : t.missing}</dd></div><div><dt>{t.mcp}</dt><dd>{health.checks?.mcp ? t.available : t.pending}</dd></div></dl>}
          {healthError && <p className="health-issues">{t.apiError}</p>}
          {!cloudflare && health?.issues?.length > 0 && <ul className="health-issues">{health.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
        </section>
        <section className="coverage" aria-label={t.coverage}><h2 className="eyebrow">{cloudflare && !hasCoverage ? t.plannedCoverage : t.coverage}</h2><p>{cloudflare ? t.coverageDescription : t.localCoverageDescription}</p><ul>{covered.map(service => <li key={service}>{service}</li>)}</ul><small>{coverageDate ? `${t.collected}: ${coverageDate}` : cloudflare ? t.noCoverage : ''}</small></section>
        <p className="simulation-note"><span aria-hidden="true">↗</span>{t.simulationNote}</p>
      </aside>
      <section className="chat-panel" id="conversation" tabIndex={-1} aria-label={t.chatLabel}>
        <div className="chat-toolbar"><div><p className="eyebrow">{t.toolbar}</p><h2>{t.title}<span className="heading-dot">.</span></h2></div><button type="button" className="secondary-button" disabled={loading || !messages.length} onClick={() => { setMessages([]); setError(null); inputRef.current?.focus() }}>{t.newChat}<span aria-hidden="true">＋</span></button></div>
        <div className="conversation" role="log" aria-label={t.messages} aria-live="polite" aria-relevant="additions" aria-busy={loading}>
          {!messages.length && !loading && <div className="welcome"><p className="eyebrow">{t.welcomeLabel}</p><h3>{t.welcomeTitle}</h3><p>{t.welcomeDescription}</p><div className="example-list">{t.examples.map(([label, question]) => <button type="button" key={question} onClick={() => sendMessage(question)} disabled={disabled}><span><small>{label}</small>{question}</span><span aria-hidden="true">↗</span></button>)}</div></div>}
          {messages.map((message, index) => <article key={index} className={`message ${message.role}`}><div className="message-heading"><strong>{message.role === 'user' ? t.you : t.assistant}</strong>{message.mode && <span className="mode-label">{t.modes[message.mode]}</span>}{message.simulated && <span className="simulation-badge">{t.simulated}</span>}</div><div className="message-body"><ReactMarkdown skipHtml remarkPlugins={[remarkGfm]} components={{ a: MarkdownLink, pre: props => <CodeBlock {...props} t={t} />, img: () => null }}>{message.content}</ReactMarkdown></div><Sources sources={message.sources} t={t} locale={locale} /></article>)}
          {loading && <div className="thinking" role="status"><span className="thinking-bars" aria-hidden="true"><i /><i /><i /></span>{t.stages[stage] || t.stages.retrieving}</div>}
          {error && <div className="error-message" role="alert"><strong>{t.failureTitle}</strong><p>{t.errors[error] || t.errors.internal_error}</p><small>{t.retry}</small></div>}
          <div ref={bottom} />
        </div>
        <form className="composer" onSubmit={event => { event.preventDefault(); sendMessage() }}><label htmlFor="question">{t.ask}</label><div className="composer-input"><textarea id="question" ref={inputRef} value={input} disabled={loading} onChange={event => setInput(event.target.value)} maxLength={2000} rows={2} placeholder={t.placeholder} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); sendMessage() } }} />
          {loading ? <button type="button" className="cancel-button" onClick={() => { cancelled.current = true; request.current?.abort() }}>{t.cancel}</button> : <button type="submit" disabled={disabled || !input.trim()} aria-label={t.sendLabel}>{retrySeconds ? `${retrySeconds}s` : t.send}<span aria-hidden="true">↗</span></button>}
        </div><div className="composer-meta"><span>{retrySeconds ? t.waiting(retrySeconds) : t.keyboard}</span><span>{input.length}/2000</span></div>
          {cloudflare && <div className="verification"><Turnstile sitekey={sitekey} locale={locale} theme={theme} onToken={setToken} onError={setVerificationError} handleRef={turnstile} /><p>{verificationError || !sitekey ? t.verificationMissing : !ready ? t.notReadyHint : token ? '' : t.needsVerification}</p></div>}
        </form>
      </section>
    </main>
    <footer className="app-footer"><span>{t.footer}</span><p>{cloudflare ? t.privacy : t.localPrivacy}</p></footer>
  </div>
}
