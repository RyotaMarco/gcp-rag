import { useEffect, useRef } from 'react'

let loading
function loadScript() {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (!loading) loading = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.onload = () => window.turnstile ? resolve(window.turnstile) : reject(new Error('verification_unavailable'))
    script.onerror = () => { loading = null; reject(new Error('verification_unavailable')) }
    document.head.append(script)
  })
  return loading
}

export default function Turnstile({ sitekey, locale, theme, onToken, onError, handleRef }) {
  const container = useRef(null)
  useEffect(() => {
    let active = true
    let widget
    onToken('')
    if (!sitekey) { onError(true); return }
    loadScript().then(api => {
      if (!active) return
      widget = api.render(container.current, {
        sitekey, action: 'gcp-demo-ask', theme, language: locale === 'pt' ? 'pt-BR' : 'en',
        callback: token => { if (active) { onToken(token); onError(false) } },
        'expired-callback': () => { if (active) onToken('') },
        'error-callback': () => { if (active) { onToken(''); onError(true) } },
      })
      handleRef.current = { reset: () => { onToken(''); api.reset(widget) } }
    }).catch(() => { if (active) onError(true) })
    return () => {
      active = false
      handleRef.current = null
      if (widget !== undefined) window.turnstile?.remove(widget)
    }
  }, [sitekey, locale, theme, onToken, onError, handleRef])
  return <div ref={container} className="verification-widget" />
}
