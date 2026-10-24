import { NextResponse } from 'next/server'
import { ZodError } from 'zod'

// Global symbol keeps independent Next route bundles and development reloads on one process-wide slot.
const lockKey = Symbol.for('repolight.local-report-collection')
const processState = globalThis as unknown as Record<symbol, { active: boolean } | undefined>
const lock = processState[lockKey] ?? (processState[lockKey] = { active: false })
const MAX_BODY_BYTES = 65536
const response = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

/** Local development entry point, not an anonymous hosted SaaS API or tenant boundary. */
export async function handleLocalReportRequest(request: Request, analyze: (raw: unknown) => Promise<unknown>) {
  const url = new URL(request.url)
  // Next's development Request URL can use its internal localhost hostname even
  // when the browser connected to 127.0.0.1. Validate the actual Host, never X-Forwarded-Host.
  const host = request.headers.get('host') || url.host
  let origin: URL
  try { origin = new URL(`${url.protocol}//${host}`) } catch { return response({ error: 'Invalid local host.' }, 403) }
  if (process.env.NODE_ENV === 'production' || origin.host !== host.toLowerCase() || !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) return response({ error: 'Live analysis is available on the local development server. Hosted access is not configured.' }, 403)
  if (request.headers.get('origin') && request.headers.get('origin') !== origin.origin) return response({ error: 'Use the report form on this server.' }, 403)
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return response({ error: 'Send an application/json request.' }, 415)
  if (lock.active) return response({ error: 'Another repository is being analyzed. Try again when it finishes.' }, 429)
  lock.active = true
  try {
    const reader = request.body?.getReader()
    if (!reader) return response({ error: 'A report request is required.' }, 400)
    let size = 0
    const chunks: Uint8Array[] = []
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BODY_BYTES) { await reader.cancel(); return response({ error: 'Request exceeds 64 KiB.' }, 413) }
      chunks.push(value)
    }
    let body: unknown
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return response({ error: 'Invalid JSON request.' }, 400) }
    return response(await analyze(body))
  } catch (error) {
    if (error instanceof ZodError) return response({ error: error.issues[0]?.message || 'Invalid report settings.' }, 400)
    // Collector errors are deliberately sanitized; never forward raw response bodies or credentials.
    return response({ error: error instanceof Error ? error.message : 'Repository analysis failed.' }, 502)
  } finally { lock.active = false }
}
