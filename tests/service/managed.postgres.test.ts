// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Pool } from 'pg'
import { createServiceStore } from '@/lib/service/store'
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
  beforeAll(async () => {
    const { rows } = await pool.query("SELECT to_regclass('public.users') AS users")
    if (rows[0].users) throw new Error('Managed fixture database must be empty')
    for (const file of ['0000_curly_hellion.sql', '0001_external-run-identifiers.sql', '0002_living_forge.sql', '0003_service_reports.sql', '0004_subject_erasures.sql', '0005_optional_interpretation.sql', '0006_managed_provisioning.sql']) await pool.query(await readFile(new URL(`../../drizzle/${file}`, import.meta.url), 'utf8'))
  }, 30000)
  afterAll(async () => { await pool.end() })
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
    await store.revokeApiKey(key!.workspaceId, input.keyId)
    expect((await store.provisionManaged(input)).kind).toBe('replayed')
    expect(await store.findApiKey(input.keyId)).toBeNull()
    await expect(authenticateService(request, store, async () => null)).rejects.toMatchObject({ status: 401 })
  })
})
