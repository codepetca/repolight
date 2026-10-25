import { sql } from 'drizzle-orm'
import { boolean, check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { users } from './schema'
import type { PublicRepositoryBundle, PublicRepositoryRequest } from '@/lib/report/bundle-contract'
import type { ClientBinding } from '@/lib/service/contract'
import type { ApiKeyScope, PinnedSnapshot } from '@/lib/service/store-types'

const time = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' })
export const serviceWorkspaces = pgTable('rl_workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerUserId: uuid('owner_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  customerRef: text('customer_ref').notNull(),
  admissionDay: text('admission_day').notNull().default(''),
  admissionCount: integer('admission_count').notNull().default(0),
  createdAt: time('created_at').notNull().defaultNow(),
}, table => [uniqueIndex('rl_workspace_owner_unique').on(table.ownerUserId), uniqueIndex('rl_workspace_customer_unique').on(table.customerRef), check('rl_workspace_admission_nonnegative', sql`${table.admissionCount} >= 0`)]).enableRLS()

export const serviceApiKeys = pgTable('rl_api_keys', {
  id: uuid('id').primaryKey(), workspaceId: uuid('workspace_id').notNull().references(() => serviceWorkspaces.id, { onDelete: 'cascade' }),
  label: text('label').notNull(), secretHash: text('secret_hash').notNull(), scopes: jsonb('scopes').$type<ApiKeyScope[]>().notNull(),
  installationRef: text('installation_ref'), expiresAt: time('expires_at'), revokedAt: time('revoked_at'), createdAt: time('created_at').notNull().defaultNow(),
}, table => [unique('rl_key_workspace_identity').on(table.workspaceId, table.id), index('rl_key_workspace').on(table.workspaceId),
  check('rl_key_hash', sql`${table.secretHash} ~ '^[a-f0-9]{64}$'`), check('rl_key_label', sql`char_length(${table.label}) between 1 and 100`),
  check('rl_key_scopes', sql`jsonb_typeof(${table.scopes}) = 'array' and jsonb_array_length(${table.scopes}) between 1 and 3 and ${table.scopes} <@ '["analyses:create","analyses:read","analyses:erase"]'::jsonb`),
  check('rl_key_installation', sql`${table.installationRef} is null or ${table.installationRef} ~ '^[A-Za-z0-9._~-]{1,128}$'`)]).enableRLS()

export const serviceAnalysisJobs = pgTable('rl_analysis_jobs', {
  id: uuid('id').primaryKey().defaultRandom(), workspaceId: uuid('workspace_id').notNull().references(() => serviceWorkspaces.id, { onDelete: 'cascade' }),
  createdByKeyId: uuid('created_by_key_id'), idempotencyKey: text('idempotency_key').notNull(), requestJson: jsonb('request_json').$type<PublicRepositoryRequest>().notNull(),
  requestFingerprint: text('request_fingerprint').notNull(), clientBinding: jsonb('client_binding').$type<ClientBinding>(),
  status: text('status').notNull().default('queued'), attemptCount: integer('attempt_count').notNull().default(0), maxAttempts: integer('max_attempts').notNull().default(3),
  nextAttemptAt: time('next_attempt_at'), leaseToken: uuid('lease_token'), leaseGeneration: integer('lease_generation').notNull().default(0), leaseExpiresAt: time('lease_expires_at'), workerId: text('worker_id'),
  snapshotJson: jsonb('snapshot_json').$type<PinnedSnapshot>(), reportRef: uuid('report_ref'), errorCode: text('error_code'), errorRetryable: boolean('error_retryable').notNull().default(false),
  createdAt: time('created_at').notNull().defaultNow(), completedAt: time('completed_at'), deadlineAt: time('deadline_at').notNull(),
}, table => [uniqueIndex('rl_job_idempotency_unique').on(table.workspaceId, table.idempotencyKey), unique('rl_job_workspace_identity').on(table.workspaceId, table.id), index('rl_job_claim').on(table.status, table.nextAttemptAt, table.createdAt),
  foreignKey({ name: 'rl_job_workspace_key', columns: [table.workspaceId, table.createdByKeyId], foreignColumns: [serviceApiKeys.workspaceId, serviceApiKeys.id] }),
  check('rl_job_state', sql`${table.status} in ('queued','running','succeeded','failed')`), check('rl_job_attempts', sql`${table.maxAttempts} between 1 and 3 and ${table.attemptCount} between 0 and ${table.maxAttempts} and ${table.leaseGeneration} >= 0`),
  check('rl_job_idempotency', sql`char_length(${table.idempotencyKey}) between 1 and 128`), check('rl_job_fingerprint', sql`${table.requestFingerprint} ~ '^[a-f0-9]{64}$'`),
  check('rl_job_request_size', sql`jsonb_typeof(${table.requestJson}) = 'object' and octet_length(${table.requestJson}::text) <= 65536`),
  check('rl_job_binding_size', sql`${table.clientBinding} is null or (jsonb_typeof(${table.clientBinding}) = 'object' and octet_length(${table.clientBinding}::text) <= 2048)`),
  check('rl_job_error_code', sql`${table.errorCode} is null or ${table.errorCode} in ('repository_unavailable','private_repository','upstream_rate_limited','upstream_timeout','upstream_unavailable','collection_limit','invalid_evidence','result_too_large','internal_failure','credential_revoked','job_expired','attempts_exhausted')`),
  check('rl_job_lease_state', sql`(${table.status} = 'running') = (${table.leaseToken} is not null and ${table.leaseExpiresAt} is not null and ${table.workerId} is not null)`),
  check('rl_job_terminal_state', sql`(${table.status} in ('succeeded','failed')) = (${table.completedAt} is not null)`),
  check('rl_job_result_state', sql`(${table.status} = 'succeeded') = (${table.reportRef} is not null)`),
]).enableRLS()

