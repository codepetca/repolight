import { z } from 'zod'

export const scopeKeySchema = z.string().max(160).regex(/^(?:repository|contributor:[A-Za-z0-9_[\]-]+)$/)
export const interpretationRequestSchema = z.object({ schemaVersion: z.literal('1.0'), requestId: z.uuid(), scopeKey: scopeKeySchema }).strict()
export const interpretationErrorSchema = z.enum(['configuration_unavailable', 'provider_timeout', 'provider_unavailable', 'provider_refused', 'provider_incomplete', 'invalid_output', 'expired', 'internal_failure'])
const observationSchema = z.object({ id: z.string().regex(/^observation-[1-5]$/), kind: z.enum(['strength', 'improvement', 'review_question', 'limitation']), title: z.string().min(1).max(80), text: z.string().min(1).max(700), citationIds: z.array(z.string().min(1).max(60)).min(1).max(5) }).strict()
export const citationSchema = z.object({ id: z.string().min(1).max(60), label: z.string().min(1).max(100), value: z.union([z.number().finite(), z.enum(['complete', 'partial', 'unavailable', 'applied', 'not_supplied'])]).nullable(), status: z.enum(['available', 'partial', 'unavailable']), sourceKey: z.enum(['metrics.commits', 'metrics.commitDensity', 'metrics.scheduledDayCoverage', 'metrics.busiestDayShare', 'activity.activeDays', 'activity.undatedCommits', 'rules.genericMessageShare', 'rules.longestScheduledGap', 'coverage.history', 'coverage.files', 'baseline.status']) }).strict()
export const interpretationSidecarSchema = z.object({ schemaVersion: z.literal('1.0'), provenance: z.object({ provider: z.literal('openai'), model: z.string().min(1).max(100), promptVersion: z.literal('1.0.0'), inputDigest: z.string().regex(/^[a-f0-9]{64}$/), reportDigest: z.string().regex(/^[a-f0-9]{64}$/), generatedAt: z.iso.datetime({ offset: true }), scopeKey: scopeKeySchema }).strict(), observations: z.array(observationSchema).max(5), citations: z.array(citationSchema).max(20) }).strict().superRefine((sidecar, ctx) => {
  const ids = new Set(sidecar.citations.map(cite => cite.id))
  if (ids.size !== sidecar.citations.length) ctx.addIssue({ code: 'custom', message: 'Duplicate citation IDs.' })
  for (const observation of sidecar.observations) for (const id of observation.citationIds) if (!ids.has(id)) ctx.addIssue({ code: 'custom', message: 'Unknown citation.' })
})
export const interpretationResponseSchema = z.object({ schemaVersion: z.literal('1.0'), enabled: z.boolean(), state: z.enum(['disabled', 'not_requested', 'pending', 'available', 'failed']), scopeKey: scopeKeySchema, requestId: z.uuid().nullable(), interpretation: interpretationSidecarSchema.nullable(), error: interpretationErrorSchema.nullable() }).strict()
export type InterpretationRequest = z.infer<typeof interpretationRequestSchema>
export type InterpretationResponse = z.infer<typeof interpretationResponseSchema>
export type InterpretationSidecar = z.infer<typeof interpretationSidecarSchema>
export type InterpretationError = z.infer<typeof interpretationErrorSchema>
export type InterpretationCitation = z.infer<typeof citationSchema>
