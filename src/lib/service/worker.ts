import { randomUUID } from 'node:crypto'
import { ZodError } from 'zod'
import { GitHubClient, GitHubCollectionError, getGitHubToken, type PublicCollectionOptions } from '@/lib/engine/github'
import { makeRepositoryTarget } from '@/lib/engine/repo'
import { publicRepositoryRequestSchema } from '@/lib/report/bundle-contract'
import { buildPublicRepositoryBundle } from '@/lib/report/bundle-build'
import { digestJson } from './http'
import type { AnalysisErrorCode } from './contract'
import type { LeaseIdentity, ServiceStore } from './store-types'

export const MAX_SERVICE_RESULT_BYTES = 8_000_000
export interface WorkerOptions {
  workerId?: string; leaseSeconds?: number; heartbeatMs?: number; attemptTimeoutMs?: number;
  signal?: AbortSignal;
  client?: Pick<GitHubClient, 'collectPublicReportEvidence'>;
}
class WorkerFailure extends Error {
  constructor(public readonly code: AnalysisErrorCode, public readonly retryable: boolean) { super(code) }
}
export type WorkerOutcome = 'idle' | 'completed' | 'failed' | 'lease_lost'

/** Every mutation carries the claim's token and generation; the store additionally fences expiry. */
export async function runWorkerOnce(store: ServiceStore, options: WorkerOptions = {}): Promise<WorkerOutcome> {
  await store.recoverExpiredJobs()
  if (options.signal?.aborted) return 'idle'
  const leaseSeconds = Math.max(10, Math.min(options.leaseSeconds ?? 90, 300))
  const job = await store.claimAnalysis({ workerId: options.workerId ?? `worker-${randomUUID()}`, leaseSeconds })
  if (!job) return 'idle'
  if (!job.leaseToken) throw new Error('Invalid worker claim.')
  const lease: LeaseIdentity = { jobId: job.id, leaseToken: job.leaseToken, leaseGeneration: job.leaseGeneration }
  const controller = new AbortController()
  let leaseLost = false, stopped = false
  let heartbeat: ReturnType<typeof setTimeout> | undefined
  const abort = () => controller.abort()
  options.signal?.addEventListener('abort', abort, { once: true })
  if (options.signal?.aborted) controller.abort()
  const timeoutMs = Math.max(1, Math.min(options.attemptTimeoutMs ?? 150_000, Date.parse(job.deadlineAt) - Date.now()))
  const attemptDeadline = Date.now() + timeoutMs
  const deadline = setTimeout(abort, timeoutMs)
  const renew = async (): Promise<boolean> => {
    try {
      if (await store.renewLease(lease, leaseSeconds)) return true
    } catch { /* A worker with uncertain lease ownership must stop writing. */ }
    leaseLost = true
    controller.abort()
    return false
  }
  const tick = async () => {
    if (stopped) return
    await renew()
    if (!stopped && !leaseLost) heartbeat = setTimeout(tick, Math.min(options.heartbeatMs ?? leaseSeconds * 1000 / 3, leaseSeconds * 1000 / 2))
  }
  heartbeat = setTimeout(tick, Math.min(options.heartbeatMs ?? leaseSeconds * 1000 / 3, leaseSeconds * 1000 / 2))
  let rejectAbort!: (reason: unknown) => void
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject })
  const onAbort = () => rejectAbort(new WorkerFailure('upstream_timeout', true))
  controller.signal.addEventListener('abort', onAbort, { once: true })
  if (controller.signal.aborted) onAbort()
  try {
    const settings = publicRepositoryRequestSchema.parse(job.request)
    const target = makeRepositoryTarget(settings.repositoryUrl, settings.branch)!
    if (!settings.branch) target.branch = ''
    const collectionOptions: PublicCollectionOptions = {
      signal: controller.signal, pinnedSnapshot: job.snapshot ?? undefined, failOnTransientError: true,
      onSnapshot: async snapshot => {
        if (controller.signal.aborted) throw new WorkerFailure('upstream_timeout', true)
        if (!await store.pinSnapshot(lease, snapshot)) { leaseLost = true; controller.abort(); throw new WorkerFailure('internal_failure', false) }
      },
    }
    const client = options.client ?? new GitHubClient({ token: getGitHubToken() })
    const evidence = await Promise.race([client.collectPublicReportEvidence(target, collectionOptions), aborted])
    if (controller.signal.aborted) throw new WorkerFailure('upstream_timeout', true)
    const bundle = buildPublicRepositoryBundle({ bundleRef: job.id, settings, evidence })
    if (Date.now() >= attemptDeadline) throw new WorkerFailure('upstream_timeout', true)
    if (Buffer.byteLength(JSON.stringify(bundle), 'utf8') > MAX_SERVICE_RESULT_BYTES) throw new WorkerFailure('result_too_large', false)
    if (!await renew()) return 'lease_lost'
    if (controller.signal.aborted || Date.now() >= attemptDeadline) throw new WorkerFailure('upstream_timeout', true)
    return await store.completeAnalysis(lease, { bundle, reportDigest: digestJson(bundle) }) ? 'completed' : 'lease_lost'
  } catch (error) {
    if (leaseLost) return 'lease_lost'
    const failure = error instanceof GitHubCollectionError || error instanceof WorkerFailure ? { code: error.code, retryable: error.retryable }
      : error instanceof ZodError ? { code: 'invalid_evidence' as const, retryable: false }
        : { code: 'internal_failure' as const, retryable: false }
    controller.abort() // Stop any sibling collection requests before releasing/retrying this attempt.
    const saved = await store.failOrRetryAnalysis(lease, { ...failure, retryable: failure.retryable && job.attemptCount < job.maxAttempts && Date.now() < Date.parse(job.deadlineAt), retryAfterSeconds: Math.min(300, 15 * 2 ** Math.max(0, job.attemptCount - 1)) })
    return saved ? 'failed' : 'lease_lost'
  } finally {
    stopped = true
    clearTimeout(deadline)
    clearTimeout(heartbeat)
    controller.signal.removeEventListener('abort', onAbort)
    options.signal?.removeEventListener('abort', abort)
  }
}
