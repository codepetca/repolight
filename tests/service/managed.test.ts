// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomBytes, randomUUID } from 'node:crypto'
import { createManagedProvisionApi } from '@/lib/service/managed'
import { hashApiSecret, authenticateService } from '@/lib/service/auth'
import type { ServiceStore } from '@/lib/service/store-types'

const control = randomBytes(32).toString('base64url')
const input = () => ({ schemaVersion: '1.0', tenantRef: 'opaque-teacher', operationRef: randomUUID(), keyId: randomUUID(), secretHash: hashApiSecret(randomBytes(32).toString('base64url')) })
const req = (body: unknown, token = control, headers: Record<string, string> = {}) => new Request('https://example.test/api/v2/managed/provision', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...headers }, body: JSON.stringify(body) })
afterEach(() => { delete process.env.REPOLIGHT_CONTROL_SECRET; delete process.env.REPOLIGHT_CONTROL_INSTALLATION_REF })

describe('managed control endpoint', () => {
  it('requires separate configured authentication before parsing and binds the installation', async () => {
    const provisionManaged = vi.fn().mockResolvedValue({ kind: 'created', workspaceRef: 'customer-opaque' })
    const api = createManagedProvisionApi({ provisionManaged } as unknown as ServiceStore)
    expect((await api(req(input()))).status).toBe(503)
    process.env.REPOLIGHT_CONTROL_SECRET = control; process.env.REPOLIGHT_CONTROL_INSTALLATION_REF = 'pika-installation'
    expect((await api(req(input(), randomBytes(32).toString('base64url')))).status).toBe(401)
    expect((await api(req(input(), control, { cookie: 'repocat_session=example' }))).status).toBe(401)
    expect((await api(req({ ...input(), secret: 'plaintext' }))).status).toBe(400)
    expect(provisionManaged).not.toHaveBeenCalled()
    const body = input(); const response = await api(req(body))
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ schemaVersion: '1.0', workspaceRef: 'customer-opaque', installationRef: 'pika-installation', keyId: body.keyId })
    expect(provisionManaged).toHaveBeenCalledWith({ installationRef: 'pika-installation', tenantRef: body.tenantRef, operationRef: body.operationRef, keyId: body.keyId, secretHash: body.secretHash })
    provisionManaged.mockResolvedValueOnce({ kind: 'replayed', workspaceRef: 'customer-opaque' })
    expect((await api(req(body))).status).toBe(200)
    provisionManaged.mockResolvedValueOnce({ kind: 'conflict' })
    expect((await api(req(body))).status).toBe(409)
  })
  it('validates rotation with the same control authentication and an expected current key', async () => {
    process.env.REPOLIGHT_CONTROL_SECRET = control; process.env.REPOLIGHT_CONTROL_INSTALLATION_REF = 'pika-installation'
    const rotateManaged = vi.fn().mockResolvedValue({ kind: 'created', workspaceRef: 'customer-opaque' })
    const api = createManagedProvisionApi({ rotateManaged } as unknown as ServiceStore, 'rotate')
    const body = { ...input(), expectedKeyId: randomUUID() }
    expect((await api(req(body, randomBytes(32).toString('base64url')))).status).toBe(401)
    expect((await api(req(input()))).status).toBe(400)
    expect((await api(req({ ...body, expectedKeyId: body.expectedKeyId.toUpperCase() }))).status).toBe(400)
    expect((await api(req(body))).status).toBe(201)
    expect(rotateManaged).toHaveBeenCalledWith({ installationRef: 'pika-installation', tenantRef: body.tenantRef, operationRef: body.operationRef, expectedKeyId: body.expectedKeyId, keyId: body.keyId, secretHash: body.secretHash })
    rotateManaged.mockResolvedValueOnce({ kind: 'replayed', workspaceRef: 'customer-opaque' })
    expect((await api(req(body))).status).toBe(200)
    rotateManaged.mockResolvedValueOnce({ kind: 'conflict' })
    expect((await api(req(body))).status).toBe(409)
  })
  it('authenticates an ownerless scoped key and rejects wrong secrets and scopes', async () => {
    const id = randomUUID(), secret = randomBytes(32).toString('base64url')
    const key = { id, workspaceId: randomUUID(), ownerUserId: null, customerRef: 'customer-opaque', label: 'managed', scopes: ['analyses:read'], installationRef: 'pika', expiresAt: null, revokedAt: null, createdAt: new Date().toISOString(), secretHash: hashApiSecret(secret) }
    const store = { findApiKey: vi.fn().mockResolvedValue(key) } as unknown as ServiceStore
    const request = (value: string) => new Request('https://example.test', { headers: { authorization: `Bearer rl_v2_${id}.${value}` } })
    const principal = await authenticateService(request(secret), store, async () => null, { scope: 'analyses:read' })
    expect(principal.workspace.id).toBe(key.workspaceId)
    await expect(authenticateService(request(secret), store, async () => null, { scope: 'analyses:create' })).rejects.toMatchObject({ status: 403 })
    await expect(authenticateService(request(randomBytes(32).toString('base64url')), store, async () => null)).rejects.toMatchObject({ status: 401 })
  })
})
