import type { RepositoryReport } from '@/lib/report/contract'
import type { ReportContext, ScopeFacts, ScopeAnalysis, ScopeRuleFeedback } from '@/lib/report/bundle-contract'
import type { RuleFeedback, RuleObservation } from '@/lib/report/public'

export const RULE_THRESHOLDS = { genericMessageShare: 0.25, concentratedDayShare: 0.5, largeChangeLines: 200, largeChangeShare: 0.5, scheduledGap: 3 } as const
const genericMessage = /^(?:update(?:s| files?)?|fix(?:es| bugs?)?|changes?|work|wip|progress|done|final|polish|stuff|test|initial commit)[.!\s]*$/i

/** Transparent rules describe visible evidence, never effort, achievement or code authorship. */
type RuleFacts = Pick<RepositoryReport, 'commits' | 'coverage' | 'baseline' | 'activity' | 'timeline' | 'scheduledProjectDates' | 'heatmap'> & { metrics: Pick<RepositoryReport['metrics'], 'busiestDayShare'> }

export function buildRuleFeedback(report: RepositoryReport): RuleFeedback {
  return calculateRuleFeedback(report, report.attribution.status === 'matched')
}

export function buildScopeRuleFeedback(context: ReportContext, facts: ScopeFacts, scope: ScopeAnalysis['scope']): ScopeRuleFeedback {
  const feedback = calculateRuleFeedback({ ...context, ...facts }, true, scope.kind)
  return { ...feedback, rulesVersion: '1.1.0' }
}

function calculateRuleFeedback(report: RuleFacts, identityAvailable: boolean, scope: 'legacy' | 'repository' | 'contributor' = 'legacy'): RuleFeedback {
  const observations: RuleObservation[] = []
  const add = (ruleId: string, kind: RuleObservation['kind'], text: string, commits: typeof report.commits = []) => observations.push({ id: `rule-${ruleId}`, ruleId, kind, text, evidence: commits.slice(0, 5).map(commit => ({ commitSha: commit.sha, path: null })) })
  const n = report.commits.length
  const generic = report.commits.filter(commit => genericMessage.test(commit.message.trim()))
  const datedComplete = report.coverage.history === 'complete' && identityAvailable && report.activity.undatedCommitCount === 0
  const active = new Set(report.timeline.map(point => point.date))
  const schedule = report.scheduledProjectDates
  let longestScheduledGap: number | null = null
  if (datedComplete && schedule?.length) {
    longestScheduledGap = 0
    let current = 0
    for (const date of schedule) {
      current = active.has(date) ? 0 : current + 1
      longestScheduledGap = Math.max(longestScheduledGap, current)
    }
  }
  if (report.coverage.history !== 'complete' || report.coverage.files !== 'complete' || report.baseline.status !== 'applied' || report.activity.undatedCommitCount) {
    add('coverage', 'limitation', 'This report describes collected, attributable evidence. Incomplete collection, missing dates or unreviewed starter history limit conclusions; partial values are not exact totals.')
  }
  if (!n) add('no-commits', 'limitation', scope === 'legacy' ? 'No included commits matched the configured identity and period. Check the login, dates, exclusions and collection status before drawing conclusions.' : 'No included commits were observed in this scope and period. Check dates, exclusions and collection status before drawing conclusions.')
  if (n) add('activity', 'strength', `The collected history contains ${n} included commit${n === 1 ? '' : 's'} across ${active.size} dated day${active.size === 1 ? '' : 's'}. This records checkpoints, not time spent.`, report.commits)
  if (n && generic.length / n >= RULE_THRESHOLDS.genericMessageShare) {
    add('generic-messages', 'improvement', `${generic.length} of ${n} messages use a generic label such as “update” or “fix” (rule: at least 25%). Name the specific behavior or problem changed so the history is easier to follow.`, generic)
  }
  if (n && longestScheduledGap !== null && longestScheduledGap >= RULE_THRESHOLDS.scheduledGap) {
    add('scheduled-gap', 'review_question', `There is a gap of ${longestScheduledGap} consecutive scheduled project dates with no included dated commit (rule: at least 3). ${scope === 'legacy' ? 'Describe how you recorded your work during that gap.' : 'Review how changes in this scope were recorded during that gap.'} Commit gaps do not establish absence or lack of effort.`, report.commits)
  }
  if (n >= 4 && report.metrics.busiestDayShare.value !== null && report.metrics.busiestDayShare.value >= RULE_THRESHOLDS.concentratedDayShare) {
    const busiest = [...report.timeline].sort((a, b) => b.commitCount - a.commitCount)[0]
    add('concentration', 'review_question', `${Math.round(report.metrics.busiestDayShare.value * 100)}% of included commits fall on ${busiest.date} (rule: at least 50%, with 4 or more commits). ${scope === 'legacy' ? 'Explain which changes were recorded together and how you developed them.' : 'Review which changes in this scope were recorded together and how they developed.'}`, report.commits.filter(commit => busiest.commitShas.includes(commit.sha)))
  }
  const totalChurn = report.commits.reduce((sum, commit) => sum + (commit.additions || 0) + (commit.deletions || 0), 0)
  if (report.heatmap.status === 'available' && totalChurn) {
    const large = report.commits.filter(commit => (commit.additions || 0) + (commit.deletions || 0) >= RULE_THRESHOLDS.largeChangeLines && ((commit.additions || 0) + (commit.deletions || 0)) / totalChurn >= RULE_THRESHOLDS.largeChangeShare)
    if (large.length) add('large-change', 'review_question', 'A single commit contains at least 200 added/deleted lines and at least 50% of observed changed lines. Walk through that change and demonstrate a small modification. A large change does not establish copying or AI use; changed lines can include formatting and repeated edits.', large)
  }
  add('push-timing', 'limitation', 'This history shows commit author dates, not when commits were pushed. Regular pushing and work duration cannot be verified from this report.')
  const feedback = observations.filter(item => item.kind !== 'limitation').map(item => item.text)
  if (!feedback.length) feedback.push('There is not enough attributable history to draft workflow feedback. Check the report limitations and configuration.')
  if (observations.some(item => item.ruleId === 'coverage')) feedback.unshift('Some evidence is incomplete or starter history has not been reviewed; treat these observations as provisional.')
  return { rulesVersion: '1.0.0', observations, summary: { activeDays: active.size, genericMessageCount: generic.length, messageCount: n, longestScheduledGap }, feedbackDraft: feedback.join('\n\n') }
}
