import { createHash } from 'node:crypto'
import { ZodError } from 'zod'

export class ServiceHttpError extends Error {
  constructor(public readonly code: string, public readonly status: number) { super(code) }
}
export function serviceJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}
export async function serviceHandle(action: () => Promise<Response>): Promise<Response> {
  try { return await action() }
  catch (error) {
    if (error instanceof ServiceHttpError) return serviceJson({ error: { code: error.code } }, error.status)
    if (error instanceof ZodError) return serviceJson({ error: { code: 'invalid_request' } }, 400)
    return serviceJson({ error: { code: 'internal_failure' } }, 500)
  }
}
export function requireSameOrigin(request: Request): void {
  const url = new URL(request.url)
  const loopback = (hostname: string) => ['localhost', '127.0.0.1', '[::1]'].includes(hostname)
  let expected = url.origin
  const configured = process.env.APP_ORIGIN
  if (configured) {
    let trusted: URL
    try { trusted = new URL(configured) } catch { throw new ServiceHttpError('service_not_configured', 503) }
    if (trusted.username || trusted.password || trusted.pathname !== '/' || trusted.search || trusted.hash || !['http:', 'https:'].includes(trusted.protocol) || (trusted.protocol !== 'https:' && !loopback(trusted.hostname))) throw new ServiceHttpError('service_not_configured', 503)
    expected = trusted.origin
  } else if (process.env.NODE_ENV === 'production') {
    throw new ServiceHttpError('service_not_configured', 503)
  } else if (loopback(url.hostname) && request.headers.has('host')) {
    // Next development may expose its internal localhost URL for a browser connected to 127.0.0.1.
    // Only an actual loopback Host is accepted; forwarding headers never establish trust.
    const host = request.headers.get('host')!
    let actual: URL
    try { actual = new URL(`${url.protocol}//${host}`) } catch { throw new ServiceHttpError('origin_rejected', 403) }
    if (actual.host !== host.toLowerCase() || !loopback(actual.hostname)) throw new ServiceHttpError('origin_rejected', 403)
    expected = actual.origin
  }
  if (request.headers.get('origin') !== expected) throw new ServiceHttpError('origin_rejected', 403)
}

export async function readServiceJson(request: Request): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new ServiceHttpError('json_required', 415)
  const reader = request.body?.getReader()
  if (!reader) throw new ServiceHttpError('invalid_request', 400)
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > 65_536) { await reader.cancel(); throw new ServiceHttpError('body_too_large', 413) }
      chunks.push(next.value)
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))
  } catch (error) {
    if (error instanceof ServiceHttpError) throw error
    throw new ServiceHttpError('invalid_request', 400)
  } finally { reader.releaseLock() }
}
/** Sorted object keys; array order remains meaningful. No request text enters errors. */
export function canonicalJson(value: unknown): string {
  const normalize = (child: unknown): unknown => Array.isArray(child) ? child.map(normalize) : child !== null && typeof child === 'object'
    ? Object.fromEntries(Object.entries(child).filter(([, value]) => value !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => [key, normalize(value)])) : child
  return JSON.stringify(normalize(value))
}
export function digestJson(value: unknown): string { return createHash('sha256').update(canonicalJson(value)).digest('hex') }
