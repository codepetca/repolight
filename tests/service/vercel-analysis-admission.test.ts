// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { after } from 'next/server'
import { POST } from '@/app/api/v2/analyses/route'
import { serviceApi } from '@/lib/service/runtime'
import { publishAnalysisWake } from '@/lib/service/vercel-analysis-wake'

vi.mock('next/server', () => ({ after: vi.fn() }))
vi.mock('@/lib/service/runtime', () => ({ serviceApi: vi.fn() }))
vi.mock('@/lib/service/vercel-analysis-wake', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/service/vercel-analysis-wake')>()),
  publishAnalysisWake: vi.fn(),
}))

const request = () => new Request('https://reports.example/api/v2/analyses', { method: 'POST' })
const create = vi.fn(async (_request: Request, options: { allowAdmission?: boolean; scheduleWake?: () => void } = {}) => {
  options.scheduleWake?.()
  return new Response(null, { status: 202 })
})

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(serviceApi).mockResolvedValue({ create } as unknown as Awaited<ReturnType<typeof serviceApi>>)
  vi.stubEnv('REPOLIGHT_VERCEL_BUILD', '0')
  vi.stubEnv('REPOLIGHT_ON_DEMAND_WORKER_ENABLED', undefined)
  vi.stubEnv('VERCEL', undefined)
  vi.stubEnv('VERCEL_DEPLOYMENT_ID', undefined)
  vi.stubEnv('VERCEL_ENV', undefined)
})

afterEach(() => vi.unstubAllEnvs())

describe('hosted analysis admission', () => {
  it('uses replay-only mode when the hosted worker is disabled or its runtime variables are missing', async () => {
    vi.stubEnv('REPOLIGHT_VERCEL_BUILD', '1')
    await POST(request())
    expect(create).toHaveBeenLastCalledWith(expect.any(Request), { allowAdmission: false, scheduleWake: undefined })
    vi.stubEnv('REPOLIGHT_ON_DEMAND_WORKER_ENABLED', 'true')
    await POST(request())
    expect(create).toHaveBeenLastCalledWith(expect.any(Request), { allowAdmission: false, scheduleWake: undefined })
    expect(after).not.toHaveBeenCalled()
  })

  it('uses local admission without a hosted wake for self-managed builds', async () => {
    expect((await POST(request())).status).toBe(202)
    expect(create).toHaveBeenCalledWith(expect.any(Request), { allowAdmission: true, scheduleWake: undefined })
    expect(after).not.toHaveBeenCalled()
  })

  it('returns admission before publishing and handles a post-response publish failure', async () => {
    vi.stubEnv('REPOLIGHT_ON_DEMAND_WORKER_ENABLED', 'true')
    vi.stubEnv('VERCEL', '1')
    vi.stubEnv('VERCEL_DEPLOYMENT_ID', 'dpl_fixture')
    const response = await POST(request())
    expect(response.status).toBe(202)
    expect(after).toHaveBeenCalledTimes(1)
    expect(publishAnalysisWake).not.toHaveBeenCalled()

    vi.mocked(publishAnalysisWake).mockRejectedValueOnce(new Error('private provider diagnostics'))
    const task = vi.mocked(after).mock.calls[0][0]
    if (typeof task !== 'function') throw new Error('Expected a deferred callback')
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await expect(task()).resolves.toBeUndefined()
      expect(publishAnalysisWake).toHaveBeenCalledTimes(1)
      expect(log.mock.calls).toEqual([['Analysis was queued but its immediate worker wake was unavailable.']])
    } finally { log.mockRestore() }
  })
})
