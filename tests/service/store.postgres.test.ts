// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { acquireServiceFixtureLock } from './postgres-fixture-lock'
import { Pool } from 'pg'
import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServiceStore } from '@/lib/service/store'
import type { SqlExecutor } from '@/lib/service/sql-executor'
import type { LeaseIdentity, ServiceStore, StoredJob, WorkspaceRecord } from '@/lib/service/store-types'
import { buildPublicRepositoryBundle } from '@/lib/report/bundle-build'
import { makeRepositoryTarget } from '@/lib/engine/repo'
import { sampleSha, skyHopInput } from '../../fixtures/reports/sky-hop'

const target = process.env.REPOLIGHT_TEST_DATABASE_URL
if (target) {
  const url = new URL(target)
  if (url.hostname !== '127.0.0.1' || url.port !== '55487' || url.pathname !== '/repolight_service' || !['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Service tests require the explicit disposable 127.0.0.1:55487/repolight_service target.')
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
function settings() {
  const fixture = skyHopInput()
  return { repositoryUrl: fixture.repositoryUrl, branch: fixture.branch, period: fixture.period, scheduledProjectDates: fixture.scheduledProjectDates, exclusions: fixture.exclusions, baselineReviewed: true }
}
function snapshot() {
  const fixture = skyHopInput()
  return { ...fixture.snapshot, repositoryUrl: fixture.repositoryUrl, branch: fixture.branch }
}
function bundle(job: StoredJob) {
  const fixture = skyHopInput()
  return buildPublicRepositoryBundle({ bundleRef: job.id, settings: settings(), evidence: { target: makeRepositoryTarget(fixture.repositoryUrl, fixture.branch)!, snapshot: fixture.snapshot, events: fixture.events, coverage: fixture.coverage } })
}
const lease = (job: StoredJob): LeaseIdentity => ({ jobId: job.id, leaseToken: job.leaseToken!, leaseGeneration: job.leaseGeneration })

describe.skipIf(!target)('durable service store against disposable PostgreSQL', () => {
  let pool: Pool, store: ServiceStore
  let owners: string[], a: WorkspaceRecord, b: WorkspaceRecord
  let releaseFixtureLock: (() => Promise<void>) | undefined
  beforeAll(async () => {
    pool = new Pool({ connectionString: target!, max: 12 })
    releaseFixtureLock = await acquireServiceFixtureLock(pool)
    const executor: SqlExecutor = { async query<Row extends Record<string, unknown>>(text: string, parameters: unknown[] = []) { return (await pool.query(text, parameters)).rows as Row[] } }
    store = createServiceStore(executor)
    // Fresh disposable target only. Never reset or fall back to DATABASE_URL.
    const connection = await pool.connect()
    try {
      await connection.query('SELECT pg_advisory_lock(7839014522::bigint)')
      const { rows } = await connection.query("SELECT to_regclass('public.users') AS users,to_regclass('public.rl_analysis_jobs') AS jobs")
      if (!rows[0].users) {
        for (const filename of ['0000_curly_hellion.sql', '0001_external-run-identifiers.sql', '0002_living_forge.sql', '0003_service_reports.sql']) await connection.query(await readFile(new URL(`../../drizzle/${filename}`, import.meta.url), 'utf8'))
      } else if (!rows[0].jobs) {
        await connection.query(await readFile(new URL('../../drizzle/0003_service_reports.sql', import.meta.url), 'utf8'))
      }
    } finally { await connection.query('SELECT pg_advisory_unlock(7839014522::bigint)'); connection.release() }
  }, 30_000)
  beforeEach(async () => {
    owners = [randomUUID(), randomUUID()]
    for (const id of owners) await pool.query('INSERT INTO public.users(id,email,password_hash) VALUES($1,$2,$3)', [id, `fixture-${id}@example.test`, 'synthetic-not-a-login'])
    ;[a,b] = await Promise.all(owners.map(owner => store.getOrCreateWorkspace(owner)))
  })
  afterEach(async () => { if (owners) await pool.query('DELETE FROM public.users WHERE id=ANY($1::uuid[])', [owners]) })
  afterAll(async () => { try { await releaseFixtureLock?.() } finally { await pool?.end() } })
  const enqueue = async (workspace: WorkspaceRecord, idempotencyKey: string = randomUUID(), options: Partial<Parameters<ServiceStore['enqueueAnalysis']>[0]> = {}) => store.enqueueAnalysis({ workspaceId: workspace.id, idempotencyKey, request: settings(), requestFingerprint: digest(settings()), ...options })
  async function claimed(workspace: WorkspaceRecord = a) {
    const created = await enqueue(workspace)
    expect(created.kind).toBe('accepted')
    const result = await store.claimAnalysis({ workerId: 'fixture-worker' })
    expect(result?.workspaceId).toBe(workspace.id)
    return result!
  }
  async function completed() {
    const running = await claimed()
    expect(await store.pinSnapshot(lease(running), snapshot())).toBe(true)
    const result = bundle(running)
    expect(await store.completeAnalysis(lease(running), { bundle: result, reportDigest: digest(result) })).toBe(true)
    return running
  }
  it('isolates owners, scoped reads and key records without leaking hashes in metadata', async () => {
    expect(await store.getWorkspaceForOwner(owners[1], a.id)).toBeNull()
    expect((await Promise.all(Array.from({ length: 5 }, () => store.getOrCreateWorkspace(owners[0])))).every(value => value.id === a.id)).toBe(true)
    const id = randomUUID()
    const issued = await store.issueApiKey(a.id, { id, label: 'Pika', secretHash: 'a'.repeat(64), scopes: ['analyses:create','analyses:read'], installationRef: 'pika_fixture' })
    expect(issued).not.toHaveProperty('secretHash')
    expect((await store.findApiKey(id))?.workspaceId).toBe(a.id)
    expect(await store.listApiKeys(b.id)).toEqual([])
    expect(await store.revokeApiKey(b.id,id)).toBe(false)
    const wrongInstallation = await enqueue(a, randomUUID(), { createdByKeyId: id, clientBinding: { installationRef: 'other', subjectRef: 'opaque', sourceRevisionRef: 'r1' } })
    expect(wrongInstallation.kind).toBe('unauthorized')
    expect(await store.revokeApiKey(a.id,id)).toBe(true)
    expect(await store.findApiKey(id)).toBeNull()
    const result = await enqueue(a)
    if (result.kind !== 'accepted') throw new Error('fixture admission')
    expect(await store.getJob(b.id,result.job.id)).toBeNull()
    expect(await store.getResult(b.id,result.job.id)).toBeNull()
    expect(await store.getEdits(b.id,result.job.id)).toBeNull()
  })
  it('atomically deduplicates concurrent admission and rejects changed inputs under one key', async () => {
    const idempotencyKey = randomUUID()
    const results = await Promise.all(Array.from({ length: 10 }, () => enqueue(a,idempotencyKey)))
    expect(results.filter(value => value.kind === 'accepted')).toHaveLength(1)
    expect(results.filter(value => value.kind === 'replayed')).toHaveLength(9)
    expect(new Set(results.flatMap(value => 'job' in value ? [value.job.id] : [] )).size).toBe(1)
    expect((await enqueue(a,idempotencyKey,{ requestFingerprint: 'b'.repeat(64) })).kind).toBe('conflict')
    const other = await enqueue(b,idempotencyKey)
    expect(other.kind).toBe('accepted')
    expect((await store.listJobs(a.id))).toHaveLength(1)
  })
  it('enforces queue and daily limits under races, and replays without charging again', async () => {
    const raced = await Promise.all(Array.from({ length: 8 }, () => enqueue(a,randomUUID(),{ limits: { queuedPerWorkspace: 2 } })))
    expect(raced.filter(value => value.kind === 'accepted')).toHaveLength(2)
    expect(raced.filter(value => value.kind === 'limited')).toHaveLength(6)
    const first = await enqueue(b, 'daily-one', { limits: { dailyAdmissions: 1 } })
    expect(first.kind).toBe('accepted')
    expect((await enqueue(b, 'daily-one', { limits: { dailyAdmissions: 1 } })).kind).toBe('replayed')
    expect(await enqueue(b, 'daily-two', { limits: { dailyAdmissions: 1 } })).toEqual({ kind: 'limited', reason: 'daily_limit' })
  })
  it('limits authorized installation jobs after filtering even behind 50 newer foreign jobs', async () => {
    const binding = { installationRef: 'mine', subjectRef: 'submission', sourceRevisionRef: 'r1' }
    const limits = { queuedPerWorkspace: 100, dailyAdmissions: 100 }
    const first = await enqueue(a, randomUUID(), { clientBinding: binding, limits })
    if (first.kind !== 'accepted') throw new Error('fixture admission')
    for (let index = 0; index < 50; index++) expect((await enqueue(a, randomUUID(), { clientBinding: { ...binding, installationRef: 'other' }, limits })).kind).toBe('accepted')
    expect(await store.listJobs(a.id, 50, 'mine')).toEqual([first.job])
    expect(await store.listJobs(a.id, 50, 'other')).toHaveLength(50)
    expect(await store.listJobs(b.id, 50, 'mine')).toEqual([])
    const ownerList = await store.listJobs(a.id, 50)
    expect(ownerList).toHaveLength(50)
    expect(ownerList.some(job => job.id === first.job.id)).toBe(false)
  })
  it('claims one job per workspace and respects the global ceiling across concurrent workers', async () => {
    await enqueue(a); await enqueue(a); await enqueue(b)
    const jobs = await Promise.all(Array.from({ length: 8 }, (_, index) => store.claimAnalysis({ workerId: `worker-${index}` })))
    const active = jobs.filter((value): value is StoredJob => value !== null)
    expect(active).toHaveLength(2)
    expect(new Set(active.map(value => value.workspaceId)).size).toBe(2)
    expect(new Set(active.map(value => value.id)).size).toBe(2)
    expect(active.every(value => value.attemptCount===1 && value.leaseGeneration===1)).toBe(true)
  })
  it('fences stale tokens and generations on every worker mutation and persists only one report', async () => {
    const running = await claimed()
    const stale = { ...lease(running), leaseGeneration: running.leaseGeneration+1 }
    expect(await store.renewLease(stale)).toBe(false)
    expect(await store.pinSnapshot(stale,snapshot())).toBe(false)
    expect(await store.failOrRetryAnalysis(stale,{ code: 'upstream_timeout', retryable: true })).toBe(false)
    expect(await store.pinSnapshot(lease(running),snapshot())).toBe(true)
    expect(await store.pinSnapshot(lease(running),{ ...snapshot(), sha: sampleSha(999) })).toBe(false)
    const result = bundle(running)
    expect(await store.completeAnalysis(stale,{ bundle: result, reportDigest: digest(result) })).toBe(false)
    expect(await store.completeAnalysis(lease(running),{ bundle: result, reportDigest: digest(result) })).toBe(true)
    expect(await store.completeAnalysis(lease(running),{ bundle: result, reportDigest: digest(result) })).toBe(false)
    expect((await store.getResult(a.id,running.id))?.bundle).toEqual(result)
    expect(await store.getResult(b.id,running.id)).toBeNull()
    await expect(pool.query("UPDATE public.rl_reports SET report_digest=$1 WHERE id=$2",['c'.repeat(64),running.id])).rejects.toMatchObject({ code: '55000' })
    await expect(pool.query("UPDATE public.rl_analysis_jobs SET request_fingerprint=$1 WHERE id=$2",['c'.repeat(64),running.id])).rejects.toMatchObject({ code: '55000' })
  })
  it('recovers expired leases with a new fence, preserving the originally pinned snapshot', async () => {
    const first = await claimed()
    expect(await store.pinSnapshot(lease(first),snapshot())).toBe(true)
    await pool.query("UPDATE public.rl_analysis_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[first.id])
    expect(await store.renewLease(lease(first))).toBe(false)
    expect(await store.recoverExpiredJobs()).toBe(1)
    expect(await store.claimAnalysis({ workerId: 'too-early' })).toBeNull()
    await pool.query("UPDATE public.rl_analysis_jobs SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE id=$1",[first.id])
    const second = (await store.claimAnalysis({ workerId: 'replacement' }))!
    expect(second.leaseGeneration).toBe(2)
    expect(second.leaseToken).not.toBe(first.leaseToken)
    expect(second.snapshot).toEqual(snapshot())
    expect(await store.pinSnapshot(lease(first),snapshot())).toBe(false)
    expect(await store.pinSnapshot(lease(second),{ ...snapshot(), sha: sampleSha(100) })).toBe(false)
    expect(await store.pinSnapshot(lease(second),snapshot())).toBe(true)
  })
  it('bounds retries and turns an expired final attempt into a sanitized terminal failure', async () => {
    const result = await enqueue(a,randomUUID(),{ limits: { maxAttempts: 2 } })
    expect(result.kind).toBe('accepted')
    const first = (await store.claimAnalysis({ workerId: 'first' }))!
    expect(await store.failOrRetryAnalysis(lease(first),{ code: 'upstream_timeout', retryable: true, retryAfterSeconds: 1 })).toBe(true)
    expect(await store.claimAnalysis({ workerId: 'early' })).toBeNull()
    await pool.query("UPDATE public.rl_analysis_jobs SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE id=$1",[first.id])
    const second = (await store.claimAnalysis({ workerId: 'second' }))!
    await pool.query("UPDATE public.rl_analysis_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[second.id])
    expect(await store.recoverExpiredJobs()).toBe(1)
    const terminal = await store.getJob(a.id,first.id)
    expect(terminal).toMatchObject({ status: 'failed', attemptCount: 2, errorCode: 'attempts_exhausted', errorRetryable: false })
    expect(await store.claimAnalysis({ workerId: 'third' })).toBeNull()
  })
  it('checks revoked and expired issuing keys before claim and completion', async () => {
    const keyId = randomUUID()
    await store.issueApiKey(a.id,{ id:keyId,label:'service',secretHash:'a'.repeat(64),scopes:['analyses:create'] })
    const queued = await enqueue(a,randomUUID(),{ createdByKeyId:keyId })
    expect(queued.kind).toBe('accepted')
    const running = (await store.claimAnalysis({ workerId: 'worker' }))!
    await store.pinSnapshot(lease(running),snapshot())
    await store.revokeApiKey(a.id,keyId)
    const result = bundle(running)
    expect(await store.completeAnalysis(lease(running),{ bundle:result,reportDigest:digest(result) })).toBe(false)
    expect(await store.recoverExpiredJobs()).toBe(1)
    expect(await store.getJob(a.id,running.id)).toMatchObject({ status:'failed',errorCode:'credential_revoked' })
    const expiredId=randomUUID()
    await store.issueApiKey(b.id,{ id:expiredId,label:'expired',secretHash:'a'.repeat(64),scopes:['analyses:create'],expiresAt:'2000-01-01T00:00:00Z' })
    expect(await store.findApiKey(expiredId)).toBeNull()
    expect((await enqueue(b,randomUUID(),{ createdByKeyId:expiredId })).kind).toBe('unauthorized')
  })
  it('stores revisioned scope edits separately and rejects foreign owners, scopes and stale races', async () => {
    const running = await completed()
    const original = await store.getResult(a.id,running.id)
    const input = { workspaceId:a.id,reportRef:running.id,actorUserId:owners[0],scopeKey:'repository',expectedRevision:0,text:'Teacher revision' }
    const raced = await Promise.all([store.saveEdit(input),store.saveEdit({ ...input,text:'Other edit' })])
    expect(raced.filter(value=>value.kind==='saved')).toHaveLength(1)
    expect(raced.filter(value=>value.kind==='conflict')).toHaveLength(1)
    expect(await store.saveEdit({ ...input,scopeKey:'contributor:not-present' })).toEqual({ kind:'invalid_scope' })
    expect(await store.saveEdit({ ...input,actorUserId:owners[1] })).toEqual({ kind:'not_found' })
    expect(await store.saveEdit({ ...input,workspaceId:b.id })).toEqual({ kind:'not_found' })
    const restored=await store.saveEdit({ ...input,expectedRevision:1,text:null })
    expect(restored).toMatchObject({ kind:'saved',edit:{ text:null,revision:2 } })
    expect((await store.getEdits(a.id,running.id))?.[0]).toMatchObject({ revision:2,text:null })
    expect(await store.getResult(a.id,running.id)).toEqual(original)
  })
  it('rejects unpinned and mismatched snapshots before publishing a result', async () => {
    const running = await claimed()
    const result = bundle(running)
    expect(await store.completeAnalysis(lease(running),{ bundle:result,reportDigest:digest(result) })).toBe(false)
    expect(await store.pinSnapshot(lease(running),snapshot())).toBe(true)
    const different = structuredClone(result)
    different.context.snapshot.sha=sampleSha(999)
    expect(await store.completeAnalysis(lease(running),{ bundle:different,reportDigest:digest(different) })).toBe(false)
    expect(await store.getResult(a.id,running.id)).toBeNull()
    expect((await store.getJob(a.id,running.id))?.status).toBe('running')
  })
  it('fails queued jobs when their issuing key is revoked before any provider work', async () => {
    const id=randomUUID()
    await store.issueApiKey(a.id,{ id,label:'revoked before claim',secretHash:'a'.repeat(64),scopes:['analyses:create'] })
    const created=await enqueue(a,randomUUID(),{ createdByKeyId:id })
    if (created.kind!=='accepted') throw new Error('fixture admission')
    await store.revokeApiKey(a.id,id)
    expect(await store.claimAnalysis({workerId:'must-not-collect'})).toBeNull()
    expect(await store.getJob(a.id,created.job.id)).toMatchObject({status:'failed',attemptCount:0,errorCode:'credential_revoked'})
  })
  it('keeps service tables private and removes owner-scoped reports and edits with their synthetic owner', async () => {
    const running=await completed()
    await store.saveEdit({workspaceId:a.id,reportRef:running.id,actorUserId:owners[0],scopeKey:'repository',expectedRevision:0,text:'Private fixture'})
    const {rows}=await pool.query("SELECT relrowsecurity FROM pg_class WHERE oid=ANY(ARRAY['public.rl_workspaces'::regclass,'public.rl_api_keys'::regclass,'public.rl_analysis_jobs'::regclass,'public.rl_reports'::regclass,'public.rl_feedback_edits'::regclass])")
    expect(rows).toHaveLength(5)
    expect(rows.every(row=>row.relrowsecurity)).toBe(true)
    const grants=await pool.query("SELECT routine_name FROM information_schema.routine_privileges WHERE specific_schema='public' AND routine_name LIKE 'rl_%' AND grantee='PUBLIC'")
    expect(grants.rows).toEqual([])
    await pool.query('DELETE FROM public.users WHERE id=$1',[owners[0]])
    expect(await store.getWorkspaceForOwner(owners[0])).toBeNull()
    expect(await store.getResult(a.id,running.id)).toBeNull()
    expect(await store.getEdits(a.id,running.id)).toBeNull()
  })
})
