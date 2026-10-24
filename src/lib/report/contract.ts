import { z } from 'zod'
import { round } from '@/lib/engine/time'

export const REPORT_VERSION = '2.0' as const
export const METRICS_VERSION = '2.0.0' as const
const text = z.string().trim().min(1)
const sha = z.string().regex(/^[a-f0-9]{40}$/, 'Expected a full lowercase Git commit SHA.')
const instant = z.string().datetime({ offset: true })
const count = z.number().int().nonnegative()
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T12:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}, 'Invalid project date.')
const timezone = text.refine(value => {
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true } catch { return false }
}, 'Invalid timezone.')
const periodSchema = z.object({ startAt: instant, endAt: instant, timezone }).strict()
  .refine(value => Date.parse(value.startAt) < Date.parse(value.endAt), 'Period must have startAt before endAt.')
const repositoryUrl = z.string().regex(/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 'Use a plain HTTPS GitHub repository URL without credentials, query or fragment.')
const fileSchema = z.object({ filename: text, status: text, additions: count, deletions: count }).strict()
const eventSchema = z.object({
  type: z.enum(['commit', 'pull_request', 'review']), externalId: text, repositoryKey: text, title: z.string(),
  authoredAt: instant.nullish(), url: z.string().optional(), githubLogin: z.string().nullish(), authorEmail: z.string().nullish(),
  summary: z.string().optional(), category: z.enum(['feature', 'bugfix', 'test', 'refactor', 'docs', 'styling', 'config', 'generated']).optional(),
  files: z.array(fileSchema).optional(), additions: count.optional(), deletions: count.optional(), areas: z.array(z.string()).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.type === 'commit' && !sha.safeParse(value.externalId).success) ctx.addIssue({ code: 'custom', message: 'Commit evidence requires a full SHA.', path: ['externalId'] })
})
export const collectionStatusSchema = z.enum(['complete', 'partial', 'unavailable'])
export const reportBuildInputSchema = z.object({
  reportRef: text.max(128), studentRef: text.max(128), repositoryUrl, branch: text,
  snapshot: z.object({ sha, capturedAt: instant, kind: z.enum(['analysis_time', 'submission_time']) }).strict(),
  period: periodSchema, scheduledProjectDates: z.array(date).nullable(),
  identity: z.object({ githubLogins: z.array(text), commitEmails: z.array(text) }).strict(),
  baseline: z.object({ status: z.enum(['not_supplied', 'applied', 'unavailable']), reference: text.nullable() }).strict()
    .refine(value => value.status !== 'applied' || value.reference !== null, 'An applied baseline needs a reference.'),
  coverage: z.object({ history: collectionStatusSchema, files: collectionStatusSchema, notes: z.array(text) }).strict(),
  exclusions: z.object({ commitShas: z.array(sha), pathPrefixes: z.array(text), botLogins: z.array(text) }).strict(),
  events: z.array(eventSchema),
}).strict()

export type ReportBuildInput = z.infer<typeof reportBuildInputSchema>
export type MetricStatus = 'available' | 'partial' | 'unavailable'
const metricSchema = z.object({
  status: z.enum(['available', 'partial', 'unavailable']), value: z.number().finite().nonnegative().nullable(),
  numerator: count.nullable(), denominator: count.nullable(), reason: text.nullable(),
}).strict().superRefine((value, ctx) => {
  if ((value.status === 'unavailable') !== (value.value === null)) ctx.addIssue({ code: 'custom', message: 'Unavailable metrics must have null values; measured metrics need a value.' })
  if (value.status !== 'available' && value.reason === null) ctx.addIssue({ code: 'custom', message: 'Incomplete metrics need an explanation.' })
})
const countMetricSchema = metricSchema.superRefine((metric, ctx) => {
  if (metric.value !== null && (!Number.isSafeInteger(metric.value) || metric.value !== metric.numerator || metric.denominator !== null)) {
    ctx.addIssue({ code: 'custom', message: 'Commit counts must be whole counts matching their numerator, without a denominator.' })
  }
})
const fractionMetricSchema = metricSchema.superRefine((metric, ctx) => {
  if (metric.value === null) return
  if (metric.numerator === null || metric.denominator === null || metric.denominator <= 0 || round(metric.numerator / metric.denominator) !== metric.value) {
    ctx.addIssue({ code: 'custom', message: 'Measured fractions require a positive denominator and a consistent rounded numerator/denominator value.' })
  }
})
const shareMetricSchema = fractionMetricSchema.superRefine((metric, ctx) => {
  if (metric.value !== null && (metric.value > 1 || metric.numerator! > metric.denominator!)) {
    ctx.addIssue({ code: 'custom', message: 'Shares must be between zero and one.' })
  }
})
const reportFileSchema = z.object({ path: text, status: text, additions: count, deletions: count }).strict()
const reportCommitSchema = z.object({
  sha, message: z.string(), authoredAt: instant.nullable(), githubLogin: z.string().nullable(), url: repositoryUrl.or(z.string().regex(/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/commit\/[a-f0-9]{40}$/)),
  additions: count.nullable(), deletions: count.nullable(), files: z.array(reportFileSchema),
}).strict()
const observationSchema = z.object({
  id: text, kind: z.enum(['strength', 'improvement', 'review_question', 'limitation']), text: text.max(4000),
  evidence: z.array(z.object({ commitSha: sha, path: text.nullable() }).strict()),
}).strict().refine(value => value.kind === 'limitation' || value.evidence.length > 0, 'Observations need supporting evidence.')

