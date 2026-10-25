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
  externalSystem: text('external_system'),
  externalRunKey: text('external_run_key'),
  externalAssignmentId: text('external_assignment_id'),
  externalClassroomId: text('external_classroom_id'),
  externalMetadataJson: jsonb('external_metadata_json').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
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
}, (table) => ({
  uniqExternalRun: uniqueIndex('uniq_analysis_run_external_key').on(table.userId, table.externalSystem, table.externalRunKey),
}))

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

export const classrooms = pgTable('classrooms', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  term: text('term'),
  githubOrg: text('github_org'),
  defaultRepoPrefix: text('default_repo_prefix'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
})

export const classroomStudents = pgTable('classroom_students', {
  id: uuid('id').primaryKey().defaultRandom(),
  classroomId: uuid('classroom_id').notNull().references(() => classrooms.id, { onDelete: 'cascade' }),
  externalStudentId: text('external_student_id'),
  name: text('name').notNull(),
  email: text('email'),
  githubLogin: text('github_login'),
  commitEmails: jsonb('commit_emails').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  groupName: text('group_name'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
}, (table) => ({
  uniqExternalStudent: uniqueIndex('uniq_classroom_student_external').on(table.classroomId, table.externalStudentId),
  uniqGithubLogin: uniqueIndex('uniq_classroom_student_github').on(table.classroomId, table.githubLogin),
}))

export const classroomAssignments = pgTable('classroom_assignments', {
  id: uuid('id').primaryKey().defaultRandom(),
  classroomId: uuid('classroom_id').notNull().references(() => classrooms.id, { onDelete: 'cascade' }),
  analysisRunId: uuid('analysis_run_id').references(() => analysisRuns.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  status: text('status').notNull().default('draft'),
  templateRepoUrl: text('template_repo_url'),
  repoPrefix: text('repo_prefix'),
  repoVisibility: text('repo_visibility').notNull().default('private'),
  startAt: timestamp('start_at', { withTimezone: true, mode: 'string' }).notNull(),
  dueAt: timestamp('due_at', { withTimezone: true, mode: 'string' }).notNull(),
  timezone: text('timezone').notNull().default('America/Toronto'),
  rubricJson: jsonb('rubric_json').$type<RubricConfig>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
})

export const classroomRepositories = pgTable('classroom_repositories', {
  id: uuid('id').primaryKey().defaultRandom(),
  assignmentId: uuid('assignment_id').notNull().references(() => classroomAssignments.id, { onDelete: 'cascade' }),
  studentId: uuid('student_id').notNull().references(() => classroomStudents.id, { onDelete: 'cascade' }),
  repositoryKey: text('repository_key').notNull(),
  repoUrl: text('repo_url').notNull(),
  owner: text('owner').notNull(),
  name: text('name').notNull(),
  branch: text('branch').notNull().default('main'),
  invitationStatus: text('invitation_status').notNull().default('manual'),
  activityStatus: text('activity_status').notNull().default('not_started'),
  successfulPushCount: integer('successful_push_count').notNull().default(0),
  firstPushAt: timestamp('first_push_at', { withTimezone: true, mode: 'string' }),
  lastPushAt: timestamp('last_push_at', { withTimezone: true, mode: 'string' }),
  lastWebhookAt: timestamp('last_webhook_at', { withTimezone: true, mode: 'string' }),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
}, (table) => ({
  uniqAssignmentStudent: uniqueIndex('uniq_classroom_repository_student').on(table.assignmentId, table.studentId),
  uniqAssignmentRepository: uniqueIndex('uniq_classroom_repository_key').on(table.assignmentId, table.repositoryKey),
}))

export const classroomActivityEvents = pgTable('classroom_activity_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  assignmentId: uuid('assignment_id').notNull().references(() => classroomAssignments.id, { onDelete: 'cascade' }),
  repositoryId: uuid('repository_id').references(() => classroomRepositories.id, { onDelete: 'cascade' }),
  studentId: uuid('student_id').references(() => classroomStudents.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(),
  externalId: text('external_id'),
  payloadJson: jsonb('payload_json').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'string' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
}, (table) => ({
  uniqClassroomActivityEvent: uniqueIndex('uniq_classroom_activity_event').on(table.assignmentId, table.eventType, table.externalId),
}))

export type User = typeof users.$inferSelect
export type AnalysisRun = typeof analysisRuns.$inferSelect
export type RunContributor = typeof runContributors.$inferSelect
export type RunRepository = typeof runRepositories.$inferSelect
export type ContributorResult = typeof contributorResults.$inferSelect
export type Classroom = typeof classrooms.$inferSelect
export type ClassroomStudent = typeof classroomStudents.$inferSelect
export type ClassroomAssignment = typeof classroomAssignments.$inferSelect
export type ClassroomRepository = typeof classroomRepositories.$inferSelect
export * from './service-schema'

export * from "./interpretation-schema"
