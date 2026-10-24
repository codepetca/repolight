import { afterEach, describe, expect, it, vi } from 'vitest'
const { legacy, bundle } = vi.hoisted(() => ({ legacy: vi.fn(), bundle: vi.fn() }))
vi.mock('@/lib/report/analyze', () => ({ analyzePublicRepository: legacy }))
vi.mock('@/lib/report/bundle-analyze', () => ({ analyzePublicRepositoryBundle: bundle }))
import { POST } from '@/app/api/reports/repository/route'
import { POST as oldPOST } from '@/app/api/reports/analyze/route'

const request = (body: unknown = {}, headers: Record<string, string> = {}, host = 'localhost:3047') => new Request(`http://${host}/api/reports/repository`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks() })
describe('local repository bundle route', () => {
  it('returns bundles without cache and passes absent/invalid usernames to analysis', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    bundle.mockResolvedValue({ schemaVersion: '1.0' })
    const result = await POST(request({ githubUsername: 'bad / @' }))
    expect(result.status).toBe(200)
    expect(result.headers.get('cache-control')).toBe('no-store')
    expect(bundle).toHaveBeenCalledWith({ githubUsername: 'bad / @' })
  })
  it('enforces production, host, origin, JSON and byte limits', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect((await POST(request())).status).toBe(403)
    vi.stubEnv('NODE_ENV', 'development')
    expect((await POST(request({}, {}, 'example.test'))).status).toBe(403)
    expect((await POST(request({}, { origin: 'https://elsewhere.test' }))).status).toBe(403)
    expect((await POST(request({}, { 'Content-Type': 'text/plain' }))).status).toBe(415)
    expect((await POST(request('x'.repeat(65536)))).status).toBe(413)
    expect(bundle).not.toHaveBeenCalled()
  })
  it('shares the slot across separately loaded handler module instances', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    let resolve!: (value: unknown) => void
    bundle.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const pending = POST(request())
    await vi.waitFor(() => expect(bundle).toHaveBeenCalledOnce())
    vi.resetModules()
    const separate = await import('@/lib/report/local-route')
    const analyze = vi.fn().mockResolvedValue({})
    expect((await separate.handleLocalReportRequest(request(), analyze)).status).toBe(429)
    expect(analyze).not.toHaveBeenCalled()
    resolve({})
    expect((await pending).status).toBe(200)
    expect((await separate.handleLocalReportRequest(request(), analyze)).status).toBe(200)
  })
  it('shares one collection slot with the existing route and releases after errors', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    let reject!: (error: Error) => void
    bundle.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail }))
    const pending = POST(request())
    await vi.waitFor(() => expect(bundle).toHaveBeenCalledOnce())
    expect((await oldPOST(request())).status).toBe(429)
    reject(new Error('Collection unavailable.'))
    expect((await pending).status).toBe(502)
    legacy.mockResolvedValueOnce({})
    expect((await oldPOST(request())).status).toBe(200)
  })
})
