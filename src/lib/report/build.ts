import { normalizeCommitEmails, normalizeGitHubLogin } from '@/lib/engine/repo'
import { METRICS_VERSION, REPORT_VERSION, reportBuildInputSchema, repositoryReportSchema, type RepositoryReport } from '@/lib/report/contract'
import { makeRepositoryTarget } from '@/lib/engine/repo'
import { calculateScopeFacts, prepareReportCommits } from '@/lib/report/calculations'

/** Legacy v2 student report adapter; explicit matching and output contract are preserved. */
export function buildRepositoryReport(rawInput: unknown): RepositoryReport {
  const input = reportBuildInputSchema.parse(rawInput)
  const target = makeRepositoryTarget(input.repositoryUrl, input.branch)!
  const logins = new Set(input.identity.githubLogins.map(normalizeGitHubLogin).filter((login): login is string => login !== null))
  const emails = new Set(normalizeCommitEmails(input.identity.commitEmails))
  const attributionConfigured = logins.size > 0 || emails.size > 0
  const prepared = prepareReportCommits(input, event => {
    const login = normalizeGitHubLogin(event.githubLogin)
    return Boolean(attributionConfigured && ((login !== null && logins.has(login)) || (event.authorEmail && emails.has(event.authorEmail.trim().toLowerCase()))))
  })
  const facts = calculateScopeFacts(input, prepared.commits, attributionConfigured, 'legacy')
  const { commits, ...metrics } = facts.metrics
  return repositoryReportSchema.parse({
    schemaVersion: REPORT_VERSION, metricsVersion: METRICS_VERSION, reportRef: input.reportRef, studentRef: input.studentRef,
    repository: { url: target.repoUrl, branch: input.branch, visibility: 'public' }, snapshot: input.snapshot,
    period: input.period, scheduledProjectDates: input.scheduledProjectDates === null ? null : [...new Set(input.scheduledProjectDates)].sort(), baseline: input.baseline, exclusions: input.exclusions,
    ...facts, attribution: { status: attributionConfigured ? 'matched' : 'not_configured', unmatchedCommitCount: prepared.unmatchedCommitCount },
    metrics: { ...metrics, studentCommits: commits },
  })
}
