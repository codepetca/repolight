import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runWorkerOnce } from '@/lib/service/worker'
import { digestJson } from '@/lib/service/http'
import { GitHubCollectionError, type GitHubClient, type PublicCollectionOptions } from '@/lib/engine/github'
import { makeRepositoryTarget } from '@/lib/engine/repo'
import type { ServiceStore, StoredJob, PinnedSnapshot } from '@/lib/service/store-types'
import { skyHopInput } from '../../fixtures/reports/sky-hop'

const fixture = skyHopInput()
const snapshot: PinnedSnapshot = { repositoryUrl: fixture.repositoryUrl, branch: fixture.branch, ...fixture.snapshot, kind: 'analysis_time' }
let store: ServiceStore, job: StoredJob
const evidence = () => ({ target: makeRepositoryTarget(fixture.repositoryUrl, fixture.branch)!, snapshot: { ...fixture.snapshot, kind: 'analysis_time' as const }, events: fixture.events, coverage: fixture.coverage })
const client = (handler?: (options: PublicCollectionOptions) => Promise<ReturnType<typeof evidence>>) => ({ collectPublicReportEvidence: vi.fn(async (_target, options: PublicCollectionOptions = {}) => {
  if (handler) return handler(options)
  await options.onSnapshot?.(snapshot)
  return evidence()
}) }) as Pick<GitHubClient, 'collectPublicReportEvidence'>
beforeEach(() => {
  job = { id: '33333333-3333-4333-8333-333333333333', workspaceId: '22222222-2222-4222-8222-222222222222', createdByKeyId: null, idempotencyKey: 'one', request: { repositoryUrl: fixture.repositoryUrl, period: fixture.period, scheduledProjectDates: fixture.scheduledProjectDates, exclusions: fixture.exclusions, baselineReviewed: true }, requestFingerprint: 'a'.repeat(64), clientBinding: null, status: 'running', attemptCount: 1, maxAttempts: 3, nextAttemptAt: null, leaseToken: '44444444-4444-4444-8444-444444444444', leaseGeneration: 2, leaseExpiresAt: new Date(Date.now() + 90000).toISOString(), snapshot: null, reportRef: null, errorCode: null, errorRetryable: false, createdAt: new Date().toISOString(), completedAt: null, deadlineAt: new Date(Date.now() + 60000).toISOString() }
  store = { recoverExpiredJobs: vi.fn().mockResolvedValue(0), claimAnalysis: vi.fn().mockResolvedValue(job), renewLease: vi.fn().mockResolvedValue(true), pinSnapshot: vi.fn().mockResolvedValue(true), completeAnalysis: vi.fn().mockResolvedValue(true), failOrRetryAnalysis: vi.fn().mockResolvedValue(true) } as unknown as ServiceStore
})
afterEach(() => vi.useRealTimers())
describe('fenced persistent worker lifecycle', () => {
  it('pins before history, persists a stable bundle ref/digest and fences every write', async () => {
    const provider = client(async options => {
      await options.onSnapshot?.(snapshot)
      expect(store.pinSnapshot).toHaveBeenCalledOnce()
      return evidence()
    })
    expect(await runWorkerOnce(store, { client: provider })).toBe('completed')
    const [lease, result] = vi.mocked(store.completeAnalysis).mock.calls[0]
    expect(lease).toEqual({ jobId: job.id, leaseToken: job.leaseToken, leaseGeneration: 2 })
    expect(result.bundle.bundleRef).toBe(job.id)
    expect(result.reportDigest).toBe(digestJson(result.bundle))
    expect(vi.mocked(store.pinSnapshot).mock.calls[0][0]).toEqual(lease)
    expect(vi.mocked(store.renewLease).mock.calls[0][0]).toEqual(lease)
  })
  it('reuses the first persisted snapshot on retry', async () => {
    job.snapshot = snapshot
    const provider = client()
    await runWorkerOnce(store, { client: provider })
    expect(vi.mocked(provider.collectPublicReportEvidence).mock.calls[0][1]?.pinnedSnapshot).toEqual(snapshot)
  })
  it('stops collecting and cannot finish after heartbeat lease loss', async () => {
    vi.mocked(store.renewLease).mockResolvedValue(false)
    let signal: AbortSignal | undefined
    const provider = client(options => new Promise((_resolve, reject) => {
      signal = options.signal
      signal?.addEventListener('abort', () => reject(new Error('private network context')))
    }))
    expect(await runWorkerOnce(store, { client: provider, heartbeatMs: 5 })).toBe('lease_lost')
    expect(signal?.aborted).toBe(true)
    expect(store.completeAnalysis).not.toHaveBeenCalled()
    expect(store.failOrRetryAnalysis).not.toHaveBeenCalled()
  })
  it('does not proceed if snapshot persistence loses its lease', async () => {
    vi.mocked(store.pinSnapshot).mockResolvedValue(false)
    expect(await runWorkerOnce(store, { client: client() })).toBe('lease_lost')
    expect(store.completeAnalysis).not.toHaveBeenCalled()
    expect(store.failOrRetryAnalysis).not.toHaveBeenCalled()
  })
  it('enforces a hard attempt deadline even when collection ignores abort', async () => {
    const provider = client(() => new Promise(() => {}))
    expect(await runWorkerOnce(store, { client: provider, attemptTimeoutMs: 5 })).toBe('failed')
    expect(store.failOrRetryAnalysis).toHaveBeenCalledWith(expect.objectContaining({ leaseGeneration: 2 }), expect.objectContaining({ code: 'upstream_timeout', retryable: true }))
  })
  it.each([
    [new GitHubCollectionError('upstream_rate_limited', true, 'safe'), 'upstream_rate_limited', true],
    [new GitHubCollectionError('private_repository', false, 'safe'), 'private_repository', false],
    [new Error('rate limit secret token email@example.test'), 'internal_failure', false],
  ] as const)('classifies typed failures only', async (error, code, retryable) => {
    expect(await runWorkerOnce(store, { client: client(async () => { throw error }) })).toBe('failed')
    expect(store.failOrRetryAnalysis).toHaveBeenCalledWith(expect.anything(), { code, retryable, retryAfterSeconds: 15 })
  })
  it('bounds retries and observes the store completion fence', async () => {
    job.attemptCount = 3
    await runWorkerOnce(store, { client: client(async () => { throw new GitHubCollectionError('upstream_unavailable', true, 'safe') }) })
    expect(store.failOrRetryAnalysis).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ retryable: false, retryAfterSeconds: 60 }))
    vi.mocked(store.completeAnalysis).mockResolvedValue(false)
    expect(await runWorkerOnce(store, { client: client() })).toBe('lease_lost')
  })
  it('rejects oversized output before persistence', async () => {
    const oversized = evidence()
    oversized.events = [{ ...oversized.events[0], title: 'x'.repeat(4_000_000) }]
    expect(await runWorkerOnce(store, { client: client(async options => { await options.onSnapshot?.(snapshot); return oversized }) })).toBe('failed')
    expect(store.completeAnalysis).not.toHaveBeenCalled()
    expect(store.failOrRetryAnalysis).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ code: 'result_too_large', retryable: false }))
  })
  it('does no provider work when the queue is empty', async () => {
    vi.mocked(store.claimAnalysis).mockResolvedValue(null)
    const provider = client()
    expect(await runWorkerOnce(store, { client: provider })).toBe('idle')
    expect(provider.collectPublicReportEvidence).not.toHaveBeenCalled()
  })
})
