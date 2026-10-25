import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createServiceApi } from '@/lib/service/api'
import { newApiCredential } from '@/lib/service/auth'
import { skyHopInput } from '../../fixtures/reports/sky-hop'
import type { ApiKeyRecord, ServiceStore } from '@/lib/service/store-types'
const workspaceId = randomUUID(), ownerUserId = randomUUID()
const workspace = { id: workspaceId, ownerUserId, customerRef: 'fixture-customer', createdAt: '2026-01-01T00:00:00Z' }
const body = () => ({ schemaVersion: '1.0', operationRef: randomUUID(), installationRef: 'pika-fixture', subjectRef: 'opaque-subject' })
const request = (value: unknown, headers: Record<string, string> = {}) => new Request('https://reports.example/api/v2/erasures', { method: 'POST', headers: { origin: 'https://reports.example', 'content-type': 'application/json', ...headers }, body: JSON.stringify(value) })
let store: ServiceStore
beforeEach(() => { store = { getWorkspaceForOwner: vi.fn().mockResolvedValue(workspace), findApiKey: vi.fn(), eraseSubject: vi.fn().mockImplementation(async ({ request }) => ({ kind: 'erased', receipt: { ...request, status: 'erased', absenceVerified: true } })) } as unknown as ServiceStore })
afterEach(() => vi.unstubAllEnvs())
function key(scopes: ApiKeyRecord['scopes'] = ['analyses:erase'], installationRef: string | null = 'pika-fixture') {
  const credential = newApiCredential()
  const record: ApiKeyRecord = { ...workspace, id: credential.id, workspaceId, label: 'fixture', scopes, installationRef, expiresAt: null, revokedAt: null, secretHash: credential.secretHash }
  vi.mocked(store.findApiKey).mockResolvedValue(record)
  return { record, headers: { authorization: `Bearer ${credential.token}` } }
}
describe('subject erasure API boundary', () => {
  it('returns an exact receipt scoped to the authenticated tenant and operation', async () => {
    const input = body(), credential = key()
    const result = await createServiceApi(store, async () => null).erase(request(input, credential.headers))
    expect(result.status).toBe(200)
    expect(result.headers.get('cache-control')).toBe('no-store')
    expect(await result.json()).toEqual({ ...input, status: 'erased', absenceVerified: true })
    expect(store.eraseSubject).toHaveBeenCalledWith({ workspaceId, createdByKeyId: credential.record.id, request: input })
  })
  it('requires explicit erase permission and exact installation binding', async () => {
    const api = createServiceApi(store, async () => null)
    expect((await api.erase(request(body(), key(['analyses:create', 'analyses:read']).headers))).status).toBe(403)
    expect((await api.erase(request(body(), key(['analyses:erase'], 'other').headers))).status).toBe(403)
    expect((await api.erase(request(body(), key(['analyses:erase'], null).headers))).status).toBe(403)
    const revoked = key(); revoked.record.revokedAt = new Date().toISOString()
    expect((await api.erase(request(body(), revoked.headers))).status).toBe(401)
    expect(store.eraseSubject).not.toHaveBeenCalled()
  })
  it('allows only current session owners with exact same-origin JSON and no tenant selector', async () => {
    const api = createServiceApi(store, async () => ({ id: ownerUserId }))
    expect((await api.erase(request(body()))).status).toBe(200)
    expect((await api.erase(request(body(), { origin: 'https://other.example' }))).status).toBe(403)
    expect((await api.erase(request(body(), { 'content-type': 'text/plain' }))).status).toBe(415)
    expect((await api.erase(request({ ...body(), workspaceId: randomUUID() }))).status).toBe(400)
    vi.mocked(store.getWorkspaceForOwner).mockResolvedValueOnce(null)
    expect((await api.erase(request(body()))).status).toBe(401)
  })
  it('rejects absent or ambiguous credentials and returns permanent future-create410', async () => {
    const api = createServiceApi(store, async () => null)
    expect((await api.erase(request(body()))).status).toBe(401)
    const credential = key()
    expect((await api.erase(request(body(), { ...credential.headers, cookie: 'repocat_session=synthetic' }))).status).toBe(401)
    const fixture = skyHopInput()
    const createStore = { ...store, enqueueAnalysis: vi.fn().mockResolvedValue({ kind: 'subject_erased' }) } as ServiceStore
    const sessionApi = createServiceApi(createStore, async () => ({ id: ownerUserId }))
    createStore.getOrCreateWorkspace = vi.fn().mockResolvedValue(workspace)
    const result = await sessionApi.create(request({ schemaVersion: '1.0', request: { repositoryUrl: fixture.repositoryUrl, period: fixture.period, scheduledProjectDates: null, exclusions: fixture.exclusions } }, { 'idempotency-key': 'future-create' }))
    expect(result.status).toBe(410)
    expect(await result.json()).toEqual({ error: { code: 'subject_erased' } })
  })
  it('returns only current authenticated connection capabilities without private identifiers', async () => {
    const api = createServiceApi(store, async () => null)
    expect((await api.connection(request({}))).status).toBe(401)
    const credential = key(['analyses:create'])
    const response = await api.connection(request({}, credential.headers))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ schemaVersion: '1.0', workspaceRef: workspace.customerRef, installationRef: 'pika-fixture', scopes: ['analyses:create'] })
    credential.record.revokedAt = new Date().toISOString()
    expect((await api.connection(request({}, credential.headers))).status).toBe(401)
    const owner = await createServiceApi(store, async () => ({ id: ownerUserId })).connection(request({}))
    expect(await owner.json()).toEqual({ schemaVersion: '1.0', workspaceRef: workspace.customerRef, installationRef: null, scopes: ['analyses:create', 'analyses:read', 'analyses:erase'] })
    const next = key(['analyses:read'])
    const rotated = { ...workspace, id: randomUUID(), ownerUserId: randomUUID(), customerRef: 'different-opaque-workspace' }
    Object.assign(next.record, { workspaceId: rotated.id, ownerUserId: rotated.ownerUserId, customerRef: rotated.customerRef })
    vi.mocked(store.getWorkspaceForOwner).mockResolvedValueOnce(rotated)
    expect(await (await api.connection(request({}, next.headers))).json()).toEqual({ schemaVersion: '1.0', workspaceRef: rotated.customerRef, installationRef: 'pika-fixture', scopes: ['analyses:read'] })
    expect(store.getWorkspaceForOwner).toHaveBeenLastCalledWith(rotated.ownerUserId, rotated.id)
  })
  it('requires an explicit installation for newly issued erasure keys, preserving ordinary key scopes', async () => {
    const api = createServiceApi(store, async () => ({ id: ownerUserId }))
    store.getOrCreateWorkspace = vi.fn().mockResolvedValue(workspace)
    store.issueApiKey = vi.fn().mockImplementation(async (workspaceId, value) => ({ ...value, workspaceId, installationRef: value.installationRef ?? null, expiresAt: null, revokedAt: null, createdAt: workspace.createdAt }))
    expect((await api.issueKey(request({ label: 'Erase', scopes: ['analyses:erase'] }))).status).toBe(400)
    expect((await api.issueKey(request({ label: 'Erase', scopes: ['analyses:create', 'analyses:read', 'analyses:erase'], installationRef: null }))).status).toBe(400)
    expect(store.issueApiKey).not.toHaveBeenCalled()
    expect((await api.issueKey(request({ label: 'Bound erase', scopes: ['analyses:erase'], installationRef: 'pika-fixture' }))).status).toBe(201)
    expect((await api.issueKey(request({ label: 'Ordinary', scopes: ['analyses:create', 'analyses:read'] }))).status).toBe(201)
    expect(vi.mocked(store.issueApiKey).mock.calls[1][1].scopes).toEqual(['analyses:create', 'analyses:read'])
  })
  it('maps operation conflicts and sanitized failures without revealing stored data', async () => {
    const api = createServiceApi(store, async () => ({ id: ownerUserId }))
    vi.mocked(store.eraseSubject).mockResolvedValueOnce({ kind: 'conflict' }).mockResolvedValueOnce({ kind: 'unauthorized' }).mockRejectedValueOnce(new Error('private upstream payload'))
    expect((await api.erase(request(body()))).status).toBe(409)
    expect((await api.erase(request(body()))).status).toBe(401)
    const failed = await api.erase(request(body()))
    expect(failed.status).toBe(500)
    expect(await failed.json()).toEqual({ error: { code: 'internal_failure' } })
  })
})
