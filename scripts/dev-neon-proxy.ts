/** Disposable loopback development harness, matching @neondatabase/serverless 1.1.0 HTTP protocol. */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { Pool, type PoolClient, type QueryResult } from 'pg'

const MAX_BODY = 1024 * 1024
const MAX_RESPONSE = 8 * 1024 * 1024
const MAX_QUERIES = 100
const TIMEOUT_MS = 8000

type Query = { query: string; params: (string | null)[] }

export function validateLocalDatabase(databaseUrl: string): void {
  let target: URL
  try { target = new URL(databaseUrl) } catch { throw new Error('Invalid disposable database target.') }
  if (!['postgres:', 'postgresql:'].includes(target.protocol) || target.hostname !== '127.0.0.1'
    || target.port !== '55487' || target.pathname !== '/repolight_service'
    || !target.username || !target.password || target.search || target.hash) {
    throw new Error('Proxy requires the explicit disposable 127.0.0.1:55487/repolight_service target.')
  }
}
function matchesHeader(received: string | string[] | undefined, expected: string): boolean {
  if (typeof received !== 'string') return false
  const a = Buffer.from(received), b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
function send(response: ServerResponse, status: number, value: unknown) {
  if (response.destroyed || response.writableEnded) return
  const body = JSON.stringify(value)
  if (Buffer.byteLength(body) > MAX_RESPONSE) {
    response.writeHead(413, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    response.end('{"message":"Local database response exceeds limit."}')
    return
  }
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  response.end(body)
}
async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of request) {
    length += chunk.length
    if (length > MAX_BODY) throw new Error('body_limit')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
function parseQuery(value: unknown): Query {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_query')
  const record = value as Record<string, unknown>
  if (Object.keys(record).some(key => !['query', 'params'].includes(key))
    || typeof record.query !== 'string' || !record.query || record.query.length > 65536
    || !Array.isArray(record.params) || record.params.length > 1000
    || record.params.some(param => param !== null && typeof param !== 'string')) throw new Error('invalid_query')
  return record as Query
}
function serializeResult(result: QueryResult) {
  return { command: result.command, rowCount: result.rowCount, rows: result.rows,
    fields: result.fields.map(field => ({ name: field.name, dataTypeID: field.dataTypeID })) }
}
function transactionOptions(request: IncomingMessage): string {
  const isolation = request.headers['neon-batch-isolation-level']
  const levels: Record<string, string> = { ReadUncommitted: 'READ UNCOMMITTED', ReadCommitted: 'READ COMMITTED', RepeatableRead: 'REPEATABLE READ', Serializable: 'SERIALIZABLE' }
  if (isolation !== undefined && (typeof isolation !== 'string' || !levels[isolation])) throw new Error('invalid_transaction')
  const options: string[] = isolation ? [`ISOLATION LEVEL ${levels[isolation as string]}`] : []
  for (const [header, yes, no] of [['neon-batch-read-only', 'READ ONLY', 'READ WRITE'], ['neon-batch-deferrable', 'DEFERRABLE', 'NOT DEFERRABLE']]) {
    const value = request.headers[header]
    if (value !== undefined && value !== 'true' && value !== 'false') throw new Error('invalid_transaction')
    if (value !== undefined) options.push(value === 'true' ? yes : no)
  }
  return options.length ? `BEGIN ${options.join(' ')}` : 'BEGIN'
}

export function createDevNeonProxy(options: { databaseUrl: string; pool?: Pick<Pool, 'connect'> }) {
  if (!['development', 'test'].includes(process.env.NODE_ENV ?? '')) throw new Error('Local Neon proxy is disabled outside development or tests.')
  validateLocalDatabase(options.databaseUrl)
  const pool = options.pool ?? new Pool({ connectionString: options.databaseUrl, max: 4,
    connectionTimeoutMillis: 2000, idleTimeoutMillis: 5000, statement_timeout: 5000,
    query_timeout: TIMEOUT_MS, idle_in_transaction_session_timeout: 10000 })
  let active = 0
  const server = createServer(async (request, response) => {
    const port = (server.address() as { port: number } | null)?.port
    if (request.headers.host !== `127.0.0.1:${port}` || request.url !== '/sql' || request.method !== 'POST') {
      send(response, 404, { message: 'Not found.' }); return
    }
    if (request.headers.origin || ['sec-fetch-site', 'sec-fetch-dest', 'sec-fetch-user'].some(header => request.headers[header] !== undefined)
      || !matchesHeader(request.headers['neon-connection-string'], options.databaseUrl)
      || request.headers['neon-array-mode'] !== 'true' || request.headers['neon-raw-text-output'] !== 'true') {
      send(response, 403, { message: 'Local database request rejected.' }); return
    }
    if (Number(request.headers['content-length'] ?? 0) > MAX_BODY) { request.resume(); send(response, 413, { message: 'Local database request exceeds limit.' }); return }
    if (active >= 4) { send(response, 429, { message: 'Local database concurrency limit.' }); return }
    active++
    request.setTimeout(TIMEOUT_MS, () => request.destroy())
    let client: PoolClient | undefined
    let transaction = false
    try {
      const body = await readBody(request)
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid_query')
      const record = body as Record<string, unknown>
      const batch = 'queries' in record
      if (batch && (Object.keys(record).length !== 1 || !Array.isArray(record.queries)
        || !record.queries.length || record.queries.length > MAX_QUERIES)) throw new Error('invalid_query')
      const queries = batch ? (record.queries as unknown[]).map(parseQuery) : [parseQuery(body)]
      const begin = batch ? transactionOptions(request) : ''
      client = await pool.connect()
      if (batch) { await client.query(begin); transaction = true }
      const results = []
      for (const query of queries) {
        const result = await client.query({ text: query.query, values: query.params, rowMode: 'array',
          // Neon explicitly requests raw text and parses OIDs itself, including dates, JSON and bytea.
          types: { getTypeParser: () => (value: string) => value } })
        if (Array.isArray(result)) throw new Error('multiple_statements')
        results.push(serializeResult(result))
        if (Buffer.byteLength(JSON.stringify(results)) > MAX_RESPONSE) throw new Error('response_limit')
      }
      if (batch) { await client.query('COMMIT'); transaction = false }
      send(response, 200, batch ? { results } : results[0])
    } catch (error) {
      if (transaction && client) { try { await client.query('ROLLBACK') } catch { client.release(true); client = undefined } }
      const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && /^[A-Z0-9]{5}$/.test(error.code) ? error.code : undefined
      send(response, 400, { message: 'Local database request failed.', ...(code ? { code } : {}) })
    } finally { client?.release(); active-- }
  })
  server.requestTimeout = 10000
  server.headersTimeout = 5000
  server.keepAliveTimeout = 1000
  return { server, pool }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const databaseUrl = process.env.REPOLIGHT_LOCAL_NEON_DATABASE_URL ?? ''
    const port = Number(process.env.REPOLIGHT_LOCAL_NEON_HTTP_PORT ?? '3348')
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid local HTTP port.')
    const { server, pool } = createDevNeonProxy({ databaseUrl })
    server.listen(port, '127.0.0.1', () => process.stdout.write(`Local Neon test proxy listening on 127.0.0.1:${port}.\n`))
    const stop = () => { server.close(() => { if ('end' in pool && typeof pool.end === 'function') void pool.end() }) }
    process.once('SIGTERM', stop); process.once('SIGINT', stop)
  } catch {
    process.stderr.write('Local Neon proxy configuration rejected.\n'); process.exitCode = 1
  }
}
