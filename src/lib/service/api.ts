import { z } from 'zod'
import { makeRepositoryTarget } from '@/lib/engine/repo'
import { connectionMetadataSchema, analysisIdSchema, analysisResultSchema, erasureRequestSchema, erasureReceiptSchema, createAnalysisRequestSchema, feedbackEditRequestSchema, serviceRefSchema, toAnalysisStatus } from './contract'
import { authenticateService, newApiCredential, safeApiKeyMetadata, type ReadSession, type ServicePrincipal } from './auth'
import { digestJson, readServiceJson, serviceHandle, serviceJson, ServiceHttpError } from './http'
import type { ServiceStore, StoredJob } from './store-types'

const keyRequestSchema = z.object({ label: z.string().trim().min(1).max(100), scopes: z.array(z.enum(['analyses:create', 'analyses:read', 'analyses:erase'])).min(1).max(3), installationRef: serviceRefSchema.nullable().optional(), expiresAt: z.iso.datetime({ offset: true }).nullable().optional() }).strict().superRefine(validateEraseKeyBinding)
function validateEraseKeyBinding(value: { scopes: string[]; installationRef?: string | null }, context: z.RefinementCtx) {
  if (value.scopes.includes('analyses:erase') && !value.installationRef) context.addIssue({ code: 'custom', path: ['installationRef'], message: 'Erasure permission requires an installation binding.' })
}
const canReadJob = (principal: ServicePrincipal, job: StoredJob) => principal.kind === 'session' || principal.installationRef === null || job.clientBinding?.installationRef === principal.installationRef

export function createServiceApi(store: ServiceStore, readSession: ReadSession) {
  return {
    connection: (request: Request) => serviceHandle(async () => {
      const principal = await authenticateService(request, store, readSession)
      return serviceJson(connectionMetadataSchema.parse({ schemaVersion: '1.0', workspaceRef: principal.workspace.customerRef, installationRef: principal.kind === 'key' ? principal.installationRef : null, scopes: principal.kind === 'key' ? principal.scopes : ['analyses:create', 'analyses:read', 'analyses:erase'] }))
    }),
    erase: (request: Request) => serviceHandle(async () => {
      const body = erasureRequestSchema.parse(await readServiceJson(request))
      const principal = await authenticateService(request, store, readSession, { mutation: true, scope: 'analyses:erase' })
      if (principal.kind === 'key' && principal.installationRef !== body.installationRef) throw new ServiceHttpError('installation_binding_mismatch', 403)
      const result = await store.eraseSubject({ workspaceId: principal.workspace.id, createdByKeyId: principal.kind === 'key' ? principal.keyId : null, request: body })
      if (result.kind !== 'erased') throw new ServiceHttpError(result.kind === 'conflict' ? 'operation_conflict' : 'unauthorized', result.kind === 'conflict' ? 409 : 401)
      return serviceJson(erasureReceiptSchema.parse(result.receipt))
    }),
    create: (request: Request, options: { allowAdmission?: boolean; scheduleWake?: () => void } = {}) => serviceHandle(async () => {
      const parsed = createAnalysisRequestSchema.parse(await readServiceJson(request))
      const body = { ...parsed, request: { ...parsed.request, repositoryUrl: makeRepositoryTarget(parsed.request.repositoryUrl, parsed.request.branch)!.repoUrl } }
      const allowAdmission = options.allowAdmission !== false
      const principal = await authenticateService(request, store, readSession, { mutation: true, scope: 'analyses:create', initialize: allowAdmission })
      const idempotencyKey = request.headers.get('idempotency-key')
      if (!idempotencyKey || !/^[A-Za-z0-9._~-]{1,128}$/.test(idempotencyKey)) throw new ServiceHttpError('idempotency_key_required', 400)
      if (principal.kind === 'key' && (principal.installationRef !== (body.clientBinding?.installationRef ?? null))) throw new ServiceHttpError('installation_binding_mismatch', 403)
      const input = { workspaceId: principal.workspace.id, createdByKeyId: principal.kind === 'key' ? principal.keyId : null, idempotencyKey, request: body.request, requestFingerprint: digestJson(body), clientBinding: body.clientBinding ?? null }
      const result = allowAdmission ? await store.enqueueAnalysis(input) : await store.replayAnalysis(input)
      if (result.kind === 'unavailable') throw new ServiceHttpError('service_not_configured', 503)
      if (result.kind === 'subject_erased') throw new ServiceHttpError('subject_erased', 410)
      if (result.kind === 'conflict') throw new ServiceHttpError('idempotency_conflict', 409)
      if (result.kind === 'unauthorized') throw new ServiceHttpError('unauthorized', 401)
      if (result.kind === 'limited') throw new ServiceHttpError(result.reason, 429)
      if (result.kind === 'accepted' && options.scheduleWake) {
        try { options.scheduleWake() }
        catch { console.warn('Analysis was queued but its immediate worker wake could not be scheduled.') }
      }
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
