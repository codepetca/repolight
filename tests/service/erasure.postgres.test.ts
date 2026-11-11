// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { acquireServiceFixtureLock } from './postgres-fixture-lock'
import { Pool, type PoolClient } from 'pg'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServiceStore } from '@/lib/service/store'
import type { SqlExecutor } from '@/lib/service/sql-executor'
import type { ServiceStore, StoredJob, WorkspaceRecord } from '@/lib/service/store-types'
import { buildPublicRepositoryBundle } from '@/lib/report/bundle-build'
import { makeRepositoryTarget } from '@/lib/engine/repo'
import { digestJson } from '@/lib/service/http'
import { skyHopInput } from '../../fixtures/reports/sky-hop'
const target = process.env.REPOLIGHT_TEST_DATABASE_URL
if (target) { const url = new URL(target); if (url.hostname !== '127.0.0.1' || url.port !== '55487' || url.pathname !== '/repolight_service') throw new Error('Erasure tests require the authorized disposable service database.') }
const fixture = skyHopInput()
const settings = { repositoryUrl: fixture.repositoryUrl, branch: fixture.branch, period: fixture.period, scheduledProjectDates: fixture.scheduledProjectDates, exclusions: fixture.exclusions, baselineReviewed: true }
const binding = { installationRef: 'erasure-fixture', subjectRef: 'subject', sourceRevisionRef: 'revision' }
const operation = () => ({ schemaVersion: '1.0' as const, operationRef: randomUUID(), installationRef: binding.installationRef, subjectRef: binding.subjectRef })
const lease = (job: StoredJob) => ({ jobId: job.id, leaseToken: job.leaseToken!, leaseGeneration: job.leaseGeneration })
const snapshot = { ...fixture.snapshot, repositoryUrl: fixture.repositoryUrl, branch: fixture.branch, kind: 'analysis_time' as const }
function executor(connection: Pool | PoolClient): SqlExecutor { return { async query<Row extends Record<string, unknown>>(sql: string, args: unknown[] = []) { return (await connection.query(sql, args)).rows as Row[] } } }
function bundle(job: StoredJob) { return buildPublicRepositoryBundle({ bundleRef: job.id, settings, evidence: { target: makeRepositoryTarget(fixture.repositoryUrl, fixture.branch)!, snapshot: fixture.snapshot, events: fixture.events, coverage: fixture.coverage } }) }
describe.skipIf(!target)('permanent subject erasure in disposable PostgreSQL', () => {
  let pool: Pool, store: ServiceStore, owners: string[], a: WorkspaceRecord, b: WorkspaceRecord
  let releaseFixtureLock: (() => Promise<void>) | undefined
  beforeAll(async () => {
    pool = new Pool({ connectionString: target!, max: 8 })
    releaseFixtureLock = await acquireServiceFixtureLock(pool)
    store = createServiceStore(executor(pool))
    const connection = await pool.connect()
    try {
      await connection.query('SELECT pg_advisory_lock(7839014522::bigint)')
      const { rows } = await connection.query("SELECT to_regclass('public.rl_subject_erasures') AS tombstones,to_regclass('public.rl_analysis_jobs') AS jobs")
      if (!rows[0].jobs) throw new Error('Existing authorized service fixture must already contain migration0003.')
      if (!rows[0].tombstones) await connection.query(await readFile(new URL('../../drizzle/0004_subject_erasures.sql', import.meta.url), 'utf8'))
    } finally { await connection.query('SELECT pg_advisory_unlock(7839014522::bigint)'); connection.release() }
  }, 30_000)
  beforeEach(async () => {
    owners = [randomUUID(), randomUUID()]
    for (const id of owners) await pool.query('INSERT INTO public.users(id,email,password_hash) VALUES($1,$2,$3)', [id, `erasure-fixture-${id}@example.test`, 'synthetic-not-a-login'])
    ;[a,b] = await Promise.all(owners.map(id => store.getOrCreateWorkspace(id)))
  })
  afterEach(async () => { if (owners) await pool.query('DELETE FROM public.users WHERE id=ANY($1::uuid[])', [owners]) })
  afterAll(async () => { try { await releaseFixtureLock?.() } finally { await pool?.end() } })
  async function enqueue(workspace = a, subject = binding, idempotencyKey: string = randomUUID()) {
    return store.enqueueAnalysis({ workspaceId: workspace.id, request: settings, requestFingerprint: digestJson(settings), clientBinding: subject, idempotencyKey })
  }
  async function running() {
    const queued = await enqueue()
    if (queued.kind !== 'accepted') throw new Error('fixture admission failed')
    // Mutate only this fixture's job; never globally claim a browser-smoke owner's work.
    await pool.query("UPDATE public.rl_analysis_jobs SET status='running',attempt_count=1,lease_generation=1,lease_token=$2,lease_expires_at=clock_timestamp()+interval '90 seconds',worker_id='erasure-fixture' WHERE id=$1 AND workspace_id=$3", [queued.job.id, randomUUID(), a.id])
    return (await store.getJob(a.id, queued.job.id))!
  }
  it('replays existing requests read-only with workspace, live key, exact body and tombstone checks', async () => {
    const keyId = randomUUID()
    await store.issueApiKey(a.id, { id: keyId, label: 'Replay fixture', secretHash: 'a'.repeat(64), scopes: ['analyses:create'], installationRef: binding.installationRef })
    const input = { workspaceId: a.id, createdByKeyId: keyId, request: settings, requestFingerprint: digestJson(settings), clientBinding: binding, idempotencyKey: randomUUID() }
    expect(await store.replayAnalysis(input)).toEqual({ kind: 'unavailable' })
    expect(await store.listJobs(a.id)).toEqual([])
    const admitted = await store.enqueueAnalysis(input)
    if (admitted.kind !== 'accepted') throw new Error('fixture admission failed')
    expect(await store.replayAnalysis(input)).toEqual({ kind: 'replayed', job: admitted.job })
    expect(await store.replayAnalysis({ ...input, workspaceId: b.id })).toEqual({ kind: 'unauthorized' })
    expect(await store.replayAnalysis({ ...input, request: { ...settings, branch: 'different' } })).toEqual({ kind: 'conflict' })
    expect(await store.revokeApiKey(a.id, keyId)).toBe(true)
    expect(await store.replayAnalysis(input)).toEqual({ kind: 'unauthorized' })
    expect(await store.eraseSubject({ workspaceId: a.id, request: operation() })).toMatchObject({ kind: 'erased' })
    expect(await store.replayAnalysis({ ...input, createdByKeyId: null })).toEqual({ kind: 'subject_erased' })
  })
  it('erases all job states, reports and edits, verifies absence and permanently rejects future creates', async () => {
    const completed = await running(), report = bundle(completed)
    await store.pinSnapshot(lease(completed), snapshot)
    expect(await store.completeAnalysis(lease(completed), { bundle: report, reportDigest: digestJson(report) })).toBe(true)
    await store.saveEdit({ workspaceId: a.id, reportRef: completed.id, actorUserId: owners[0], scopeKey: 'repository', expectedRevision: 0, text: 'Private fixture edit' })
    const failed = await running()
    await store.failOrRetryAnalysis(lease(failed), { code: 'internal_failure', retryable: false })
    const active = await running()
    await enqueue()
    const input = operation()
    const erased = await store.eraseSubject({ workspaceId: a.id, request: input })
    expect(erased).toEqual({ kind: 'erased', receipt: { ...input, status: 'erased', absenceVerified: true } })
    expect(await store.listJobs(a.id)).toEqual([])
    expect(await store.getResult(a.id, completed.id)).toBeNull()
    expect(await store.getEdits(a.id, completed.id)).toBeNull()
    for (const mutation of [store.renewLease(lease(active)), store.pinSnapshot(lease(active), snapshot), store.completeAnalysis(lease(active), { bundle: bundle(active), reportDigest: digestJson(bundle(active)) }), store.failOrRetryAnalysis(lease(active), { code: 'upstream_timeout', retryable: true })]) expect(await mutation).toBe(false)
    expect((await enqueue()).kind).toBe('subject_erased')
    expect((await enqueue(a, binding, completed.idempotencyKey)).kind).toBe('subject_erased')
  })
  it('replays exact operations, rejects operation reuse and isolates tenants and installations', async () => {
    await enqueue(a); await enqueue(b)
    await enqueue(a, { ...binding, installationRef: 'another-installation' })
    const input = operation()
    const first = await store.eraseSubject({ workspaceId: a.id, request: input })
    expect(await store.eraseSubject({ workspaceId: a.id, request: input })).toEqual(first)
    expect(await store.eraseSubject({ workspaceId: a.id, request: { ...input, subjectRef: 'different' } })).toEqual({ kind: 'conflict' })
    expect(await store.eraseSubject({ workspaceId: a.id, request: { ...input, operationRef: randomUUID() } })).toEqual({ kind: 'conflict' })
    expect(await store.listJobs(b.id)).toHaveLength(1)
    expect(await store.listJobs(a.id)).toHaveLength(1)
  })
  it('serializes creation racing with erasure so no matching job survives', async () => {
    const blocker = await pool.connect()
    await blocker.query('BEGIN')
    try {
      await blocker.query('SELECT id FROM public.rl_workspaces WHERE id=$1 FOR UPDATE', [a.id])
      const create = enqueue()
      const erase = store.eraseSubject({ workspaceId: a.id, request: operation() })
      await blocker.query('COMMIT')
      const [created, erased] = await Promise.all([create, erase])
      expect(['accepted', 'subject_erased']).toContain(created.kind)
      expect(erased.kind).toBe('erased')
      expect(await store.listJobs(a.id)).toEqual([])
      expect((await enqueue()).kind).toBe('subject_erased')
    } finally { await blocker.query('ROLLBACK'); blocker.release() }
  })
  it('allows completion holding the job to finish while erasure holds workspace, without a lock cycle', async () => {
    const job = await running()
    await store.pinSnapshot(lease(job), snapshot)
    const report = bundle(job), completing = await pool.connect(), erasing = await pool.connect()
    try {
      await completing.query('BEGIN'); await completing.query("SET LOCAL statement_timeout='2s'")
      await completing.query('SELECT id FROM public.rl_analysis_jobs WHERE id=$1 FOR UPDATE', [job.id])
      const { rows: [{ pid }] } = await erasing.query('SELECT pg_backend_pid() AS pid')
      const deletion = createServiceStore(executor(erasing)).eraseSubject({ workspaceId: a.id, request: operation() })
      let waiting = false
      for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
        waiting = (await pool.query("SELECT wait_event_type='Lock' AS waiting FROM pg_stat_activity WHERE pid=$1", [pid])).rows[0]?.waiting === true
        if (!waiting) await new Promise(resolve => setTimeout(resolve, 5))
      }
      expect(waiting).toBe(true)
      expect(await createServiceStore(executor(completing)).completeAnalysis(lease(job), { bundle: report, reportDigest: digestJson(report) })).toBe(true)
      await completing.query('COMMIT')
      expect((await deletion).kind).toBe('erased')
      expect(await store.getJob(a.id, job.id)).toBeNull()
      expect(await store.getResult(a.id, job.id)).toBeNull()
      expect(await store.completeAnalysis(lease(job), { bundle: report, reportDigest: digestJson(report) })).toBe(false)
    } finally { await completing.query('ROLLBACK'); completing.release(); erasing.release() }
  })
  it('enforces erase scope and installation inside SQL and retains private tombstones until owner deletion', async () => {
    const keyId = randomUUID()
    await store.issueApiKey(a.id, { id: keyId, label: 'Old permissions', secretHash: 'a'.repeat(64), scopes: ['analyses:create', 'analyses:read'], installationRef: binding.installationRef })
    expect(await store.eraseSubject({ workspaceId: a.id, createdByKeyId: keyId, request: operation() })).toEqual({ kind: 'unauthorized' })
    const erasedId = randomUUID()
    await store.issueApiKey(a.id, { id: erasedId, label: 'Explicit erasure', secretHash: 'b'.repeat(64), scopes: ['analyses:create', 'analyses:read', 'analyses:erase'], installationRef: binding.installationRef })
    expect(await store.eraseSubject({ workspaceId: b.id, createdByKeyId: erasedId, request: operation() })).toEqual({ kind: 'unauthorized' })
    expect(await store.eraseSubject({ workspaceId: a.id, createdByKeyId: erasedId, request: { ...operation(), installationRef: 'other' } })).toEqual({ kind: 'unauthorized' })
    expect((await store.eraseSubject({ workspaceId: a.id, createdByKeyId: erasedId, request: operation() })).kind).toBe('erased')
    const privacy = await pool.query("SELECT relrowsecurity FROM pg_class WHERE oid='public.rl_subject_erasures'::regclass")
    expect(privacy.rows[0].relrowsecurity).toBe(true)
    const grants = await pool.query("SELECT routine_name FROM information_schema.routine_privileges WHERE specific_schema='public' AND routine_name='rl_erase_subject' AND grantee='PUBLIC'")
    expect(grants.rows).toEqual([])
    await pool.query('DELETE FROM public.users WHERE id=$1', [owners[0]])
    expect((await pool.query('SELECT count(*)::int AS n FROM public.rl_subject_erasures WHERE workspace_id=$1', [a.id])).rows[0].n).toBe(0)
  })
})
