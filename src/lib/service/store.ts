import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { publicRepositoryBundleSchema, publicRepositoryRequestSchema } from '@/lib/report/bundle-contract'
import { analysisErrorCodeSchema, analysisIdSchema, analysisResultSchema, clientBindingSchema, digestSchema, feedbackEditSchema, serviceRefSchema, type FeedbackEdit } from './contract'
import { createNeonSqlExecutor, type SqlExecutor } from './sql-executor'
import { DEFAULT_SERVICE_LIMITS, type ApiKeyMetadata, type ApiKeyRecord, type EnqueueAnalysisResult, type PinnedSnapshot, type ServiceStore, type StoredJob, type WorkspaceRecord } from './store-types'

type Row = Record<string, unknown>
const timestamp = (value: unknown): string => new Date(value instanceof Date ? value.getTime() : String(value)).toISOString()
const nullableTime = (value: unknown): string | null => value == null ? null : timestamp(value)
function workspace(row: Row): WorkspaceRecord {
  return { id: String(row.id), ownerUserId: String(row.owner_user_id), customerRef: String(row.customer_ref), createdAt: timestamp(row.created_at) }
}
function keyMetadata(row: Row): ApiKeyMetadata {
  return { id: String(row.id), workspaceId: String(row.workspace_id), label: String(row.label), scopes: row.scopes as ApiKeyMetadata['scopes'], installationRef: row.installation_ref == null ? null : String(row.installation_ref), expiresAt: nullableTime(row.expires_at), revokedAt: nullableTime(row.revoked_at), createdAt: timestamp(row.created_at) }
}
function job(row: Row): StoredJob {
  return { id: String(row.id), workspaceId: String(row.workspace_id), createdByKeyId: row.created_by_key_id == null ? null : String(row.created_by_key_id), idempotencyKey: String(row.idempotency_key),
    request: publicRepositoryRequestSchema.parse(row.request_json), requestFingerprint: digestSchema.parse(row.request_fingerprint), clientBinding: row.client_binding == null ? null : clientBindingSchema.parse(row.client_binding),
    status: row.status as StoredJob['status'], attemptCount: Number(row.attempt_count), maxAttempts: Number(row.max_attempts), nextAttemptAt: nullableTime(row.next_attempt_at),
    leaseToken: row.lease_token == null ? null : String(row.lease_token), leaseGeneration: Number(row.lease_generation), leaseExpiresAt: nullableTime(row.lease_expires_at), snapshot: row.snapshot_json == null ? null : pinnedSnapshotSchema.parse(row.snapshot_json),
    reportRef: row.report_ref == null ? null : String(row.report_ref), errorCode: row.error_code == null ? null : analysisErrorCodeSchema.parse(row.error_code), errorRetryable: row.error_retryable === true,
    createdAt: timestamp(row.created_at), completedAt: nullableTime(row.completed_at), deadlineAt: timestamp(row.deadline_at),
  }
}
function edit(row: Row): FeedbackEdit {
  return feedbackEditSchema.parse({ reportRef: row.report_ref, scopeKey: row.scope_key, revision: row.revision, text: row.text, updatedAt: timestamp(row.updated_at) })
}
export const pinnedSnapshotSchema = z.object({
  repositoryUrl: z.string().regex(/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  branch: z.string().min(1).max(200), sha: z.string().regex(/^[a-f0-9]{40}$/),
  capturedAt: z.iso.datetime({ offset: true }), kind: z.literal('analysis_time'),
}).strict()
const keyIssueSchema = z.object({ id: analysisIdSchema, label: z.string().trim().min(1).max(100), secretHash: digestSchema,
  scopes: z.array(z.enum(['analyses:create', 'analyses:read'])).min(1).max(2),
  installationRef: z.string().regex(/^[A-Za-z0-9._~-]{1,128}$/).nullable().optional(), expiresAt: z.iso.datetime({ offset: true }).nullable().optional(),
}).strict()

/** Trusted server/worker API. Every public caller must first bind a principal to workspaceId. */
export function createServiceStore(providedExecutor?: SqlExecutor): ServiceStore {
  let executor = providedExecutor
  const db = () => executor ?? (executor = createNeonSqlExecutor(process.env.DATABASE_URL || ''))
  const scalar = async (sql: string, args: unknown[]): Promise<unknown> => (await db().query(sql, args))[0]?.value
  const leaseArgs = (lease: { jobId: string; leaseToken: string; leaseGeneration: number }) => [analysisIdSchema.parse(lease.jobId), analysisIdSchema.parse(lease.leaseToken), z.number().int().positive().parse(lease.leaseGeneration)]
  return {
    async getOrCreateWorkspace(ownerUserId) {
      analysisIdSchema.parse(ownerUserId)
      const rows = await db().query(`INSERT INTO public.rl_workspaces(owner_user_id,customer_ref) VALUES($1,$2) ON CONFLICT(owner_user_id) DO UPDATE SET owner_user_id=excluded.owner_user_id RETURNING *`, [ownerUserId, `customer_${randomUUID()}`])
      return workspace(rows[0])
    },
    async getWorkspaceForOwner(ownerUserId, workspaceId) {
      const rows = await db().query(`SELECT w.* FROM public.rl_workspaces w JOIN public.users u ON u.id=w.owner_user_id WHERE w.owner_user_id=$1 AND ($2::uuid IS NULL OR w.id=$2)`, [analysisIdSchema.parse(ownerUserId), workspaceId ? analysisIdSchema.parse(workspaceId) : null])
      return rows[0] ? workspace(rows[0]) : null
    },
    async issueApiKey(workspaceId, input) {
      const value = keyIssueSchema.parse(input)
      const rows = await db().query(`INSERT INTO public.rl_api_keys(id,workspace_id,label,secret_hash,scopes,installation_ref,expires_at) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7) RETURNING id,workspace_id,label,scopes,installation_ref,expires_at,revoked_at,created_at`, [value.id, analysisIdSchema.parse(workspaceId), value.label, value.secretHash, JSON.stringify([...new Set(value.scopes)]), value.installationRef ?? null, value.expiresAt ?? null])
      return keyMetadata(rows[0])
    },
    async listApiKeys(workspaceId) {
      return (await db().query(`SELECT id,workspace_id,label,scopes,installation_ref,expires_at,revoked_at,created_at FROM public.rl_api_keys WHERE workspace_id=$1 ORDER BY created_at,id`, [analysisIdSchema.parse(workspaceId)])).map(keyMetadata)
    },
    async revokeApiKey(workspaceId, keyId) {
      return (await db().query(`UPDATE public.rl_api_keys SET revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE workspace_id=$1 AND id=$2 RETURNING id`, [analysisIdSchema.parse(workspaceId), analysisIdSchema.parse(keyId)])).length === 1
    },
    async findApiKey(keyId) {
      const rows = await db().query(`SELECT k.*,w.customer_ref,w.owner_user_id FROM public.rl_api_keys k JOIN public.rl_workspaces w ON w.id=k.workspace_id WHERE k.id=$1 AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at>clock_timestamp())`, [analysisIdSchema.parse(keyId)])
      if (!rows[0]) return null
      return { ...keyMetadata(rows[0]), secretHash: String(rows[0].secret_hash), customerRef: String(rows[0].customer_ref), ownerUserId: String(rows[0].owner_user_id) } satisfies ApiKeyRecord
    },
    async enqueueAnalysis(input) {
      const limits = { ...DEFAULT_SERVICE_LIMITS, ...input.limits }
      const request = publicRepositoryRequestSchema.parse(input.request)
      const value = await scalar(`SELECT public.rl_enqueue_analysis($1,$2,$3,$4::jsonb,$5,$6::jsonb,$7,$8,$9,$10) AS value`, [analysisIdSchema.parse(input.workspaceId), input.createdByKeyId ? analysisIdSchema.parse(input.createdByKeyId) : null, z.string().min(1).max(128).parse(input.idempotencyKey), JSON.stringify(request), digestSchema.parse(input.requestFingerprint), input.clientBinding ? JSON.stringify(clientBindingSchema.parse(input.clientBinding)) : null, limits.dailyAdmissions, limits.queuedPerWorkspace, limits.maxAttempts, limits.jobLifetimeSeconds]) as Row
      if (value.kind === 'accepted' || value.kind === 'replayed') return { kind: value.kind, job: job(value.job as Row) }
      return value as Exclude<EnqueueAnalysisResult, { job: StoredJob }>
    },
    async getJob(workspaceId, jobId) {
      const rows = await db().query(`SELECT * FROM public.rl_analysis_jobs WHERE workspace_id=$1 AND id=$2`, [analysisIdSchema.parse(workspaceId), analysisIdSchema.parse(jobId)])
      return rows[0] ? job(rows[0]) : null
    },
    async listJobs(workspaceId, limit = 20, installationRef) {
      return (await db().query(`SELECT * FROM public.rl_analysis_jobs WHERE workspace_id=$1 AND ($3::text IS NULL OR client_binding->>'installationRef'=$3) ORDER BY created_at DESC,id DESC LIMIT $2`, [analysisIdSchema.parse(workspaceId), Math.max(1, Math.min(100, Math.floor(limit))), installationRef === undefined ? null : serviceRefSchema.parse(installationRef)])).map(job)
    },
    async getResult(workspaceId, jobId) {
      const rows = await db().query(`SELECT r.*,j.request_fingerprint,j.client_binding FROM public.rl_reports r JOIN public.rl_analysis_jobs j ON j.id=r.job_id AND j.workspace_id=r.workspace_id WHERE r.workspace_id=$1 AND r.job_id=$2 AND j.status='succeeded'`, [analysisIdSchema.parse(workspaceId), analysisIdSchema.parse(jobId)])
      const row = rows[0]
      return row ? analysisResultSchema.parse({ schemaVersion: '1.0', analysisId: row.job_id, requestFingerprint: row.request_fingerprint, clientBinding: row.client_binding, reportRef: row.id, reportDigest: row.report_digest, bundle: row.bundle_json }) : null
    },
    async getEdits(workspaceId, reportRef) {
      const reports = await db().query(`SELECT id FROM public.rl_reports WHERE workspace_id=$1 AND id=$2`, [analysisIdSchema.parse(workspaceId), analysisIdSchema.parse(reportRef)])
      if (!reports.length) return null
      return (await db().query(`SELECT * FROM public.rl_feedback_edits WHERE workspace_id=$1 AND report_ref=$2 ORDER BY scope_key`, [workspaceId, reportRef])).map(edit)
    },
    async saveEdit(input) {
      const result = await scalar(`SELECT public.rl_save_edit($1,$2,$3,$4,$5,$6) AS value`, [analysisIdSchema.parse(input.workspaceId), analysisIdSchema.parse(input.reportRef), analysisIdSchema.parse(input.actorUserId), z.string().min(1).max(160).parse(input.scopeKey), z.number().int().nonnegative().parse(input.expectedRevision), z.string().max(20_000).nullable().parse(input.text)]) as Row
      return result.kind === 'saved' ? { kind: 'saved', edit: edit(result.edit as Row) } : result as { kind: 'conflict' | 'not_found' | 'invalid_scope' }
    },
    async claimAnalysis(input) {
      const limits = { ...DEFAULT_SERVICE_LIMITS, ...input.limits }
      const result = await scalar(`SELECT public.rl_claim_analysis($1,$2,$3,$4) AS value`, [z.string().min(1).max(128).parse(input.workerId), input.leaseSeconds ?? 90, limits.runningPerWorkspace, limits.runningGlobal])
      return result ? job(result as Row) : null
    },
    async renewLease(lease, leaseSeconds = 90) { return await scalar(`SELECT public.rl_renew_lease($1,$2,$3,$4) AS value`, [...leaseArgs(lease), leaseSeconds]) === true },
    async pinSnapshot(lease, snapshot: PinnedSnapshot) { return await scalar(`SELECT public.rl_pin_snapshot($1,$2,$3,$4::jsonb) AS value`, [...leaseArgs(lease), JSON.stringify(pinnedSnapshotSchema.parse(snapshot))]) === true },
    async completeAnalysis(lease, input) {
      const bundle = publicRepositoryBundleSchema.parse(input.bundle)
      const serialized = JSON.stringify(bundle)
      if (Buffer.byteLength(serialized) > 8_000_000) throw new Error('Service result exceeds the persistence limit.')
      return await scalar(`SELECT public.rl_complete_analysis($1,$2,$3,$4::jsonb,$5) AS value`, [...leaseArgs(lease), serialized, digestSchema.parse(input.reportDigest)]) === true
    },
    async failOrRetryAnalysis(lease, failure) {
      return await scalar(`SELECT public.rl_fail_analysis($1,$2,$3,$4,$5,$6) AS value`, [...leaseArgs(lease), analysisErrorCodeSchema.parse(failure.code), failure.retryable, failure.retryAfterSeconds ?? 15]) === true
    },
    async recoverExpiredJobs() { return Number(await scalar(`SELECT public.rl_recover_jobs() AS value`, [])) },
  }
}
