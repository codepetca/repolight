import { sql } from 'drizzle-orm'
import {
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import type {
  AnalysisEvent,
  ContributorGrade,
  ContributorMetrics,
  RubricConfig,
  RunWarning,
} from '@/lib/engine/types'

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
})

export const analysisRuns = pgTable('analysis_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  status: text('status').notNull().default('queued'),
  startAt: timestamp('start_at', { withTimezone: true, mode: 'string' }).notNull(),
  endAt: timestamp('end_at', { withTimezone: true, mode: 'string' }).notNull(),
  timezone: text('timezone').notNull().default('America/Toronto'),
  rubricJson: jsonb('rubric_json').$type<RubricConfig>().notNull().default(sql`'{}'::jsonb`),
  warningsJson: jsonb('warnings_json').$type<RunWarning[]>().notNull().default(sql`'[]'::jsonb`),
  totalRepositories: integer('total_repositories').notNull().default(0),
  processedRepositories: integer('processed_repositories').notNull().default(0),
  failedRepositories: integer('failed_repositories').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true, mode: 'string' }),
})

export const runContributors = pgTable('run_contributors', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id').notNull().references(() => analysisRuns.id, { onDelete: 'cascade' }),
  contributorId: text('contributor_id').notNull(),
  name: text('name').notNull(),
  githubLogin: text('github_login'),
  commitEmails: jsonb('commit_emails').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  repositoryKeys: jsonb('repository_keys').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  groupName: text('group_name'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
}, (table) => ({
  uniqContributor: uniqueIndex('uniq_run_contributor').on(table.runId, table.contributorId),
}))

export const runRepositories = pgTable('run_repositories', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id').notNull().references(() => analysisRuns.id, { onDelete: 'cascade' }),
  repositoryKey: text('repository_key').notNull(),
  repoUrl: text('repo_url').notNull(),
  owner: text('owner').notNull(),
  name: text('name').notNull(),
  branch: text('branch').notNull().default('main'),
  status: text('status').notNull().default('queued'),
  warningsJson: jsonb('warnings_json').$type<RunWarning[]>().notNull().default(sql`'[]'::jsonb`),
  lastError: text('last_error'),
  processedAt: timestamp('processed_at', { withTimezone: true, mode: 'string' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
}, (table) => ({
  uniqRepository: uniqueIndex('uniq_run_repository').on(table.runId, table.repositoryKey),
}))

export const analysisEvents = pgTable('analysis_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id').notNull().references(() => analysisRuns.id, { onDelete: 'cascade' }),
  repositoryId: uuid('repository_id').notNull().references(() => runRepositories.id, { onDelete: 'cascade' }),
  repositoryKey: text('repository_key').notNull(),
  eventType: text('event_type').notNull(),
  externalId: text('external_id').notNull(),
  payloadJson: jsonb('payload_json').$type<AnalysisEvent>().notNull(),
  authoredAt: timestamp('authored_at', { withTimezone: true, mode: 'string' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
}, (table) => ({
  uniqEvent: uniqueIndex('uniq_run_event').on(table.runId, table.repositoryKey, table.eventType, table.externalId),
}))

export const contributorResults = pgTable('contributor_results', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id').notNull().references(() => analysisRuns.id, { onDelete: 'cascade' }),
  contributorId: text('contributor_id').notNull(),
  metricsJson: jsonb('metrics_json').$type<ContributorMetrics>().notNull(),
  gradeJson: jsonb('grade_json').$type<ContributorGrade>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
}, (table) => ({
  uniqResult: uniqueIndex('uniq_contributor_result').on(table.runId, table.contributorId),
}))

export type User = typeof users.$inferSelect
export type AnalysisRun = typeof analysisRuns.$inferSelect
export type RunContributor = typeof runContributors.$inferSelect
export type RunRepository = typeof runRepositories.$inferSelect
export type ContributorResult = typeof contributorResults.$inferSelect
