import { afterEach, describe, expect, it, vi } from 'vitest'
const { analyze } = vi.hoisted(() => ({ analyze:vi.fn() }))
vi.mock('@/lib/report/analyze', () => ({analyzePublicRepository:analyze}))
import { POST } from '@/app/api/reports/analyze/route'

const request = (url = 'http://localhost:3047/api/reports/analyze', headers: Record<string,string> = {}, body = '{}') => new Request(url, {method:'POST',headers:{'Content-Type':'application/json',...headers},body})
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks() })
describe('local-only analysis HTTP entry point', () => {
  it('returns analysis with no-store and does not require a database', async () => {
    vi.stubEnv('NODE_ENV','development')
    analyze.mockResolvedValue({ report:{snapshot:'synthetic'},ruleFeedback:{} })
    const result = await POST(request())
    expect(result.status).toBe(200)
    expect(result.headers.get('cache-control')).toBe('no-store')
    expect(analyze).toHaveBeenCalledWith({})
  })
  it('rejects production, nonlocal hosts and cross-origin browser requests before collection', async () => {
    vi.stubEnv('NODE_ENV','production')
    expect((await POST(request())).status).toBe(403)
    vi.stubEnv('NODE_ENV','development')
    expect((await POST(request('http://public.example/api/reports/analyze'))).status).toBe(403)
    expect((await POST(request(undefined,{origin:'https://elsewhere.example'}))).status).toBe(403)
    expect(analyze).not.toHaveBeenCalled()
  })
  it('checks actual loopback Host when Next uses an internal localhost request URL', async () => {
    vi.stubEnv('NODE_ENV','development')
    analyze.mockResolvedValue({})
    expect((await POST(request(undefined,{host:'127.0.0.1:3047',origin:'http://127.0.0.1:3047'}))).status).toBe(200)
    expect((await POST(request(undefined,{host:'public.example',origin:'http://public.example'}))).status).toBe(403)
    expect((await POST(request(undefined,{host:'localhost:3047',origin:'http://127.0.0.1:3047'}))).status).toBe(403)
  })
  it('bounds input and rejects malformed/non-JSON bodies', async () => {
    vi.stubEnv('NODE_ENV','development')
    expect((await POST(request(undefined,{'Content-Type':'text/plain'}))).status).toBe(415)
    expect((await POST(request(undefined,{},'{'))).status).toBe(400)
    expect((await POST(request(undefined,{},JSON.stringify('x'.repeat(65536))))).status).toBe(413)
    expect(analyze).not.toHaveBeenCalled()
  })
  it('rejects concurrent collection and releases the slot after errors', async () => {
    vi.stubEnv('NODE_ENV','development')
    let reject!: (error:Error) => void
    analyze.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail }))
    const first = POST(request())
    await vi.waitFor(() => expect(analyze).toHaveBeenCalledOnce())
    expect((await POST(request())).status).toBe(429)
    reject(new Error('GitHub unavailable.'))
    expect((await first).status).toBe(502)
    analyze.mockResolvedValueOnce({})
    expect((await POST(request())).status).toBe(200)
  })
})
