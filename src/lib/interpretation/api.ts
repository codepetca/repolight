import { authenticateService, type ReadSession } from '@/lib/service/auth'
import { analysisIdSchema } from '@/lib/service/contract'
import type { ServiceStore } from '@/lib/service/store-types'
import { readServiceJson, serviceHandle, serviceJson, ServiceHttpError } from '@/lib/service/http'
import { interpretationRequestSchema, interpretationResponseSchema, interpretationSidecarSchema, scopeKeySchema, type InterpretationResponse, type InterpretationSidecar } from './contract'
import { interpretationEvidence } from './evidence'
import { generateInterpretation, interpretationConfig, InterpretationFailure } from './provider'
import type { InterpretationRow, InterpretationStore } from './store'
export function interpretationEnvelope(row: InterpretationRow | null, enabled: boolean, scopeKey: string): InterpretationResponse {
  const expired = row?.state === 'generating' && Date.parse(row.leaseExpiresAt) <= Date.now()
  return interpretationResponseSchema.parse({ schemaVersion: '1.0', enabled, state: row ? expired ? 'failed' : row.state === 'generating' ? 'pending' : row.state : enabled ? 'not_requested' : 'disabled', scopeKey, requestId: row?.requestId ?? null, interpretation: row?.sidecar ?? null, error: expired ? 'expired' : row?.error ?? null })
}
export function createInterpretationApi(services: ServiceStore, store: InterpretationStore, readSession: ReadSession, options: { fetchImpl?: typeof fetch; config?: typeof interpretationConfig } = {}) {
  const load = async (request: Request, id: string, scopeKey: string, mutation: boolean) => {
    const principal = await authenticateService(request, services, readSession, { sessionOnly: true, mutation })
    if (!analysisIdSchema.safeParse(id).success) throw new ServiceHttpError('not_found', 404)
    const job = await services.getJob(principal.workspace.id, id)
    if (!job) throw new ServiceHttpError('not_found', 404)
    if (job.status !== 'succeeded') throw new ServiceHttpError('result_not_ready', 409)
    const result = await services.getResult(principal.workspace.id, id)
    if (!result) throw new ServiceHttpError('not_found', 404)
    const scope = scopeKey === 'repository' || result.bundle.contributors.some(entry => `contributor:${entry.contributor.id}` === scopeKey)
    if (!scope) throw new ServiceHttpError('invalid_scope', 400)
    return { workspaceId: principal.workspace.id, result, evidence: interpretationEvidence(result, scopeKey) }
  }
  return {
    get: (request: Request, id: string) => serviceHandle(async () => {
      const scopeKey = scopeKeySchema.parse(new URL(request.url).searchParams.get('scopeKey') ?? 'repository')
      const loaded = await load(request, id, scopeKey, false)
      const config = (options.config ?? interpretationConfig)()
      return serviceJson(interpretationEnvelope(await store.latest(loaded.workspaceId, id, scopeKey), config.enabled, scopeKey))
    }),
    post: (request: Request, id: string) => serviceHandle(async () => {
      const input = interpretationRequestSchema.parse(await readServiceJson(request))
      const loaded = await load(request, id, input.scopeKey, true)
      const config = (options.config ?? interpretationConfig)()
      await store.recover(loaded.workspaceId)
      const previous = await store.find(loaded.workspaceId, input.requestId)
      if (previous) {
        if (previous.jobId !== id || previous.scopeKey !== input.scopeKey) throw new ServiceHttpError('request_conflict', 409)
        return serviceJson(interpretationEnvelope(previous, config.enabled, input.scopeKey), previous.state === 'generating' && Date.parse(previous.leaseExpiresAt) > Date.now() ? 202 : 200)
      }
      if (!config.enabled) return serviceJson(interpretationEnvelope(null, false, input.scopeKey))
      if (!config.model || !config.apiKey) return serviceJson({ ...interpretationEnvelope(null, true, input.scopeKey), state: 'failed', error: 'configuration_unavailable' })
      const reserved = await store.reserve({ workspaceId: loaded.workspaceId, jobId: id, requestId: input.requestId, scopeKey: input.scopeKey, model: config.model, reportDigest: loaded.result.reportDigest, evidence: loaded.evidence })
      if (!('row' in reserved)) throw new ServiceHttpError(reserved.kind === 'limited' ? 'interpretation_limit' : reserved.kind === 'conflict' ? 'request_conflict' : 'not_found', reserved.kind === 'limited' ? 429 : reserved.kind === 'conflict' ? 409 : 404)
      if (reserved.kind === 'replayed') return serviceJson(interpretationEnvelope(reserved.row, true, input.scopeKey), reserved.row.state === 'generating' ? 202 : 200)
      let sidecar: InterpretationSidecar | null = null
      let error: InterpretationRow['error'] = null
      try {
        const observations = await generateInterpretation(loaded.evidence, { model: config.model, apiKey: config.apiKey }, options.fetchImpl, request.signal)
        sidecar = interpretationSidecarSchema.parse({ schemaVersion: '1.0', provenance: { provider: 'openai', model: reserved.row.model, promptVersion: '1.0.0', inputDigest: loaded.evidence.inputDigest, reportDigest: loaded.result.reportDigest, generatedAt: new Date().toISOString(), scopeKey: input.scopeKey }, observations, citations: loaded.evidence.citations })
      } catch (failure) { error = failure instanceof InterpretationFailure ? failure.code : 'internal_failure' }
      if (!await store.finish(reserved.row, sidecar, error)) throw new ServiceHttpError('not_found', 404)
      return serviceJson(interpretationEnvelope({ ...reserved.row, state: sidecar ? 'available' : 'failed', sidecar, error }, true, input.scopeKey))
    }),
  }
}
