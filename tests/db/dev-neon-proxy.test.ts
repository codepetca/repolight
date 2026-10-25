// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Pool, PoolClient } from 'pg'
import { neon, neonConfig } from '@neondatabase/serverless'
import { createDevNeonProxy, validateLocalDatabase } from '../../scripts/dev-neon-proxy'
import { configureNeonTransport } from '@/db/neon-transport'

const database = 'postgresql://synthetic:synthetic-proxy-key@127.0.0.1:55487/repolight_service'
const original = neonConfig.fetchEndpoint
let close: (() => Promise<void>) | undefined
let endpoint: string
let query: ReturnType<typeof vi.fn>
let release: ReturnType<typeof vi.fn>
let connect: ReturnType<typeof vi.fn>
const result = { command: 'SELECT', rowCount: 1, fields: [{ name: 'answer', dataTypeID: 23 }], rows: [['42']] }

beforeEach(async () => {
  vi.stubEnv('NODE_ENV', 'test')
  query = vi.fn().mockResolvedValue(result); release = vi.fn()
  connect = vi.fn().mockResolvedValue({ query, release } as unknown as PoolClient)
  const { server } = createDevNeonProxy({ databaseUrl: database, pool: { connect } as unknown as Pool })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  close = () => new Promise<void>((resolve, reject) => { server.closeAllConnections(); server.close(error => error ? reject(error) : resolve()) })
  endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/sql`
  vi.stubEnv('REPOLIGHT_LOCAL_NEON_HTTP_URL', endpoint)
  configureNeonTransport(database)
})
afterEach(async () => { await close?.(); close = undefined; vi.unstubAllEnvs(); neonConfig.fetchEndpoint = original })
function request(body: unknown, extraHeaders: Record<string, string> = {}) {
  return fetch(endpoint, { method: 'POST', headers: { 'Neon-Connection-String': database,
    'Neon-Array-Mode': 'true', 'Neon-Raw-Text-Output': 'true', ...extraHeaders }, body: JSON.stringify(body) })
}

describe('loopback Neon HTTP protocol harness', () => {
  it('runs the real Neon SDK parameter protocol and parses OIDs/full results', async () => {
    query.mockResolvedValueOnce({ command: 'SELECT', rowCount: 1, fields: [
      { name: 'count', dataTypeID: 23 }, { name: 'meta', dataTypeID: 3802 },
      { name: 'instant', dataTypeID: 1184 }, { name: 'missing', dataTypeID: 25 },
    ], rows: [['42', '{"ok":true}', '2026-10-24 12:00:00+00', null]] })
    const sql = neon(database)
    const response = await sql.query('select $1', [42], { fullResults: true })
    expect(response.rows).toEqual([{ count: 42, meta: { ok: true }, instant: new Date('2026-10-24T12:00:00Z'), missing: null }])
    expect(response.rowCount).toBe(1)
    expect(query.mock.calls[0][0]).toMatchObject({ text: 'select $1', values: ['42'], rowMode: 'array' })
    expect(query.mock.calls[0][0].types.getTypeParser(1184)('raw text')).toBe('raw text')
    expect(release).toHaveBeenCalledOnce()
  })
  it('supports real SDK batch options, array mode and commit', async () => {
    const sql = neon(database)
    const response = await sql.transaction([sql.query('select 42'), sql.query('select 42')], {
      isolationLevel: 'Serializable', readOnly: true, deferrable: true, arrayMode: true,
    })
    expect(response).toEqual([[[42]], [[42]]])
    expect(query.mock.calls[0][0]).toBe('BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY DEFERRABLE')
    expect(query.mock.calls.at(-1)?.[0]).toBe('COMMIT')
  })
  it('rolls back a failed batch and preserves a safe database error code', async () => {
    query.mockResolvedValueOnce(result).mockResolvedValueOnce(result).mockRejectedValueOnce(Object.assign(new Error('sensitive SQL detail'), { code: '23505' }))
    const sql = neon(database)
    await expect(sql.transaction([sql.query('insert fixture'), sql.query('fail fixture')])).rejects.toMatchObject({ code: '23505', message: 'Local database request failed.' })
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK')
    expect(query.mock.calls.flat()).not.toContain('COMMIT')
    expect(release).toHaveBeenCalledOnce()
  })
  it.each([{ Origin: 'https://attacker.test' }, { 'Neon-Connection-String': database.replace('synthetic-proxy-key', 'wrong') }, { 'Sec-Fetch-Site': 'cross-site' }] as Record<string, string>[])('rejects browser requests and mismatched targets before database access', async headers => {
    const response = await request({ query: 'select 1', params: [] }, headers)
    expect(response.status).toBe(403); expect(connect).not.toHaveBeenCalled()
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })
  it('rejects invalid requests, oversized bodies and unsafe batch option text', async () => {
    expect((await request({ query: 'select $1', params: [123] })).status).toBe(400)
    expect((await request({ query: 'x'.repeat(1024 * 1024 + 1), params: [] })).status).toBe(413)
    expect((await request({ queries: [{ query: 'select 1', params: [] }] }, { 'Neon-Batch-Isolation-Level': 'x; DROP TABLE users' })).status).toBe(400)
    expect(connect).not.toHaveBeenCalled()
  })
  it('bounds response size and concurrency', async () => {
    query.mockResolvedValueOnce({ ...result, rows: [['x'.repeat(8 * 1024 * 1024)]] })
    expect((await request({ query: 'select large', params: [] })).status).toBe(400)
    const unblocks: (() => void)[] = []
    connect.mockImplementation(() => new Promise<PoolClient>(resolve => { unblocks.push(() => resolve({ query, release } as unknown as PoolClient)) }))
    const held = Array.from({ length: 4 }, () => request({ query: 'select 1', params: [] }))
    await vi.waitFor(() => expect(unblocks).toHaveLength(4))
    expect((await request({ query: 'select 1', params: [] })).status).toBe(429)
    unblocks.forEach(unblock => unblock())
    expect((await Promise.all(held)).map(response => response.status)).toEqual([200, 200, 200, 200])
  })
  it('fails closed for production and non-disposable database targets', () => {
    expect(() => validateLocalDatabase(database.replace('127.0.0.1', 'example.test'))).toThrow('disposable')
    expect(() => validateLocalDatabase(database + '?host=example.test')).toThrow('disposable')
    vi.stubEnv('NODE_ENV', 'production')
    expect(() => createDevNeonProxy({ databaseUrl: database })).toThrow('disabled')
  })
})
