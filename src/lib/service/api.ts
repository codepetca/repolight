import { z } from 'zod'
import { makeRepositoryTarget } from '@/lib/engine/repo'
import { analysisIdSchema, analysisResultSchema, createAnalysisRequestSchema, feedbackEditRequestSchema, serviceRefSchema, toAnalysisStatus } from './contract'
import { authenticateService, newApiCredential, safeApiKeyMetadata, type ReadSession, type ServicePrincipal } from './auth'
import { digestJson, readServiceJson, serviceHandle, serviceJson, ServiceHttpError } from './http'
import type { ServiceStore, StoredJob } from './store-types'

const keyRequestSchema = z.object({ label: z.string().trim().min(1).max(100), scopes: z.array(z.enum(['analyses:create', 'analyses:read'])).min(1).max(2), installationRef: serviceRefSchema.nullable().optional(), expiresAt: z.iso.datetime({ offset: true }).nullable().optional() }).strict()
const canReadJob = (principal: ServicePrincipal, job: StoredJob) => principal.kind === 'session' || principal.installationRef === null || job.clientBinding?.installationRef === principal.installationRef

export function createServiceApi(store: ServiceStore, readSession: ReadSession) {
  return {
    create: (request: Request) => serviceHandle(async () => {
      const parsed = createAnalysisRequestSchema.parse(await readServiceJson(request))
      const body = { ...parsed, request: { ...parsed.request, repositoryUrl: makeRepositoryTarget(parsed.request.repositoryUrl, parsed.request.branch)!.repoUrl } }
      const principal = await authenticateService(request, store, readSession, { mutation: true, scope: 'analyses:create', initialize: true })
      const idempotencyKey = request.headers.get('idempotency-key')
      if (!idempotencyKey || !/^[A-Za-z0-9._~-]{1,128}$/.test(idempotencyKey)) throw new ServiceHttpError('idempotency_key_required', 400)
      if (principal.kind === 'key' && (principal.installationRef !== (body.clientBinding?.installationRef ?? null))) throw new ServiceHttpError('installation_binding_mismatch', 403)
      const result = await store.enqueueAnalysis({ workspaceId: principal.workspace.id, createdByKeyId: principal.kind === 'key' ? principal.keyId : null, idempotencyKey, request: body.request, requestFingerprint: digestJson(body), clientBinding: body.clientBinding ?? null })
      if (result.kind === 'conflict') throw new ServiceHttpError('idempotency_conflict', 409)
      if (result.kind === 'unauthorized') throw new ServiceHttpError('unauthorized', 401)
      if (result.kind === 'limited') throw new ServiceHttpError(result.reason, 429)
      return serviceJson(toAnalysisStatus(result.job), 202)
    }),
    list: (request: Request) => serviceHandle(async () => {
      const principal = await authenticateService(request, store, readSession, { scope: 'analyses:read' })
      return serviceJson({ analyses: (await store.listJobs(principal.workspace.id, 50, principal.kind === 'key' ? principal.installationRef ?? undefined : undefined)).filter(job => canReadJob(principal, job)).map(toAnalysisStatus) })
    }),
    status: (request: Request, id: string) => serviceHandle(async () => {
      const principal = await authenticateService(request, store, readSession, { scope: 'analyses:read' })
      if (!analysisIdSchema.safeParse(id).success) throw new ServiceHttpError('not_found', 404)
      const job = await store.getJob(principal.workspace.id, id)
      if (!job || !canReadJob(principal, job)) throw new ServiceHttpError('not_found', 404)
      return serviceJson(toAnalysisStatus(job))
    }),
    result: (request: Request, id: string) => serviceHandle(async () => {
      const principal = await authenticateService(request, store, readSession, { scope: 'analyses:read' })
      if (!analysisIdSchema.safeParse(id).success) throw new ServiceHttpError('not_found', 404)
      const job = await store.getJob(principal.workspace.id, id)
      if (!job || !canReadJob(principal, job)) throw new ServiceHttpError('not_found', 404)
      if (job.status !== 'succeeded') throw new ServiceHttpError('result_not_ready', 409)
      const result = await store.getResult(principal.workspace.id, id)
      if (!result) throw new ServiceHttpError('not_found', 404)
      return serviceJson(analysisResultSchema.parse(result))
    }),
    workspace: (request: Request) => serviceHandle(async () => {
      const principal = await authenticateService(request, store, readSession, { sessionOnly: true })
      return serviceJson({ workspace: { id: principal.workspace.id, customerRef: principal.workspace.customerRef } })
    }),
    initializeWorkspace: (request: Request) => serviceHandle(async () => {
      z.object({}).strict().parse(await readServiceJson(request))
      const principal = await authenticateService(request, store, readSession, { sessionOnly: true, mutation: true, initialize: true })
      return serviceJson({ workspace: { id: principal.workspace.id, customerRef: principal.workspace.customerRef } }, 201)
    }),
    keys: (request: Request) => serviceHandle(async () => {
      const principal = await authenticateService(request, store, readSession, { sessionOnly: true })
      return serviceJson({ keys: (await store.listApiKeys(principal.workspace.id)).map(safeApiKeyMetadata) })
    }),
    issueKey: (request: Request) => serviceHandle(async () => {
      const body = keyRequestSchema.parse(await readServiceJson(request))
      const principal = await authenticateService(request, store, readSession, { sessionOnly: true, mutation: true, initialize: true })
      if (body.expiresAt && Date.parse(body.expiresAt) <= Date.now()) throw new ServiceHttpError('invalid_request', 400)
      const credential = newApiCredential()
      const metadata = await store.issueApiKey(principal.workspace.id, { ...body, id: credential.id, secretHash: credential.secretHash, scopes: [...new Set(body.scopes)] })
      return serviceJson({ key: safeApiKeyMetadata(metadata), token: credential.token }, 201)
    }),
    revokeKey: (request: Request, keyId: string) => serviceHandle(async () => {
      const principal = await authenticateService(request, store, readSession, { sessionOnly: true, mutation: true })
      await readServiceJson(request).then(value => z.object({}).strict().parse(value))
      if (!analysisIdSchema.safeParse(keyId).success || !await store.revokeApiKey(principal.workspace.id, keyId)) throw new ServiceHttpError('not_found', 404)
      return serviceJson({ revoked: true })
    }),
    edits: (request: Request, id: string) => serviceHandle(async () => {
      const principal = await authenticateService(request, store, readSession, { sessionOnly: true })
      if (!analysisIdSchema.safeParse(id).success) throw new ServiceHttpError('not_found', 404)
      const edits = await store.getEdits(principal.workspace.id, id)
      if (edits === null) throw new ServiceHttpError('not_found', 404)
      return serviceJson({ edits })
    }),
    saveEdit: (request: Request, id: string) => serviceHandle(async () => {
      const principal = await authenticateService(request, store, readSession, { sessionOnly: true, mutation: true })
      if (!analysisIdSchema.safeParse(id).success) throw new ServiceHttpError('not_found', 404)
      const body = feedbackEditRequestSchema.parse(await readServiceJson(request))
      if (principal.kind !== 'session') throw new ServiceHttpError('session_required', 403)
      const saved = await store.saveEdit({ workspaceId: principal.workspace.id, reportRef: id, actorUserId: principal.userId, ...body })
      if (saved.kind !== 'saved') throw new ServiceHttpError(saved.kind, saved.kind === 'conflict' ? 409 : saved.kind === 'invalid_scope' ? 400 : 404)
      return serviceJson({ edit: saved.edit })
    }),
  }
}