export const repositoryReportSchema = z.object({
  schemaVersion: z.literal(REPORT_VERSION), metricsVersion: z.literal(METRICS_VERSION), reportRef: text, studentRef: text,
  repository: z.object({ url: repositoryUrl, branch: text, visibility: z.literal('public') }).strict(),
  snapshot: z.object({ sha, capturedAt: instant, kind: z.enum(['analysis_time', 'submission_time']) }).strict(),
  period: periodSchema, scheduledProjectDates: z.array(date).nullable(),
  exclusions: z.object({ commitShas: z.array(sha), pathPrefixes: z.array(text), botLogins: z.array(text) }).strict(),
  baseline: z.object({ status: z.enum(['not_supplied', 'applied', 'unavailable']), reference: text.nullable() }).strict(),
  coverage: z.object({ history: collectionStatusSchema, files: collectionStatusSchema, notes: z.array(text) }).strict(),
  attribution: z.object({ status: z.enum(['matched', 'not_configured']), unmatchedCommitCount: count }).strict(),
  metrics: z.object({ studentCommits: countMetricSchema, commitDensity: fractionMetricSchema, scheduledDayCoverage: shareMetricSchema, busiestDayShare: shareMetricSchema }).strict(),
  activity: z.object({ undatedCommitCount: count, outsideScheduleCommitCount: count.nullable() }).strict(),
  commits: z.array(reportCommitSchema),
  timeline: z.array(z.object({ date, commitShas: z.array(sha), commitCount: count }).strict()),
  heatmap: z.object({
    status: z.enum(['available', 'partial', 'unavailable']), files: z.array(text),
    cells: z.array(z.object({ commitSha: sha, path: text, additions: count, deletions: count }).strict()),
  }).strict(),
  pushActivity: z.object({ status: z.literal('unavailable'), reason: z.literal('push_events_not_collected') }).strict(),
  interpretation: z.object({
    status: z.enum(['not_requested', 'available', 'failed']),
    generator: z.object({ provider: text, model: text, promptVersion: text }).strict().nullable(),
    observations: z.array(observationSchema),
    feedbackDraft: z.object({ text: text.max(10000), observationIds: z.array(text).min(1) }).strict().nullable(),
  }).strict(),
}).strict().superRefine((report, ctx) => {
  const commits = new Map(report.commits.map(commit => [commit.sha, commit]))
  if (commits.size !== report.commits.length) ctx.addIssue({ code: 'custom', message: 'Duplicate commit evidence.' })
  for (const commit of report.commits) {
    if (commit.url !== `${report.repository.url}/commit/${commit.sha}`) ctx.addIssue({ code: 'custom', message: 'Commit URL does not match the repository evidence.' })
  }
  const observations = new Set<string>()
  for (const observation of report.interpretation.observations) {
    if (observations.has(observation.id)) ctx.addIssue({ code: 'custom', message: 'Duplicate observation ID.' })
    observations.add(observation.id)
    for (const evidence of observation.evidence) {
      const commit = commits.get(evidence.commitSha)
      if (!commit || (evidence.path !== null && !commit.files.some(file => file.path === evidence.path))) ctx.addIssue({ code: 'custom', message: 'Observation references evidence outside this report.' })
    }
  }
  for (const id of report.interpretation.feedbackDraft?.observationIds || []) {
    if (!observations.has(id)) ctx.addIssue({ code: 'custom', message: 'Feedback references an unknown observation.' })
  }
  if (report.interpretation.status !== 'available' && (report.interpretation.observations.length || report.interpretation.feedbackDraft)) ctx.addIssue({ code: 'custom', message: 'Only completed interpretation can contain feedback.' })
  if (report.interpretation.status === 'available' && report.interpretation.generator === null) ctx.addIssue({ code: 'custom', message: 'Interpretation requires generator provenance.' })
  for (const point of report.timeline) for (const commitSha of point.commitShas) {
    if (!commits.has(commitSha)) ctx.addIssue({ code: 'custom', message: 'Timeline references an unknown commit.' })
  }
  for (const cell of report.heatmap.cells) {
    if (!commits.get(cell.commitSha)?.files.some(file => file.path === cell.path)) ctx.addIssue({ code: 'custom', message: 'Heatmap references an unknown commit/file.' })
  }
})

export type RepositoryReport = z.infer<typeof repositoryReportSchema>
