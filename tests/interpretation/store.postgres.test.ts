// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Pool, type PoolClient } from 'pg'
import { createInterpretationApi } from '@/lib/interpretation/api'
import { createServiceStore } from '@/lib/service/store'
import { createInterpretationStore, type InterpretationStore, type Reservation } from '@/lib/interpretation/store'
import { interpretationEvidence } from '@/lib/interpretation/evidence'
import { digestJson } from '@/lib/service/http'
import { buildPublicRepositoryBundle } from '@/lib/report/bundle-build'
import { makeRepositoryTarget } from '@/lib/engine/repo'
import { skyHopInput } from '../../fixtures/reports/sky-hop'
import type { SqlExecutor } from '@/lib/service/sql-executor'
import type { ServiceStore, WorkspaceRecord } from '@/lib/service/store-types'
import { acquireServiceFixtureLock } from '../service/postgres-fixture-lock'
const target = process.env.REPOLIGHT_TEST_DATABASE_URL
if (target) { const url = new URL(target); if (url.hostname !== '127.0.0.1' || url.port !== '55487' || url.pathname !== '/repolight_service') throw new Error('Only the explicitly authorized disposable service fixture is supported.') }
const fixture = skyHopInput()
const settings = { repositoryUrl: fixture.repositoryUrl, branch: fixture.branch, period: fixture.period, scheduledProjectDates: fixture.scheduledProjectDates, exclusions: fixture.exclusions, baselineReviewed: true }
function executor(connection: Pool | PoolClient): SqlExecutor { return { async query<Row extends Record<string, unknown>>(text: string, args: unknown[] = []) { return (await connection.query(text, args)).rows as Row[] } } }
describe.skipIf(!target)('optional interpretation atomic ledger', () => {
  let pool: Pool, services: ServiceStore, store: InterpretationStore, release: (() => Promise<void>) | undefined, owners: string[], workspaces: WorkspaceRecord[]
  beforeAll(async () => {
    pool = new Pool({ connectionString: target!, max: 10 }); release = await acquireServiceFixtureLock(pool)
    const check = await pool.query("SELECT to_regclass('public.rl_interpretations') AS ready")
    if (!check.rows[0].ready) throw new Error('Coordinator must apply migration0005 to its authorized fixture before running these tests.')
    services = createServiceStore(executor(pool)); store = createInterpretationStore(executor(pool))
  }, 30000)
  beforeEach(async () => {
    owners = [randomUUID(), randomUUID(), randomUUID(), randomUUID()]
    for (const id of owners) await pool.query('INSERT INTO public.users(id,email,password_hash) VALUES($1,$2,$3)', [id, `ai-fixture-${id}@example.test`, 'synthetic'])
    workspaces = await Promise.all(owners.map(id => services.getOrCreateWorkspace(id)))
  })
  afterEach(async () => {
    if (!owners) return
    const ids = (await pool.query('SELECT id FROM public.rl_interpretation_admissions WHERE workspace_id=ANY($1::uuid[])', [workspaces.map(value => value.id)])).rows.map(row => row.id)
    await pool.query('DELETE FROM public.users WHERE id=ANY($1::uuid[])', [owners])
    // Remove only this test's synthetic quota receipts, preserving every unrelated fixture owner.
    await pool.query('DELETE FROM public.rl_interpretation_admissions WHERE id=ANY($1::uuid[])', [ids])
  })
  afterAll(async () => { try { await release?.() } finally { await pool?.end() } })
  async function reservation(index = 0, subjectRef = 'subject'): Promise<Reservation> {
    const workspace = workspaces[index]
    const queued = await services.enqueueAnalysis({ workspaceId: workspace.id, idempotencyKey: randomUUID(), request: settings, requestFingerprint: digestJson(settings), clientBinding: { installationRef: 'ai-fixture', subjectRef, sourceRevisionRef: 'revision' } })
    if (queued.kind !== 'accepted') throw new Error('fixture admission')
    const token = randomUUID()
    await pool.query("UPDATE public.rl_analysis_jobs SET status='running',attempt_count=1,lease_generation=1,lease_token=$2,lease_expires_at=clock_timestamp()+interval '90 seconds',worker_id='ai-fixture' WHERE id=$1", [queued.job.id, token])
    const lease = { jobId: queued.job.id, leaseToken: token, leaseGeneration: 1 }
    await services.pinSnapshot(lease, { ...fixture.snapshot, repositoryUrl: fixture.repositoryUrl, branch: fixture.branch })
    const bundle = buildPublicRepositoryBundle({ bundleRef: queued.job.id, settings, evidence: { target: makeRepositoryTarget(fixture.repositoryUrl, fixture.branch)!, snapshot: fixture.snapshot, events: fixture.events, coverage: fixture.coverage } })
    const reportDigest = digestJson(bundle)
    expect(await services.completeAnalysis(lease, { bundle, reportDigest })).toBe(true)
    const result = (await services.getResult(workspace.id, queued.job.id))!
    return { workspaceId: workspace.id, jobId: queued.job.id, requestId: randomUUID(), scopeKey: 'repository', model: 'synthetic-operator-model', reportDigest, evidence: interpretationEvidence(result, 'repository') }
  }
  it('atomically replays same UUID, rejects conflicts, and admits only one generating row per workspace', async () => {
    const input = await reservation()
    const raced = await Promise.all(Array.from({ length: 8 }, () => store.reserve(input)))
    expect(raced.filter(value => value.kind === 'admitted')).toHaveLength(1)
    expect(raced.filter(value => value.kind === 'replayed')).toHaveLength(7)
    expect((await store.reserve({ ...input, requestId: randomUUID() })).kind).toBe('limited')
    expect((await store.reserve({ ...input, scopeKey: 'contributor:another' })).kind).toBe('conflict')
    expect((await pool.query('SELECT count(*)::int AS n FROM public.rl_interpretation_admissions WHERE workspace_id=$1', [input.workspaceId])).rows[0].n).toBe(1)
  })
  it('counts failed reservations toward ten per rolling24hours and enforces global2generating', async () => {
    const input = await reservation()
    for (let index = 0; index < 10; index++) {
      const admitted = await store.reserve({ ...input, requestId: randomUUID() })
      if (!('row' in admitted)) throw new Error('expected admission')
      expect(await store.finish(admitted.row, null, 'provider_unavailable')).toBe(true)
    }
    expect((await store.reserve({ ...input, requestId: randomUUID() })).kind).toBe('limited')
    const b = await reservation(1), c = await reservation(2), d = await reservation(3)
    expect((await store.reserve(b)).kind).toBe('admitted')
    expect((await store.reserve(c)).kind).toBe('admitted')
    const next = await store.reserve(d)
    expect(next.kind).toBe('limited')
  })
  it('fences expired completions and recovers only this workspace on POST admission', async () => {
    const input = await reservation(), other = await reservation(1)
    const first = await store.reserve(input), second = await store.reserve(other)
    if (!('row' in first) || !('row' in second)) throw new Error('fixture')
    await pool.query("UPDATE public.rl_interpretations SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=ANY($1::uuid[])", [[first.row.id, second.row.id]])
    expect(await store.finish(first.row, null, 'provider_timeout')).toBe(false)
    await store.recover(input.workspaceId)
    expect((await store.find(input.workspaceId, input.requestId))?.error).toBe('expired')
    expect((await store.find(other.workspaceId, other.requestId))?.state).toBe('generating')
    expect((await store.reserve(input)).kind).toBe('replayed')
  })
  it('retains anonymized cost receipts while subject erasure cascades every sidecar and prevents resurrection', async () => {
    const input = await reservation(), admitted = await store.reserve(input)
    if (!('row' in admitted)) throw new Error('fixture')
    await services.eraseSubject({ workspaceId: input.workspaceId, request: { schemaVersion: '1.0', operationRef: randomUUID(), installationRef: 'ai-fixture', subjectRef: 'subject' } })
    expect(await store.find(input.workspaceId, input.requestId)).toBeNull()
    expect(await store.finish(admitted.row, null, 'provider_timeout')).toBe(false)
    expect((await pool.query('SELECT count(*)::int AS n FROM public.rl_interpretation_admissions WHERE workspace_id=$1', [input.workspaceId])).rows[0].n).toBe(1)
  })
  it('rejects cross-workspace reservation and serializes completion with subject erasure', async () => {
    const input = await reservation()
    expect((await store.reserve({ ...input, workspaceId: workspaces[1].id })).kind).toBe('not_found')
    const admitted = await store.reserve(input)
    if (!('row' in admitted)) throw new Error('fixture')
    const completing = await pool.connect(), erasing = await pool.connect()
    try {
      await completing.query('BEGIN'); await completing.query("SET LOCAL statement_timeout='2s'")
      await completing.query('SELECT id FROM public.rl_workspaces WHERE id=$1 FOR UPDATE', [input.workspaceId])
      const { rows: [{ pid }] } = await erasing.query('SELECT pg_backend_pid() AS pid')
      const removal = createServiceStore(executor(erasing)).eraseSubject({ workspaceId: input.workspaceId, request: { schemaVersion: '1.0', operationRef: randomUUID(), installationRef: 'ai-fixture', subjectRef: 'subject' } })
      let waiting = false
      for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
        waiting = (await pool.query("SELECT wait_event_type='Lock' AS waiting FROM pg_stat_activity WHERE pid=$1", [pid])).rows[0]?.waiting === true
        if (!waiting) await new Promise(resolve => setTimeout(resolve, 5))
      }
      expect(waiting).toBe(true)
      expect(await createInterpretationStore(executor(completing)).finish(admitted.row, null, 'provider_timeout')).toBe(true)
      await completing.query('COMMIT')
      expect((await removal).kind).toBe('erased')
      expect(await store.find(input.workspaceId, input.requestId)).toBeNull()
      expect(await store.finish(admitted.row, null, 'provider_timeout')).toBe(false)
    } finally { await completing.query('ROLLBACK'); completing.release(); erasing.release() }
  })
  it('keeps a held provider request counted after subject erasure until its independent lease expires', async () => {
    const original = await reservation()
    let release!: (response: Response) => void
    const output = () => Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ observations: [] }) }] }] })
    const fetchImpl = vi.fn<typeof fetch>().mockImplementationOnce(() => new Promise(resolve => { release = resolve })).mockImplementation(async () => output())
    const api = createInterpretationApi(services, store, async () => ({ id: owners[0] }), { fetchImpl, config: () => ({ enabled: true, model: 'synthetic-operator-model', apiKey: 'synthetic-key' }) })
    const post = (input: Reservation) => new Request(`https://reports.example/api/v2/analyses/${input.jobId}/interpretation`, { method: 'POST', headers: { origin: 'https://reports.example', 'content-type': 'application/json' }, body: JSON.stringify({ schemaVersion: '1.0', requestId: input.requestId, scopeKey: 'repository' }) })
    const held = api.post(post(original), original.jobId)
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce())
    await services.eraseSubject({ workspaceId: original.workspaceId, request: { schemaVersion: '1.0', operationRef: randomUUID(), installationRef: 'ai-fixture', subjectRef: 'subject' } })
    const replacement = await reservation(0, 'replacement-subject')
    expect((await api.post(post(replacement), replacement.jobId)).status).toBe(429)
    expect(fetchImpl).toHaveBeenCalledOnce()
    release(output())
    expect((await held).status).toBe(404)
    expect((await api.post(post(replacement), replacement.jobId)).status).toBe(429)
    await pool.query("UPDATE public.rl_interpretation_admissions SET active_until=clock_timestamp()-interval '1 second' WHERE workspace_id=$1", [original.workspaceId])
    expect((await api.post(post(replacement), replacement.jobId)).status).toBe(200)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect((await pool.query('SELECT count(*)::int AS n FROM public.rl_interpretation_admissions WHERE workspace_id=$1 AND active_until>clock_timestamp()', [original.workspaceId])).rows[0].n).toBe(0)
  })
  it('preserves the global two-request limit when both generating sidecars are erased', async () => {
    const a = await reservation(), b = await reservation(1)
    expect((await store.reserve(a)).kind).toBe('admitted')
    expect((await store.reserve(b)).kind).toBe('admitted')
    for (const input of [a,b]) await services.eraseSubject({ workspaceId: input.workspaceId, request: { schemaVersion: '1.0', operationRef: randomUUID(), installationRef: 'ai-fixture', subjectRef: 'subject' } })
    const c = await reservation(2)
    expect((await store.reserve(c)).kind).toBe('limited')
    await pool.query("UPDATE public.rl_interpretation_admissions SET active_until=clock_timestamp()-interval '1 second' WHERE workspace_id=ANY($1::uuid[])", [[a.workspaceId,b.workspaceId]])
    expect((await store.reserve(c)).kind).toBe('admitted')
  })
  it('enforces global100admissions independently of sidecar deletion and tenant creation', async () => {
    const input = await reservation()
    await pool.query('INSERT INTO public.rl_interpretation_admissions(workspace_id) SELECT $1 FROM generate_series(1,100)', [workspaces[1].id])
    expect((await store.reserve(input)).kind).toBe('limited')
    const grants = await pool.query("SELECT routine_name FROM information_schema.routine_privileges WHERE specific_schema='public' AND routine_name IN ('rl_reserve_interpretation','rl_finish_interpretation','rl_recover_interpretations') AND grantee='PUBLIC'")
    expect(grants.rows).toEqual([])
  })
})
