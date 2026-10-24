import { z } from 'zod'
import { calculateScopeFacts } from '@/lib/report/calculations'
import { reportBuildInputSchema, repositoryReportSchema, validateReportEvidence, type RepositoryReport } from '@/lib/report/contract'
import { validatePublicSettings, type PublicReportRequest, type RuleFeedback } from '@/lib/report/public'

export type ReportContext = Pick<RepositoryReport, 'metricsVersion' | 'repository' | 'snapshot' | 'period' | 'scheduledProjectDates' | 'baseline' | 'exclusions'>
export type ScopeMetrics = Omit<RepositoryReport['metrics'], 'studentCommits'> & { commits: RepositoryReport['metrics']['studentCommits'] }
export type ScopeFacts = Pick<RepositoryReport, 'coverage' | 'activity' | 'commits' | 'timeline' | 'heatmap' | 'pushActivity' | 'interpretation'> & { metrics: ScopeMetrics }
export type ContributorDescriptor = { id: string; kind: 'github_account' | 'unlinked_email' | 'unknown_author'; githubLogin: string | null; label: string; accountType: 'user' | 'bot' | 'unknown' }
export type ScopeRuleFeedback = Omit<RuleFeedback, 'rulesVersion'> & { rulesVersion: '1.1.0' }
export type ScopeAnalysis = { scope: { kind: 'repository' } | { kind: 'contributor'; contributorId: string }; facts: ScopeFacts; ruleFeedback: ScopeRuleFeedback }
export interface PublicRepositoryBundle {
  schemaVersion: '1.0'; bundleRef: string; context: ReportContext; collectionCoverage: RepositoryReport['coverage'];
  selection: { requestedGithubLogin: string | null; status: 'not_requested' | 'matched' | 'not_found' | 'invalid'; contributorId: string | null; notice: string | null };
  overview: ScopeAnalysis;
  contributors: Array<{ contributor: ContributorDescriptor; analysis: ScopeAnalysis }>;
}
export type PublicRepositoryRequest = Omit<PublicReportRequest, 'githubLogins' | 'commitEmails'> & { githubUsername?: string }

export const publicRepositoryRequestSchema = reportBuildInputSchema.pick({ repositoryUrl: true, period: true, scheduledProjectDates: true, exclusions: true }).extend({
  branch: z.string().trim().min(1).max(200).optional(),
  githubUsername: z.string().max(200).optional(),
  baselineReviewed: z.boolean().default(false),
}).strict().superRefine(validatePublicSettings)

