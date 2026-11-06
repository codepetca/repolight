// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Pool } from 'pg'
import { createServiceStore } from '@/lib/service/store'
import { digestJson } from '@/lib/service/http'
import { buildPublicRepositoryBundle } from '@/lib/report/bundle-build'
import { makeRepositoryTarget } from '@/lib/engine/repo'
import { createServiceApi } from '@/lib/service/api'
import { skyHopInput } from '../../fixtures/reports/sky-hop'
import { authenticateService, hashApiSecret } from '@/lib/service/auth'
import type { SqlExecutor } from '@/lib/service/sql-executor'

const target = process.env.REPOLIGHT_MANAGED_TEST_DATABASE_URL
if (target) {
  const url = new URL(target)
  if (url.hostname !== '127.0.0.1' || url.port !== '55489' || url.pathname !== '/repolight_managed_test' || url.username || url.password) throw new Error('Only the explicitly disposable managed fixture target is allowed')
}
describe.skipIf(!target)('managed provisioning against a fresh disposable PostgreSQL', () => {
  const pool = new Pool({ connectionString: target, max: 10 })
  const executor: SqlExecutor = { async query<Row extends Record<string, unknown>>(sql: string, args: unknown[] = []) { return (await pool.query(sql, args)).rows as Row[] } }
  const store = createServiceStore(executor)
  const oldOwner = randomUUID(), oldKey = randomUUID(), oldSecret = randomBytes(32).toString('base64url')
  beforeAll(async () => {
    const { rows } = await pool.query("SELECT to_regclass('public.users') AS users")
    if (rows[0].users) throw new Error('Managed fixture database must be empty')
    for (const file of ['0000_curly_hellion.sql', '0001_external-run-identifiers.sql', '0002_living_forge.sql', '0003_service_reports.sql', '0004_subject_erasures.sql', '0005_optional_interpretation.sql']) await pool.query(await readFile(new URL(`../../drizzle/${file}`, import.meta.url), 'utf8'))
    await pool.query('INSERT INTO public.users(id,email,password_hash) VALUES($1,$2,$3)', [oldOwner, `${oldOwner}@example.test`, 'fixture'])
    const oldWorkspace = await store.getOrCreateWorkspace(oldOwner)
    await store.issueApiKey(oldWorkspace.id, { id: oldKey, label: 'existing', secretHash: hashApiSecret(oldSecret), scopes: ['analyses:read'] })
    await pool.query(await readFile(new URL('../../drizzle/0006_managed_provisioning.sql', import.meta.url), 'utf8'))
  }, 30000)
  afterAll(async () => { await pool.end() })
  it('preserves populated owner workspaces and denies a non-owner access to new objects', async () => {
    const principal = await authenticateService(new Request('https://example.test', { headers: { authorization: `Bearer rl_v2_${oldKey}.${oldSecret}` } }), store, async () => null)
    expect(principal.workspace.ownerUserId).toBe(oldOwner)
    await pool.query('CREATE ROLE repolight_managed_fixture_unprivileged NOLOGIN')
    const client = await pool.connect()
    try {
      await client.query('SET ROLE repolight_managed_fixture_unprivileged')
      for (const table of ['rl_managed_provisions', 'rl_managed_rotations']) {
        expect((await client.query('SELECT has_table_privilege(current_user, $1, $2) AS allowed', [`public.${table}`, 'SELECT'])).rows[0].allowed).toBe(false)
        await expect(client.query(`SELECT * FROM public.${table}`)).rejects.toMatchObject({ code: '42501' })
      }
      for (const fn of ['public.rl_provision_managed(text,text,uuid,uuid,text)', 'public.rl_rotate_managed(text,text,uuid,uuid,uuid,text)']) {
        expect((await client.query('SELECT has_function_privilege(current_user, $1, $2) AS allowed', [fn, 'EXECUTE'])).rows[0].allowed).toBe(false)
      }
      await expect(client.query("SELECT public.rl_provision_managed('x','y',gen_random_uuid(),gen_random_uuid(),repeat('a',64))")).rejects.toMatchObject({ code: '42501' })
      await expect(client.query("SELECT public.rl_rotate_managed('x','y',gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),repeat('a',64))")).rejects.toMatchObject({ code: '42501' })
    } finally { await client.query('RESET ROLE'); client.release(); await pool.query('DROP ROLE repolight_managed_fixture_unprivileged') }
  })
  it('serializes retries and rejects changed requests and cross-tenant key reuse', async () => {
    const secret = randomBytes(32).toString('base64url')
    const input = { installationRef: 'pika-test', tenantRef: randomUUID(), operationRef: randomUUID(), keyId: randomUUID(), secretHash: hashApiSecret(secret) }
    const results = await Promise.all(Array.from({ length: 8 }, () => store.provisionManaged(input)))
    expect(results.filter(r => r.kind === 'created')).toHaveLength(1)
    expect(results.filter(r => r.kind === 'replayed')).toHaveLength(7)
    expect(new Set(results.map(r => r.kind === 'conflict' ? '' : r.workspaceRef)).size).toBe(1)
    expect(await store.provisionManaged({ ...input, secretHash: 'a'.repeat(64) })).toEqual({ kind: 'conflict' })
    expect(await store.provisionManaged({ ...input, tenantRef: randomUUID() })).toEqual({ kind: 'conflict' })
    expect(await store.provisionManaged({ ...input, tenantRef: randomUUID(), operationRef: randomUUID() })).toEqual({ kind: 'conflict' })
    const otherSecret = randomBytes(32).toString('base64url')
    const otherInput = { ...input, tenantRef: randomUUID(), operationRef: randomUUID(), keyId: randomUUID(), secretHash: hashApiSecret(otherSecret) }
    const other = await store.provisionManaged(otherInput)
    expect(other.kind).toBe('created')
    if (other.kind !== 'created' || results[0].kind === 'conflict') throw new Error('unexpected conflict')
    expect(other.workspaceRef).not.toBe(results[0].workspaceRef)
    const key = await store.findApiKey(input.keyId)
    expect(key?.ownerUserId).toBeNull()
    expect(key?.installationRef).toBe(input.installationRef)
    expect(key?.scopes).toEqual(['analyses:create', 'analyses:read', 'analyses:erase'])
    const request = new Request('https://example.test', { headers: { authorization: `Bearer rl_v2_${input.keyId}.${secret}` } })
    expect((await authenticateService(request, store, async () => null)).workspace.id).toBe(key?.workspaceId)
    const api = createServiceApi(store, async () => null)
    const fixture = skyHopInput()
    const analysis = { schemaVersion: '1.0', request: { repositoryUrl: fixture.repositoryUrl, branch: fixture.branch, period: fixture.period, scheduledProjectDates: fixture.scheduledProjectDates, exclusions: fixture.exclusions, baselineReviewed: true }, clientBinding: { installationRef: input.installationRef, subjectRef: 'student-opaque', sourceRevisionRef: 'revision-opaque' } }
    const headers = { authorization: `Bearer rl_v2_${input.keyId}.${secret}`, 'content-type': 'application/json', 'idempotency-key': randomUUID() }
    const create = await api.create(new Request('https://example.test', { method: 'POST', headers, body: JSON.stringify(analysis) }))
    expect(create.status).toBe(202)
    const created = await create.json()
    const otherHeaders = { authorization: `Bearer rl_v2_${otherInput.keyId}.${otherSecret}` }
    expect((await api.status(new Request('https://example.test', { headers: otherHeaders }), created.analysisId)).status).toBe(404)
    const mismatch = { ...analysis, clientBinding: { ...analysis.clientBinding, installationRef: 'other-installation' } }
    expect((await api.create(new Request('https://example.test', { method: 'POST', headers, body: JSON.stringify(mismatch) }))).status).toBe(403)
    // Complete the original job before rotating, proving its report remains readable.
    await pool.query("UPDATE public.rl_analysis_jobs SET status='running',attempt_count=1,lease_generation=1,lease_token=$2,lease_expires_at=clock_timestamp()+interval '90 seconds',worker_id='managed-fixture' WHERE id=$1", [created.analysisId, randomUUID()])
    const job = (await store.getJob(key!.workspaceId, created.analysisId))!
    const lease = { jobId: job.id, leaseToken: job.leaseToken!, leaseGeneration: job.leaseGeneration }
    const snapshot = { ...fixture.snapshot, repositoryUrl: fixture.repositoryUrl, branch: fixture.branch }
    expect(await store.pinSnapshot(lease, snapshot)).toBe(true)
    const bundle = buildPublicRepositoryBundle({ bundleRef: job.id, settings: analysis.request, evidence: { target: makeRepositoryTarget(fixture.repositoryUrl, fixture.branch)!, snapshot: fixture.snapshot, events: fixture.events, coverage: fixture.coverage } })
    expect(await store.completeAnalysis(lease, { bundle, reportDigest: digestJson(bundle) })).toBe(true)
    const earlierErasure = { schemaVersion: '1.0', operationRef: randomUUID(), installationRef: input.installationRef, subjectRef: 'previous-student' }
    expect((await api.erase(new Request('https://example.test', { method: 'POST', headers, body: JSON.stringify(earlierErasure) }))).status).toBe(200)
    const replacementSecret = randomBytes(32).toString('base64url')
    const rotate = { installationRef: input.installationRef, tenantRef: input.tenantRef, operationRef: randomUUID(), expectedKeyId: input.keyId, keyId: randomUUID(), secretHash: hashApiSecret(replacementSecret) }
    const rotated = await Promise.all(Array.from({ length: 6 }, () => store.rotateManaged(rotate)))
    expect(rotated.filter(r => r.kind === 'created')).toHaveLength(1)
    expect(rotated.filter(r => r.kind === 'replayed')).toHaveLength(5)
    expect(rotated[0]).toEqual({ kind: rotated[0].kind, workspaceRef: results[0].workspaceRef })
    expect(await store.rotateManaged({ ...rotate, secretHash: 'b'.repeat(64) })).toEqual({ kind: 'conflict' })
    expect(await store.rotateManaged({ ...rotate, operationRef: randomUUID(), keyId: randomUUID() })).toEqual({ kind: 'conflict' })
    expect(await store.rotateManaged({ ...rotate, tenantRef: otherInput.tenantRef, operationRef: randomUUID(), keyId: randomUUID() })).toEqual({ kind: 'conflict' })
    expect(await store.provisionManaged({ ...otherInput, tenantRef: randomUUID(), operationRef: rotate.operationRef, keyId: randomUUID() })).toEqual({ kind: 'conflict' })
    expect(await store.findApiKey(input.keyId)).toBeNull()
    await expect(authenticateService(request, store, async () => null)).rejects.toMatchObject({ status: 401 })
    const newHeaders = { authorization: `Bearer rl_v2_${rotate.keyId}.${replacementSecret}` }
    expect((await api.result(new Request('https://example.test', { headers: newHeaders }), created.analysisId)).status).toBe(200)
    expect((await api.erase(new Request('https://example.test', { method: 'POST', headers: { ...newHeaders, 'content-type': 'application/json' }, body: JSON.stringify(earlierErasure) }))).status).toBe(200)
    expect((await api.result(new Request('https://example.test', { headers: otherHeaders }), created.analysisId)).status).toBe(404)
    const erasure = { schemaVersion: '1.0', operationRef: randomUUID(), installationRef: input.installationRef, subjectRef: 'student-opaque' }
    const erase = () => api.erase(new Request('https://example.test', { method: 'POST', headers: { ...newHeaders, 'content-type': 'application/json' }, body: JSON.stringify(erasure) }))
    expect((await erase()).status).toBe(200)
    expect((await erase()).status).toBe(200)
    expect((await api.result(new Request('https://example.test', { headers: newHeaders }), created.analysisId)).status).toBe(404)
    await store.revokeApiKey(key!.workspaceId, rotate.keyId)
    expect((await store.rotateManaged(rotate)).kind).toBe('replayed')
    expect(await store.findApiKey(rotate.keyId)).toBeNull()
    const recovered = { ...rotate, operationRef: randomUUID(), expectedKeyId: rotate.keyId, keyId: randomUUID(), secretHash: hashApiSecret(randomBytes(32).toString('base64url')) }
    const competing = { ...recovered, operationRef: randomUUID(), keyId: randomUUID() }
    const races = await Promise.all([store.rotateManaged(recovered), store.rotateManaged(competing)])
    expect(races.filter(r => r.kind === 'created')).toHaveLength(1)
    expect(races.filter(r => r.kind === 'conflict')).toHaveLength(1)
    expect((await store.rotateManaged(rotate)).kind).toBe('replayed')
    expect(await store.findApiKey(rotate.keyId)).toBeNull()
    expect((await store.provisionManaged(input)).kind).toBe('replayed')

  })
})
