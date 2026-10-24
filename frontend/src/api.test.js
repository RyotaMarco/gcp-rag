import { describe, expect, it } from 'vitest'
import { readAnswer, safeSourceUrl } from './api'

const final = { answer: 'Verified answer', sources: [], mode: 'rag', simulated: false }
function stream(parts) {
  const encoder = new TextEncoder()
  return new Response(new ReadableStream({ start(controller) { parts.forEach(part => controller.enqueue(encoder.encode(part))); controller.close() } }), { headers: { 'Content-Type': 'text/event-stream' } })
}
describe('bounded public response reader', () => {
  it('handles arbitrarily split event boundaries and requires a final answer', async () => {
    const message = `event: result\ndata: ${JSON.stringify(final)}\n\n`
    await expect(readAnswer(stream([...message]))).resolves.toEqual(final)
    await expect(readAnswer(stream([...message.replace(/\n/g, '\r\n')]))).resolves.toEqual(final)
    await expect(readAnswer(stream(['event: progress\ndata: {"stage":"retrieving"}\n\n']))).rejects.toMatchObject({ code: 'invalid_response' })
  })
  it('rejects duplicate results, oversized responses and provider errors', async () => {
    const message = `event: result\ndata: ${JSON.stringify(final)}\n\n`
    await expect(readAnswer(stream([message, message]))).rejects.toMatchObject({ code: 'invalid_response' })
    await expect(readAnswer(stream(['a'.repeat(130 * 1024)]))).rejects.toMatchObject({ code: 'invalid_response' })
    await expect(readAnswer(stream(['event: error\ndata: {"detail":{"code":"provider_quota","retry_after":300}}\n\n']))).rejects.toMatchObject({ code: 'provider_quota', retryAfter: 300 })
  })
  it('rejects deceptive source addresses and non-HTTPS URLs', () => {
    for (const value of ['javascript:alert(1)', 'http://cloud.google.com/docs', 'https://cloud.google.com.evil.example/docs', 'https://user:pass@cloud.google.com/docs', 'https://cloud.google.com:444/docs', '//cloud.google.com/docs']) expect(safeSourceUrl(value)).toBeNull()
    expect(safeSourceUrl('https://docs.cloud.google.com/storage/docs')).toBe('https://docs.cloud.google.com/storage/docs')
  })
})


it('formats longer retry windows as localized minutes/hours and an approximate time', async () => {
  const { copy } = await import('./i18n.js')
  expect(copy.en.waiting(300)).toContain('in 5 minutes')
  expect(copy.pt.waiting(300)).toContain('em 5 minutos')
  expect(copy.en.waiting(86400)).toContain('in 24 hours')
  expect(copy.en.waiting(86400)).not.toContain('86400s')
})
