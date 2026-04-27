import type { ContributorGrade, ContributorMetrics } from '@/lib/engine/types'

export interface ExportContributorRow {
  metrics: ContributorMetrics
  grade: ContributorGrade
}

export function serializeResultsCsv(rows: ExportContributorRow[]): string {
  const header = [
    'contributor_id',
    'contributor_name',
    'github_login',
    'letter_grade',
    'absolute_percent',
    'raw_score',
    'cohort_relative_score',
    'confidence',
    'commit_count',
    'active_days',
    'session_count',
    'weighted_contribution',
    'relative_contribution_share',
    'spread_score',
    'iteration_score',
    'review_activity_count',
    'top_areas',
    'warnings',
  ]

  const lines = rows.map(({ metrics, grade }) => [
    metrics.contributorId,
    metrics.name,
    metrics.githubLogin || '',
    grade.letterGrade,
    String(grade.absolutePercent),
    String(grade.rawScore),
    String(grade.cohortRelativeScore),
    String(metrics.confidence),
    String(metrics.commitCount),
    String(metrics.activeDays),
    String(metrics.sessionCount),
    String(metrics.weightedContribution),
    String(metrics.relativeContributionShare),
    String(metrics.spreadScore),
    String(metrics.iterationScore),
    String(metrics.reviewActivityCount),
    metrics.areas.join('; '),
    metrics.warnings.map((warning) => warning.message).join('; '),
  ])

  return [header, ...lines].map((line) => line.map(escapeCsvCell).join(',')).join('\n')
}

function escapeCsvCell(value: string): string {
  if (!/[",\n]/.test(value)) return value
  return `"${value.replace(/"/g, '""')}"`
}
