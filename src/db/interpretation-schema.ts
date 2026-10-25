import { sql } from 'drizzle-orm'
import { check, foreignKey, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { serviceWorkspaces, serviceAnalysisJobs } from './service-schema'
const time = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' })
export const interpretations = pgTable('rl_interpretations', {
  id: uuid('id').primaryKey().defaultRandom(), workspaceId: uuid('workspace_id').notNull().references(() => serviceWorkspaces.id, { onDelete: 'cascade' }), jobId: uuid('job_id').notNull(), requestId: uuid('request_id').notNull(), admissionId: uuid('admission_id').notNull(), scopeKey: text('scope_key').notNull(),
  model: text('model').notNull(), reportDigest: text('report_digest').notNull(), inputDigest: text('input_digest').notNull(), inputJson: jsonb('input_json').notNull(), citationsJson: jsonb('citations_json').notNull(),
  state: text('state').notNull().default('generating'), leaseToken: uuid('lease_token').notNull().defaultRandom(), leaseExpiresAt: time('lease_expires_at').notNull(), sidecarJson: jsonb('sidecar_json'), errorCode: text('error_code'), createdAt: time('created_at').notNull().defaultNow(), completedAt: time('completed_at'),
}, table => [uniqueIndex('rl_interpretation_request_unique').on(table.workspaceId, table.requestId), index('rl_interpretation_latest').on(table.workspaceId, table.jobId, table.scopeKey, table.createdAt),
  foreignKey({ name: 'rl_interpretation_workspace_job', columns: [table.workspaceId, table.jobId], foreignColumns: [serviceAnalysisJobs.workspaceId, serviceAnalysisJobs.id] }).onDelete('cascade'),
  check('rl_interpretation_state', sql`${table.state} in ('generating','available','failed')`), check('rl_interpretation_input_size', sql`octet_length(${table.inputJson}::text)<=16384 and octet_length(${table.citationsJson}::text)<=16384`), check('rl_interpretation_output_size', sql`${table.sidecarJson} is null or octet_length(${table.sidecarJson}::text)<=32768`),
]).enableRLS()
// Quota receipts contain no subject/job/report binding and survive subject erasure for 24h.
export const interpretationAdmissions = pgTable('rl_interpretation_admissions', { id: uuid('id').primaryKey().defaultRandom(), workspaceId: uuid('workspace_id').references(() => serviceWorkspaces.id, { onDelete: 'set null' }), createdAt: time('created_at').notNull().defaultNow(), activeUntil: time('active_until').notNull().defaultNow() }, table => [index('rl_interpretation_admission_window').on(table.createdAt), index('rl_interpretation_workspace_window').on(table.workspaceId, table.createdAt)]).enableRLS()
