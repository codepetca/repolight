import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type { ApiKeyMetadata, ApiKeyScope, ServiceStore, WorkspaceRecord } from './store-types'
import { ServiceHttpError, requireSameOrigin } from './http'

export type SessionIdentity = { id: string }
export type ReadSession = () => Promise<SessionIdentity | null>
export type ServicePrincipal = { kind: 'session'; workspace: WorkspaceRecord; userId: string } | { kind: 'key'; workspace: WorkspaceRecord; keyId: string; scopes: ApiKeyScope[]; installationRef: string | null }
const keyPattern = /^rl_v2_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/
export const hashApiSecret = (secret: string): string => createHash('sha256').update(secret).digest('hex')
export function newApiCredential(): { id: string; token: string; secretHash: string } {
  const id = randomUUID(), secret = randomBytes(32).toString('base64url')
  return { id, token: `rl_v2_${id}.${secret}`, secretHash: hashApiSecret(secret) }
}
export function safeApiKeyMetadata(record: ApiKeyMetadata): ApiKeyMetadata {
  return { id: record.id, workspaceId: record.workspaceId, label: record.label, scopes: record.scopes, installationRef: record.installationRef, expiresAt: record.expiresAt, revokedAt: record.revokedAt, createdAt: record.createdAt }
}
export async function authenticateService(request: Request, store: ServiceStore, readSession: ReadSession, options: { sessionOnly?: boolean; mutation?: boolean; scope?: ApiKeyScope; initialize?: boolean } = {}): Promise<ServicePrincipal> {
  const authorization = request.headers.get('authorization')
  const hasSessionCookie = /(?:^|;\s*)repocat_session=/.test(request.headers.get('cookie') || '')
  if (authorization && hasSessionCookie) throw new ServiceHttpError('ambiguous_credentials', 401)
  if (authorization) {
    if (options.sessionOnly) throw new ServiceHttpError('session_required', 403)
    const match = /^Bearer (\S+)$/i.exec(authorization)
    const parsed = match && keyPattern.exec(match[1])
    if (!parsed) throw new ServiceHttpError('unauthorized', 401)
    const key = await store.findApiKey(parsed[1])
    const actual = Buffer.from(hashApiSecret(parsed[2]), 'hex')
    const expected = Buffer.from(key?.secretHash && /^[a-f0-9]{64}$/.test(key.secretHash) ? key.secretHash : '0'.repeat(64), 'hex')
    const valid = timingSafeEqual(actual, expected)
    if (!key || !valid || key.revokedAt || (key.expiresAt !== null && (!Number.isFinite(Date.parse(key.expiresAt)) || Date.parse(key.expiresAt) <= Date.now()))) throw new ServiceHttpError('unauthorized', 401)
    if (options.scope && !key.scopes.includes(options.scope)) throw new ServiceHttpError('forbidden', 403)
    const workspace = key.ownerUserId === null
      ? { id: key.workspaceId, ownerUserId: null, customerRef: key.customerRef, createdAt: key.createdAt }
      : await store.getWorkspaceForOwner(key.ownerUserId, key.workspaceId)
    if (!workspace || workspace.customerRef !== key.customerRef) throw new ServiceHttpError('unauthorized', 401)
    return { kind: 'key', workspace, keyId: key.id, scopes: key.scopes, installationRef: key.installationRef }
  }
  const user = await readSession()
  if (!user) throw new ServiceHttpError('unauthorized', 401)
  if (options.mutation) requireSameOrigin(request)
  const workspace = options.initialize ? await store.getOrCreateWorkspace(user.id) : await store.getWorkspaceForOwner(user.id)
  if (!workspace || workspace.ownerUserId !== user.id) throw new ServiceHttpError('unauthorized', 401)
  return { kind: 'session', workspace, userId: user.id }
}
