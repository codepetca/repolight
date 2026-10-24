import { z } from 'zod'
import { publicRepositoryBundleSchema, publicRepositoryRequestSchema } from '@/lib/report/bundle-contract'

export const SERVICE_SCHEMA_VERSION = '1.0' as const
export const serviceRefSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9._~-]+$/)
export const analysisIdSchema = z.string().uuid()
export const digestSchema = z.string().regex(/^[a-f0-9]{64}$/)
export const clientBindingSchema = z.object({
  installationRef: serviceRefSchema,
  subjectRef: serviceRefSchema,
  sourceRevisionRef: serviceRefSchema,
}).strict()
export const createAnalysisRequestSchema = z.object({
  schemaVersion: z.literal(SERVICE_SCHEMA_VERSION),
  request: publicRepositoryRequestSchema,
  clientBinding: clientBindingSchema.optional(),
}).strict()
export const analysisErrorCodeSchema = z.enum([
  'repository_unavailable', 'private_repository', 'upstream_rate_limited',
  'upstream_timeout', 'upstream_unavailable', 'collection_limit',
  'invalid_evidence', 'result_too_large', 'internal_failure',
  'credential_revoked', 'job_expired', 'attempts_exhausted',
])
export const analysisStatusSchema = z.object({
  schemaVersion: z.literal(SERVICE_SCHEMA_VERSION),
  analysisId: analysisIdSchema,
  status: z.enum(['queued', 'running', 'succeeded', 'failed']),
  requestFingerprint: digestSchema,
  clientBinding: clientBindingSchema.nullable(),
  attemptCount: z.number().int().min(0).max(3),
  nextAttemptAt: z.iso.datetime({ offset: true }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  completedAt: z.iso.datetime({ offset: true }).nullable(),
  reportRef: analysisIdSchema.nullable(),
  error: z.object({ code: analysisErrorCodeSchema, retryable: z.boolean() }).strict().nullable(),
}).strict()
export const analysisResultSchema = z.object({
  schemaVersion: z.literal(SERVICE_SCHEMA_VERSION),
  analysisId: analysisIdSchema,
  requestFingerprint: digestSchema,
  clientBinding: clientBindingSchema.nullable(),
  reportRef: analysisIdSchema,
  reportDigest: digestSchema,
  bundle: publicRepositoryBundleSchema,
}).strict().superRefine((result, context) => {
  if (result.analysisId !== result.reportRef || result.bundle.bundleRef !== result.reportRef) context.addIssue({ code: 'custom', message: 'Saved report references do not match the analysis.' })
})
export const feedbackEditRequestSchema = z.object({
  scopeKey: z.string().min(1).max(160),
  expectedRevision: z.number().int().nonnegative(),
  text: z.string().max(20_000).nullable(),
}).strict()
export const feedbackEditSchema = z.object({
  reportRef: analysisIdSchema, scopeKey: z.string().min(1).max(160),
  revision: z.number().int().positive(), text: z.string().max(20_000).nullable(),
  updatedAt: z.iso.datetime({ offset: true }),
}).strict()
export type ClientBinding = z.infer<typeof clientBindingSchema>
export type CreateAnalysisRequest = z.infer<typeof createAnalysisRequestSchema>
export type AnalysisErrorCode = z.infer<typeof analysisErrorCodeSchema>
export type AnalysisStatus = z.infer<typeof analysisStatusSchema>
export type AnalysisResult = z.infer<typeof analysisResultSchema>
export type FeedbackEdit = z.infer<typeof feedbackEditSchema>

/** Deliberately constructs the public envelope; worker leases and requests never leak. */
export function toAnalysisStatus(job: {
  id: string; status: AnalysisStatus['status']; requestFingerprint: string;
  clientBinding: ClientBinding | null; attemptCount: number; nextAttemptAt: string | null;
  createdAt: string; completedAt: string | null; reportRef: string | null;
  errorCode: AnalysisErrorCode | null; errorRetryable: boolean;
}): AnalysisStatus {
  return analysisStatusSchema.parse({ schemaVersion: SERVICE_SCHEMA_VERSION,
    analysisId: job.id, status: job.status, requestFingerprint: job.requestFingerprint,
    clientBinding: job.clientBinding, attemptCount: job.attemptCount,
    nextAttemptAt: job.nextAttemptAt, createdAt: job.createdAt,
    completedAt: job.completedAt, reportRef: job.reportRef,
    error: job.errorCode ? { code: job.errorCode, retryable: job.errorRetryable } : null,
  })
}