const original = repositoryReportSchema.shape
const contextSchema = z.object({ metricsVersion: original.metricsVersion, repository: original.repository, snapshot: original.snapshot, period: original.period, scheduledProjectDates: original.scheduledProjectDates, baseline: original.baseline, exclusions: original.exclusions }).strict()
const factsSchema = z.object({
  coverage: original.coverage, activity: original.activity, commits: original.commits, timeline: original.timeline,
  heatmap: original.heatmap, pushActivity: original.pushActivity, interpretation: original.interpretation,
  metrics: z.object({ commits: original.metrics.shape.studentCommits, commitDensity: original.metrics.shape.commitDensity, scheduledDayCoverage: original.metrics.shape.scheduledDayCoverage, busiestDayShare: original.metrics.shape.busiestDayShare }).strict(),
}).strict()
const text = z.string().min(1)
const ruleFeedbackSchema = z.object({
  rulesVersion: z.literal('1.1.0'),
  observations: z.array(z.object({ id: text, ruleId: text, kind: z.enum(['strength', 'improvement', 'review_question', 'limitation']), text,
    evidence: z.array(z.object({ commitSha: z.string().regex(/^[a-f0-9]{40}$/), path: text.nullable() }).strict()).max(5),
  }).strict().refine(observation => observation.kind === 'limitation' || observation.evidence.length > 0, 'Rule observations need evidence.')),
  summary: z.object({ activeDays: z.number().int().nonnegative(), genericMessageCount: z.number().int().nonnegative(), messageCount: z.number().int().nonnegative(), longestScheduledGap: z.number().int().nonnegative().nullable() }).strict(),
  feedbackDraft: z.string(),
}).strict()
const analysisSchema = z.object({ scope: z.discriminatedUnion('kind', [z.object({ kind: z.literal('repository') }).strict(), z.object({ kind: z.literal('contributor'), contributorId: text }).strict()]), facts: factsSchema, ruleFeedback: ruleFeedbackSchema }).strict()
export const publicRepositoryBundleSchema = z.object({
  schemaVersion: z.literal('1.0'), bundleRef: text, context: contextSchema, collectionCoverage: original.coverage,
  selection: z.object({ requestedGithubLogin: z.string().nullable(), status: z.enum(['not_requested', 'matched', 'not_found', 'invalid']), contributorId: text.nullable(), notice: text.nullable() }).strict(),
  overview: analysisSchema,
  contributors: z.array(z.object({ contributor: z.object({ id: text, kind: z.enum(['github_account', 'unlinked_email', 'unknown_author']), githubLogin: text.nullable(), label: text, accountType: z.enum(['user', 'bot', 'unknown']) }).strict(), analysis: analysisSchema }).strict()),
}).strict().superRefine((bundle, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: 'custom', message })
  if (bundle.overview.scope.kind !== 'repository') fail('Overview must have repository scope.')
  const ids = new Set<string>(), partition = new Set<string>()
  for (const entry of bundle.contributors) {
    if (ids.has(entry.contributor.id)) fail('Duplicate contributor ID.')
    ids.add(entry.contributor.id)
    if (entry.analysis.scope.kind !== 'contributor' || entry.analysis.scope.contributorId !== entry.contributor.id) fail('Contributor scope does not match its descriptor.')
    if ((entry.contributor.kind === 'github_account') !== (entry.contributor.githubLogin !== null)) fail('Only linked accounts have GitHub logins.')
    for (const commit of entry.analysis.facts.commits) {
      if (partition.has(commit.sha)) fail('A commit belongs to multiple contributor scopes.')
      partition.add(commit.sha)
    }
  }
  const overviewCommits = new Map(bundle.overview.facts.commits.map(commit => [commit.sha, commit]))
  for (const entry of bundle.contributors) for (const commit of entry.analysis.facts.commits) {
    if (JSON.stringify(overviewCommits.get(commit.sha)) !== JSON.stringify(commit)) fail('Contributor commit evidence differs from the overview.')
    if (entry.contributor.kind === 'github_account' ? commit.githubLogin !== entry.contributor.githubLogin : commit.githubLogin !== null) fail('Commit account does not match its contributor scope.')
  }
  const overview = new Set(bundle.overview.facts.commits.map(commit => commit.sha))
  if (partition.size !== overview.size || [...partition].some(sha => !overview.has(sha))) fail('Contributor commits must partition the overview.')
  if (bundle.selection.status === 'not_requested' ? bundle.selection.requestedGithubLogin !== null : bundle.selection.requestedGithubLogin === null) fail('Selection request and status disagree.')
  if (bundle.selection.status === 'matched' && bundle.contributors.find(entry => entry.contributor.id === bundle.selection.contributorId)?.contributor.githubLogin !== bundle.selection.requestedGithubLogin) fail('Selected contributor does not match the requested login.')
  if (bundle.selection.status !== 'matched' && !bundle.selection.notice) fail('Fallback selections need an explicit notice.')
  if (bundle.selection.status === 'matched' ? !bundle.selection.contributorId || !ids.has(bundle.selection.contributorId) : bundle.selection.contributorId !== null) fail('Selection does not resolve to a contributor.')
  for (const analysis of [bundle.overview, ...bundle.contributors.map(entry => entry.analysis)]) {
    validateReportEvidence({ ...bundle.context, ...analysis.facts }, ctx)
    for (const commit of analysis.facts.commits) {
      if (new Set(commit.files.map(file => file.path)).size !== commit.files.length) fail('Duplicate file evidence in a scope commit.')
      if ((commit.additions === null) !== (commit.deletions === null)) fail('Missing file totals must be consistently unavailable.')
      if (commit.additions !== null && (commit.additions !== commit.files.reduce((sum, file) => sum + file.additions, 0) || commit.deletions !== commit.files.reduce((sum, file) => sum + file.deletions, 0))) fail('Commit totals do not agree with observed file evidence.')
      if (commit.authoredAt && (Date.parse(commit.authoredAt) < Date.parse(bundle.context.period.startAt) || Date.parse(commit.authoredAt) >= Date.parse(bundle.context.period.endAt))) fail('Dated scope evidence is outside its period.')
    }
    const expected = calculateScopeFacts({ ...bundle.context, repositoryUrl: bundle.context.repository.url, branch: bundle.context.repository.branch, coverage: bundle.collectionCoverage, events: [] }, analysis.facts.commits)
    for (const key of ['metrics', 'activity', 'timeline', 'heatmap', 'coverage', 'pushActivity', 'interpretation'] as const) {
      if (!equivalent(expected[key], analysis.facts[key])) fail(`Scope ${key} does not agree with its commit evidence and collection context.`)
    }
    const evidence = new Map(analysis.facts.commits.map(commit => [commit.sha, commit]))
    const observationIds = new Set<string>()
    for (const observation of analysis.ruleFeedback.observations) {
      if (observationIds.has(observation.id)) fail('Duplicate rule observation ID.')
      observationIds.add(observation.id)
      for (const ref of observation.evidence) if (!evidence.has(ref.commitSha) || (ref.path !== null && !evidence.get(ref.commitSha)!.files.some(file => file.path === ref.path))) fail('Rule reference is outside its scope.')
    }
  }
})

function equivalent(left: unknown, right: unknown): boolean {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value !== null && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)])) : value
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
}
