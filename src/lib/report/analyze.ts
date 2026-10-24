import { GitHubClient, getGitHubToken } from '@/lib/engine/github'
import { makeRepositoryTarget } from '@/lib/engine/repo'
import { buildRepositoryReport } from '@/lib/report/build'
import { publicReportRequestSchema, type PublicAnalysisResult } from '@/lib/report/public'
import { buildRuleFeedback } from '@/lib/report/rules'

export async function analyzePublicRepository(raw: unknown, client = new GitHubClient({ token: getGitHubToken() })): Promise<PublicAnalysisResult> {
  const input = publicReportRequestSchema.parse(raw)
  const target = makeRepositoryTarget(input.repositoryUrl, input.branch)!
  // An omitted branch must resolve GitHub's default branch, rather than assuming main.
  if (!input.branch) target.branch = ''
  const evidence = await client.collectPublicReportEvidence(target)
  const report = buildRepositoryReport({
    reportRef: `public-${evidence.snapshot.sha.slice(0, 12)}-${Date.now()}`,
    studentRef: 'configured-student', repositoryUrl: evidence.target.repoUrl, branch: evidence.target.branch,
    snapshot: evidence.snapshot, period: input.period, scheduledProjectDates: input.scheduledProjectDates,
    identity: { githubLogins: input.githubLogins, commitEmails: input.commitEmails },
    baseline: input.baselineReviewed ? { status: 'applied', reference: 'teacher-reviewed-exclusions' } : { status: 'not_supplied', reference: null },
    exclusions: input.exclusions, coverage: evidence.coverage, events: evidence.events,
  })
  return { report, ruleFeedback: buildRuleFeedback(report) }
}
