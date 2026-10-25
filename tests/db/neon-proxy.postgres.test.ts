// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { neon, neonConfig } from '@neondatabase/serverless'
import { createDevNeonProxy } from '../../scripts/dev-neon-proxy'
import { configureNeonTransport } from '@/db/neon-transport'

const target = process.env.REPOLIGHT_TEST_DATABASE_URL
const original = neonConfig.fetchEndpoint

afterEach(() => { vi.unstubAllEnvs(); neonConfig.fetchEndpoint = original })

describe.skipIf(!target)('real disposable Postgres through Neon HTTP', () => {
  it('round trips typed values and transactions without modifying application tables', async () => {
    const { server, pool } = createDevNeonProxy({ databaseUrl: target! })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      vi.stubEnv('REPOLIGHT_LOCAL_NEON_HTTP_URL', `http://127.0.0.1:${(server.address() as { port: number }).port}/sql`)
      configureNeonTransport(target!)
      const sql = neon(target!)
      expect(await sql.query('SELECT $1::integer AS count, $2::jsonb AS metadata, $3::timestamptz AS instant',
        [42, { synthetic: true }, '2026-10-24T12:00:00Z'])).toEqual([{ count: 42, metadata: { synthetic: true }, instant: new Date('2026-10-24T12:00:00Z') }])
      expect(await sql.transaction([sql.query('SELECT 1 AS value'), sql.query('SELECT 2 AS value')],
        { isolationLevel: 'Serializable', readOnly: true, deferrable: true })).toEqual([[{ value: 1 }], [{ value: 2 }]])
      await expect(sql.transaction([sql.query('SELECT 1'), sql.query('SELECT 1 / 0')])).rejects.toMatchObject({ code: '22012' })
      expect(await sql.query('SELECT 3 AS recovered')).toEqual([{ recovered: 3 }])
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
      if ('end' in pool && typeof pool.end === 'function') await pool.end()
    }
  })
})
