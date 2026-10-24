// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { neonConfig } from '@neondatabase/serverless'
import { configureNeonTransport } from '@/db/neon-transport'

const database = 'postgresql://synthetic:synthetic-proxy-key@127.0.0.1:55487/repolight_service'
const original = neonConfig.fetchEndpoint

afterEach(() => { vi.unstubAllEnvs(); neonConfig.fetchEndpoint = original })

describe('explicit local Neon transport', () => {
  it('leaves default Neon transport unchanged without explicit opt-in', () => {
    vi.stubEnv('REPOLIGHT_LOCAL_NEON_HTTP_URL', '')
    configureNeonTransport('postgresql://fake:fake@example.test/fake')
    expect(neonConfig.fetchEndpoint).toBe(original)
  })
  it.each(['production', ''])('fails closed outside development/test (%s)', mode => {
    vi.stubEnv('NODE_ENV', mode)
    vi.stubEnv('REPOLIGHT_LOCAL_NEON_HTTP_URL', 'http://127.0.0.1:3348/sql')
    expect(() => configureNeonTransport(database)).toThrow('permitted only')
    expect(neonConfig.fetchEndpoint).toBe(original)
  })
  it.each(['https://example.test/sql', 'http://localhost:3348/sql', 'http://127.0.0.1:3348/other',
    'http://key@127.0.0.1:3348/sql', 'http://127.0.0.1:3348/sql?x=1', 'http://127.0.0.1:3348/sql#x', 'ftp://127.0.0.1/sql'])('rejects unsafe endpoint %s', endpoint => {
    vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('REPOLIGHT_LOCAL_NEON_HTTP_URL', endpoint)
    expect(() => configureNeonTransport(database)).toThrow('Local Neon endpoint')
  })
  it('requires the known disposable target and restores defaults after opt-out', () => {
    vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('REPOLIGHT_LOCAL_NEON_HTTP_URL', 'http://127.0.0.1:3348/sql')
    expect(() => configureNeonTransport(database.replace('55487', '5432'))).toThrow('disposable')
    configureNeonTransport(database)
    expect(neonConfig.fetchEndpoint).toBe('http://127.0.0.1:3348/sql')
    vi.stubEnv('REPOLIGHT_LOCAL_NEON_HTTP_URL', '')
    configureNeonTransport(database)
    expect(neonConfig.fetchEndpoint).toBe(original)
  })
})
