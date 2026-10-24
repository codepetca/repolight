import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServiceApi } from '@/lib/service/api'
import { newApiCredential, authenticateService } from '@/lib/service/auth'
import { digestJson, requireSameOrigin } from '@/lib/service/http'
import type { ServiceStore, StoredJob, ApiKeyRecord } from '@/lib/service/store-types'
import { skyHopInput } from '../../fixtures/reports/sky-hop'

const userId = '11111111-1111-4111-8111-111111111111', workspaceId = '22222222-2222-4222-8222-222222222222', jobId = '33333333-3333-4333-8333-333333333333'
const workspace = { id: workspaceId, ownerUserId: userId, customerRef: 'customer-test', createdAt: '2026-01-01T00:00:00Z' }
const fixture = skyHopInput()
const body = { schemaVersion: '1.0', request: { repositoryUrl: fixture.repositoryUrl, period: fixture.period, scheduledProjectDates: null, exclusions: fixture.exclusions, baselineReviewed: false } }
const job = { id: jobId, status: 'queued', requestFingerprint: 'a'.repeat(64), clientBinding: null, attemptCount: 0, nextAttemptAt: null, createdAt: '2026-01-01T00:00:00Z', completedAt: null, reportRef: null, errorCode: null, errorRetryable: false } as StoredJob
const req = (value: unknown = body, headers: Record<string, string> = {}) => new Request('https://reports.example/api/v2/analyses', { method: 'POST', headers: { origin: 'https://reports.example', 'content-type': 'application/json', 'idempotency-key': 'request-1', ...headers }, body: JSON.stringify(value) })
let store: ServiceStore
beforeEach(() => {
  store = { getWorkspaceForOwner: vi.fn().mockResolvedValue(workspace), getOrCreateWorkspace: vi.fn().mockResolvedValue(workspace), enqueueAnalysis: vi.fn().mockResolvedValue({ kind: 'accepted', job }), getJob: vi.fn().mockResolvedValue(job), listJobs: vi.fn().mockResolvedValue([job]), listApiKeys: vi.fn().mockResolvedValue([]), findApiKey: vi.fn(), getResult: vi.fn(), saveEdit: vi.fn(), getEdits: vi.fn().mockResolvedValue(null), issueApiKey: vi.fn(), revokeApiKey: vi.fn().mockResolvedValue(false) } as unknown as ServiceStore
})
afterEach(() => vi.unstubAllEnvs())
function bearer(installationRef: string | null = null) {
  const credential = newApiCredential()
  const key: ApiKeyRecord = { id: credential.id, workspaceId, ownerUserId: userId, customerRef: workspace.customerRef, label: 'synthetic', scopes: ['analyses:create', 'analyses:read'], installationRef, secretHash: credential.secretHash, expiresAt: null, revokedAt: null, createdAt: workspace.createdAt }
  vi.mocked(store.findApiKey).mockResolvedValue(key)
  return { credential, key, headers: { authorization: `Bearer ${credential.token}` } }
}
describe('workspace-scoped v2 API', () => {
  it('authenticates an isolated key, stores only a fingerprint and returns no internal job fields', async () => {
    const { headers } = bearer()
    const session = vi.fn().mockRejectedValue(new Error('Session must not be read'))
    const response = await createServiceApi(store, session).create(req(body, headers))
    expect(response.status).toBe(202)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(session).not.toHaveBeenCalled()
    expect(store.enqueueAnalysis).toHaveBeenCalledWith(expect.objectContaining({ workspaceId, requestFingerprint: digestJson(body) }))
    expect(await response.json()).not.toHaveProperty('leaseToken')
  })
  it('canonicalizes object order, replays accepted requests, and rejects conflicts', async () => {
    const api = createServiceApi(store, async () => ({ id: userId }))
    vi.mocked(store.enqueueAnalysis).mockResolvedValueOnce({ kind: 'replayed', job })
    expect((await api.create(req())).status).toBe(202)
    const reordered = { request: body.request, schemaVersion: '1.0' }
    expect((await api.create(req(reordered))).status).toBe(202)
    const calls = vi.mocked(store.enqueueAnalysis).mock.calls
    expect(calls[0][0].requestFingerprint).toBe(calls[1][0].requestFingerprint)
    vi.mocked(store.enqueueAnalysis).mockResolvedValueOnce({ kind: 'conflict' })
    expect((await api.create(req())).status).toBe(409)
  })
  it('does not let request bodies choose a workspace/customer or bypass installation binding', async () => {
    const { headers } = bearer('installation-a')
    const api = createServiceApi(store, async () => null)
    expect((await api.create(req(body, headers))).status).toBe(403)
    const binding = { installationRef: 'installation-b', subjectRef: 'submission', sourceRevisionRef: 'revision' }
    expect((await api.create(req({ ...body, clientBinding: binding }, headers))).status).toBe(403)
    expect((await api.create(req({ ...body, clientBinding: { ...binding, installationRef: 'installation-a' } }, headers))).status).toBe(202)
    expect((await api.create(req({ ...body, workspaceId }, headers))).status).toBe(400)
  })
  it('rejects expired/revoked/bad secrets, scopes and ambiguous session cookies', async () => {
    const { key, headers } = bearer()
    const api = createServiceApi(store, async () => ({ id: userId }))
    expect((await api.create(req(body, { ...headers, cookie: 'repocat_session=synthetic' }))).status).toBe(401)
    key.revokedAt = '2026-01-01T00:00:00Z'
    expect((await api.create(req(body, headers))).status).toBe(401)
    key.revokedAt = null; key.expiresAt = '2000-01-01T00:00:00Z'
    expect((await api.create(req(body, headers))).status).toBe(401)
    key.expiresAt = null; key.secretHash = '0'.repeat(64)
    expect((await api.create(req(body, headers))).status).toBe(401)
    const other = bearer(); other.key.scopes = ['analyses:read']
    expect((await api.create(req(body, other.headers))).status).toBe(403)
  })
  it('isolates bound installation reads within one workspace while allowing owner/unbound reads', async () => {
    job.clientBinding = { installationRef: 'installation-a', subjectRef: 'subject', sourceRevisionRef: 'revision' }
    const api = createServiceApi(store, async () => ({ id: userId }))
    const a = bearer('installation-a')
    expect((await api.status(req({}, a.headers), jobId)).status).toBe(200)
    const b = bearer('installation-b')
    expect((await api.status(req({}, b.headers), jobId)).status).toBe(404)
    expect((await api.result(req({}, b.headers), jobId)).status).toBe(404)
    expect(await (await api.list(req({}, b.headers))).json()).toEqual({ analyses: [] })
    expect((await api.status(req(), jobId)).status).toBe(200)
    const unbound = bearer()
    expect((await api.status(req({}, unbound.headers), jobId)).status).toBe(200)
    job.clientBinding = null
  })
  it('normalizes repository URL before storage so pinned snapshot metadata agrees', async () => {
    const api = createServiceApi(store, async () => ({ id: userId }))
    expect((await api.create(req({ ...body, request: { ...body.request, repositoryUrl: `${body.request.repositoryUrl}.git` } }))).status).toBe(202)
    expect(store.enqueueAnalysis).toHaveBeenCalledWith(expect.objectContaining({ request: expect.objectContaining({ repositoryUrl: body.request.repositoryUrl }), requestFingerprint: digestJson(body) }))
  })
  it('checks current owner/workspace, exact origin and bounded strict JSON', async () => {
    const api = createServiceApi(store, async () => ({ id: userId }))
    expect((await api.create(req(body, { origin: 'https://evil.example' }))).status).toBe(403)
    expect((await api.create(req(body, { origin: '' }))).status).toBe(403)
    expect((await api.create(req(body, { 'content-type': 'text/plain' }))).status).toBe(415)
    expect((await api.create(req('x'.repeat(65536)))).status).toBe(413)
    expect((await api.create(req(body, { 'idempotency-key': '' }))).status).toBe(400)
    vi.mocked(store.getWorkspaceForOwner).mockResolvedValueOnce(null)
    expect((await api.status(req(), jobId)).status).toBe(401)
  })
  it('makes foreign and absent jobs indistinguishable, and returns pending result conflict', async () => {
    const api = createServiceApi(store, async () => ({ id: userId }))
    vi.mocked(store.getJob).mockResolvedValueOnce(null)
    expect((await api.status(req(), jobId)).status).toBe(404)
    expect(store.getJob).toHaveBeenCalledWith(workspaceId, jobId)
    expect((await api.status(req(), 'not-a-uuid')).status).toBe(404)
    expect((await api.result(req(), jobId)).status).toBe(409)
  })
  it('issues one-time owner credentials, never returns stored hashes and requires owner origin', async () => {
    const api = createServiceApi(store, async () => ({ id: userId }))
    vi.mocked(store.issueApiKey).mockImplementation(async (workspaceId, input) => ({ ...input, workspaceId, installationRef: input.installationRef ?? null, expiresAt: input.expiresAt ?? null, revokedAt: null, createdAt: workspace.createdAt }))
    const response = await api.issueKey(req({ label: 'synthetic', scopes: ['analyses:create'], installationRef: 'pika-test' }))
    expect(response.status).toBe(201)
    const result = await response.json()
    expect(result.token).toMatch(/^rl_v2_[a-f0-9-]+\.[\w-]{43}$/)
    expect(result.key).not.toHaveProperty('secretHash')
    expect(vi.mocked(store.issueApiKey).mock.calls[0][1].secretHash).not.toContain(result.token)
    const { headers } = bearer()
    expect((await api.keys(req({}, headers))).status).toBe(403)
  })
  it('uses session-only CAS edits and does not reveal raw storage errors', async () => {
    const api = createServiceApi(store, async () => ({ id: userId }))
    vi.mocked(store.saveEdit).mockResolvedValueOnce({ kind: 'conflict' }).mockResolvedValueOnce({ kind: 'invalid_scope' })
    const edit = { scopeKey: 'repository', expectedRevision: 1, text: 'Teacher edit' }
    expect((await api.saveEdit(req(edit), jobId)).status).toBe(409)
    expect((await api.saveEdit(req(edit), jobId)).status).toBe(400)
    expect(store.saveEdit).toHaveBeenCalledWith(expect.objectContaining({ workspaceId, actorUserId: userId, reportRef: jobId }))
    vi.mocked(store.listJobs).mockRejectedValueOnce(new Error('secret database payload and email'))
    const response = await api.list(req())
    expect(response.status).toBe(500)
    expect(JSON.stringify(await response.json())).not.toContain('secret')
  })
  it('uses only trusted configured origin or validated development loopback Host', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('APP_ORIGIN', '')
    const local = (headers: Record<string, string>) => new Request('http://localhost:3047/api/v2/workspace', { headers })
    expect(() => requireSameOrigin(local({ host: '127.0.0.1:3047', origin: 'http://127.0.0.1:3047' }))).not.toThrow()
    expect(() => requireSameOrigin(local({ host: '127.0.0.1:3047', origin: 'http://localhost:3047' }))).toThrow('origin_rejected')
    expect(() => requireSameOrigin(local({ host: 'evil.example', origin: 'http://evil.example' }))).toThrow('origin_rejected')
    expect(() => requireSameOrigin(local({ host: 'localhost:3047', origin: 'https://evil.example', 'x-forwarded-host': 'evil.example' }))).toThrow('origin_rejected')
    vi.stubEnv('NODE_ENV', 'production')
    expect(() => requireSameOrigin(req())).toThrow('service_not_configured')
    vi.stubEnv('APP_ORIGIN', 'https://reports.example')
    expect(() => requireSameOrigin(req())).not.toThrow()
    expect(() => requireSameOrigin(req({}, { origin: 'https://evil.example' }))).toThrow('origin_rejected')
  })
  it('never creates workspaces on owner reads', async () => {
    const api = createServiceApi(store, async () => ({ id: userId }))
    await api.workspace(req())
    expect(store.getOrCreateWorkspace).not.toHaveBeenCalled()
    await expect(authenticateService(req({}, { authorization: 'Bearer legacy-shared-key' }), store, async () => null)).rejects.toThrow('unauthorized')
  })
})
