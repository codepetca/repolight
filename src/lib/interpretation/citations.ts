import type { PublicRepositoryBundle, ScopeAnalysis } from '@/lib/report/bundle-contract'
import type { InterpretationCitation } from './contract'

/** Client-safe local citation mapping; no configuration, digests, provider or persistence imports. */
export function buildInterpretationCitations(bundle: PublicRepositoryBundle, scopeKey: string): InterpretationCitation[] {
  const scope: ScopeAnalysis | undefined = scopeKey === 'repository' ? bundle.overview : bundle.contributors.find(entry => `contributor:${entry.contributor.id}` === scopeKey)?.analysis
  if (!scope) throw new Error('invalid_scope')
  const citations: InterpretationCitation[] = []
  const add = (sourceKey: InterpretationCitation['sourceKey'], label: string, value: InterpretationCitation['value'], status: InterpretationCitation['status']) => citations.push({ id: `c${citations.length + 1}`, sourceKey, label, value, status })
  const labels = { commits: 'Included commits', commitDensity: 'Commits per scheduled project date', scheduledDayCoverage: 'Scheduled dates with included commits', busiestDayShare: 'Largest local-day commit share' }
  for (const key of ['commits', 'commitDensity', 'scheduledDayCoverage', 'busiestDayShare'] as const) add(`metrics.${key}`, labels[key], scope.facts.metrics[key].value, scope.facts.metrics[key].status)
  const countStatus = scope.facts.metrics.commits.status
  add('activity.activeDays', 'Observed active local dates', countStatus === 'unavailable' ? null : scope.ruleFeedback.summary.activeDays, scope.facts.activity.undatedCommitCount && countStatus === 'available' ? 'partial' : countStatus)
  add('activity.undatedCommits', 'Included commits without author dates', scope.facts.activity.undatedCommitCount, countStatus)
  const summary = scope.ruleFeedback.summary
  add('rules.genericMessageShare', 'Messages matching exact generic-label rules', summary.messageCount ? Math.round(summary.genericMessageCount / summary.messageCount * 10000) / 10000 : null, summary.messageCount ? countStatus : 'unavailable')
  add('rules.longestScheduledGap', 'Consecutive scheduled dates without a dated commit', summary.longestScheduledGap, summary.longestScheduledGap === null ? 'unavailable' : 'available')
  add('coverage.history', 'Collected history coverage', scope.facts.coverage.history, scope.facts.coverage.history === 'complete' ? 'available' : scope.facts.coverage.history)
  add('coverage.files', 'Collected file coverage', scope.facts.coverage.files, scope.facts.coverage.files === 'complete' ? 'available' : scope.facts.coverage.files)
  add('baseline.status', 'Starter-history review', bundle.context.baseline.status, bundle.context.baseline.status === 'applied' ? 'available' : 'partial')
  return citations
}