export const serviceReports = pgTable('rl_reports', {
  id: uuid('id').primaryKey(), workspaceId: uuid('workspace_id').notNull(), jobId: uuid('job_id').notNull(),
  bundleJson: jsonb('bundle_json').$type<PublicRepositoryBundle>().notNull(), reportDigest: text('report_digest').notNull(),
  createdAt: time('created_at').notNull().defaultNow(),
}, table => [uniqueIndex('rl_report_job_unique').on(table.jobId), unique('rl_report_workspace_identity').on(table.workspaceId, table.id),
  foreignKey({ name: 'rl_report_workspace_job', columns: [table.workspaceId, table.jobId], foreignColumns: [serviceAnalysisJobs.workspaceId, serviceAnalysisJobs.id] }).onDelete('cascade'),
  check('rl_report_digest', sql`${table.reportDigest} ~ '^[a-f0-9]{64}$'`), check('rl_report_bundle_size', sql`jsonb_typeof(${table.bundleJson}) = 'object' and octet_length(${table.bundleJson}::text) <= 8388608`),
]).enableRLS()
export const serviceFeedbackEdits = pgTable('rl_feedback_edits', {
  id: uuid('id').primaryKey().defaultRandom(), workspaceId: uuid('workspace_id').notNull(), reportRef: uuid('report_ref').notNull(), scopeKey: text('scope_key').notNull(),
  text: text('text'), revision: integer('revision').notNull().default(1), actorUserId: uuid('actor_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }), updatedAt: time('updated_at').notNull().defaultNow(),
}, table => [uniqueIndex('rl_edit_scope_unique').on(table.reportRef, table.scopeKey),
  foreignKey({ name: 'rl_edit_workspace_report', columns: [table.workspaceId, table.reportRef], foreignColumns: [serviceReports.workspaceId, serviceReports.id] }).onDelete('cascade'),
  check('rl_edit_revision', sql`${table.revision} > 0`), check('rl_edit_text', sql`${table.text} is null or char_length(${table.text}) <= 20000`), check('rl_edit_scope', sql`char_length(${table.scopeKey}) between 1 and 160`),
]).enableRLS()

/** Minimal permanent suppression record; no repository, report, identity or feedback payload. */
export const serviceSubjectErasures = pgTable('rl_subject_erasures', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => serviceWorkspaces.id, { onDelete: 'cascade' }),
  operationRef: uuid('operation_ref').notNull(), installationRef: text('installation_ref').notNull(), subjectRef: text('subject_ref').notNull(),
  createdAt: time('created_at').notNull().defaultNow(),
}, table => [uniqueIndex('rl_erasure_operation_unique').on(table.workspaceId, table.operationRef), uniqueIndex('rl_erasure_subject_unique').on(table.workspaceId, table.installationRef, table.subjectRef),
  check('rl_erasure_installation', sql`${table.installationRef} ~ '^[A-Za-z0-9._~-]{1,128}$'`), check('rl_erasure_subject', sql`${table.subjectRef} ~ '^[A-Za-z0-9._~-]{1,128}$'`),
]).enableRLS()
