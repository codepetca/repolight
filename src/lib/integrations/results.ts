import type {
  ContributorGrade,
  ContributorMetrics,
  EvidenceItem,
  RunWarning,
  SemanticBreakdown,
  TimelinePoint,
} from '@/lib/engine/types'
import type { RunResults } from '@/lib/runs/service'

export interface NormalizedComponentScores {
  impact: number
  workflow: number
  quality: number
  collaboration: number
}

export interface RepocatContributorResult {
  contributor: {
    id: string
    name: string
    github_login: string | null
  }
  activity: {
    commit_count: number
    active_days: number
    session_count: number
    burst_ratio: number
  }
  contribution: {
    weighted_contribution: number
    relative_contribution_share: number
    semantic_breakdown: SemanticBreakdown
  }
  component_scores: NormalizedComponentScores
  workflow: {
    spread_score: number
    iteration_score: number
    workflow_score: number
  }
  quality: {
    quality_score: number
    review_activity_count: number
    areas_touched: string[]
  }
  impact: {
    impact_score: number
  }
  grade_suggestion: {
    raw_score: number
    cohort_relative_score: number
    percent: number
    letter: string
  }
  confidence: {
    value: number
    warnings: RunWarning[]
  }
  achievement: string
  feedback: string
  evidence_summary: string
  evidence: EvidenceItem[]
  timeline: TimelinePoint[]
}

export interface RepocatContributorSummary {
  contributor: RepocatContributorResult['contributor']
  achievement: string
  component_scores: NormalizedComponentScores
  grade_suggestion: RepocatContributorResult['grade_suggestion']
  activity_summary: {
    commit_count: number
    active_days: number
    session_count: number
    burst_ratio: number
    weighted_contribution: number
  }
  strengths: string[]
  next_step: string
  feedback_comment: string
  confidence: {
    value: number
    warnings: RunWarning[]
  }
}

export interface RepocatChartData {
  run: RunResults['run']
  charts: {
    impact_workflow_scatter: Array<{
      contributor_id: string
      name: string
      github_login: string | null
      impact: number
      workflow: number
      quality: number
      grade_letter: string
      grade_percent: number
      confidence: number
      commit_count: number
      weighted_contribution: number
    }>
    component_comparison: Array<{
      contributor_id: string
      name: string
      impact: number
      workflow: number
      quality: number
      collaboration: number
    }>
    semantic_breakdown_stacked: Array<{
      contributor_id: string
      name: string
      breakdown: SemanticBreakdown
    }>
    timelines: Array<{
      contributor_id: string
      name: string
      points: TimelinePoint[]
    }>
    cohort_benchmarks: {
      impact: Benchmark
      workflow: Benchmark
      quality: Benchmark
      weighted_contribution: Benchmark
      active_days: Benchmark
      commits: Benchmark
    }
  }
}

interface Benchmark {
  min: number
  median: number
  max: number
}

export function toRepocatResults(results: RunResults): { run: RunResults['run']; contributors: RepocatContributorResult[] } {
  return {
    run: results.run,
    contributors: results.contributors.map(({ metrics, grade }) => toRepocatContributorResult(metrics, grade)),
  }
}

export function toRepocatSummary(results: RunResults): { run: RunResults['run']; contributors: RepocatContributorSummary[] } {
  const includeCollaboration = results.run.rubric.componentWeights.collaboration > 0
  return {
    run: results.run,
    contributors: toRepocatResults(results).contributors.map((result) => toContributorSummary(result, includeCollaboration)),
  }
}

export function toRepocatCharts(results: RunResults): RepocatChartData {
  const contributors = toRepocatResults(results).contributors
  return {
    run: results.run,
    charts: {
      impact_workflow_scatter: contributors.map((result) => ({
        contributor_id: result.contributor.id,
        name: result.contributor.name,
        github_login: result.contributor.github_login,
        impact: result.component_scores.impact,
        workflow: result.component_scores.workflow,
        quality: result.component_scores.quality,
        grade_letter: result.grade_suggestion.letter,
        grade_percent: result.grade_suggestion.percent,
        confidence: result.confidence.value,
        commit_count: result.activity.commit_count,
        weighted_contribution: result.contribution.weighted_contribution,
      })),
      component_comparison: contributors.map((result) => ({
        contributor_id: result.contributor.id,
        name: result.contributor.name,
        impact: result.component_scores.impact,
        workflow: result.component_scores.workflow,
        quality: result.component_scores.quality,
        collaboration: result.component_scores.collaboration,
      })),
      semantic_breakdown_stacked: contributors.map((result) => ({
        contributor_id: result.contributor.id,
        name: result.contributor.name,
        breakdown: result.contribution.semantic_breakdown,
      })),
      timelines: contributors.map((result) => ({
        contributor_id: result.contributor.id,
        name: result.contributor.name,
        points: result.timeline,
      })),
      cohort_benchmarks: {
        impact: benchmark(contributors.map((result) => result.component_scores.impact)),
        workflow: benchmark(contributors.map((result) => result.component_scores.workflow)),
        quality: benchmark(contributors.map((result) => result.component_scores.quality)),
        weighted_contribution: benchmark(contributors.map((result) => result.contribution.weighted_contribution)),
        active_days: benchmark(contributors.map((result) => result.activity.active_days)),
        commits: benchmark(contributors.map((result) => result.activity.commit_count)),
      },
    },
  }
}

export function serializeRepocatResultsCsv(results: RunResults): string {
  const header = [
    'contributor_id',
    'contributor_name',
    'github_login',
    'component_impact',
    'component_workflow',
    'component_quality',
    'component_collaboration',
    'grade_percent',
    'grade_letter',
    'raw_score',
    'cohort_relative_score',
    'confidence',
    'commit_count',
    'active_days',
    'session_count',
    'burst_ratio',
    'weighted_contribution',
    'relative_contribution_share',
    'spread_score',
    'iteration_score',
    'review_activity_count',
    'areas_touched',
    'achievement',
    'evidence_summary',
    'warnings',
  ]

  const rows = toRepocatResults(results).contributors.map((result) => [
    result.contributor.id,
    result.contributor.name,
    result.contributor.github_login || '',
    String(result.component_scores.impact),
    String(result.component_scores.workflow),
    String(result.component_scores.quality),
    String(result.component_scores.collaboration),
    String(result.grade_suggestion.percent),
    result.grade_suggestion.letter,
    String(result.grade_suggestion.raw_score),
    String(result.grade_suggestion.cohort_relative_score),
    String(result.confidence.value),
    String(result.activity.commit_count),
    String(result.activity.active_days),
    String(result.activity.session_count),
    String(result.activity.burst_ratio),
    String(result.contribution.weighted_contribution),
    String(result.contribution.relative_contribution_share),
    String(result.workflow.spread_score),
    String(result.workflow.iteration_score),
    String(result.quality.review_activity_count),
    result.quality.areas_touched.join('; '),
    result.achievement,
    result.evidence_summary,
    result.confidence.warnings.map((warning) => warning.message).join('; '),
  ])

  return [header, ...rows].map((row) => row.map(escapeCsvCell).join(',')).join('\n')
}

function toContributorSummary(result: RepocatContributorResult, includeCollaboration: boolean): RepocatContributorSummary {
  const strengths = strengthsFor(result)
  const nextStep = nextStepFor(result, includeCollaboration)
  return {
    contributor: result.contributor,
    achievement: result.achievement,
    component_scores: result.component_scores,
    grade_suggestion: result.grade_suggestion,
    activity_summary: {
      commit_count: result.activity.commit_count,
      active_days: result.activity.active_days,
      session_count: result.activity.session_count,
      burst_ratio: result.activity.burst_ratio,
      weighted_contribution: result.contribution.weighted_contribution,
    },
    strengths,
    next_step: nextStep,
    feedback_comment: feedbackCommentFor(result, strengths, nextStep),
    confidence: result.confidence,
  }
}

function toRepocatContributorResult(metrics: ContributorMetrics, grade: ContributorGrade): RepocatContributorResult {
  return {
    contributor: {
      id: metrics.contributorId,
      name: metrics.name,
      github_login: metrics.githubLogin,
    },
    activity: {
      commit_count: metrics.commitCount,
      active_days: metrics.activeDays,
      session_count: metrics.sessionCount,
      burst_ratio: metrics.burstRatio,
    },
    contribution: {
      weighted_contribution: metrics.weightedContribution,
      relative_contribution_share: metrics.relativeContributionShare,
      semantic_breakdown: metrics.semanticBreakdown,
    },
    component_scores: {
      impact: normalizedScore(metrics.impactScore),
      workflow: normalizedScore(metrics.workflowScore),
      quality: normalizedScore(metrics.qualityScore),
      collaboration: normalizedScore(metrics.collaborationScore),
    },
    workflow: {
      spread_score: metrics.spreadScore,
      iteration_score: metrics.iterationScore,
      workflow_score: normalizedScore(metrics.workflowScore),
    },
    quality: {
      quality_score: normalizedScore(metrics.qualityScore),
      review_activity_count: metrics.reviewActivityCount,
      areas_touched: metrics.areas,
    },
    impact: {
      impact_score: normalizedScore(metrics.impactScore),
    },
    grade_suggestion: {
      raw_score: grade.rawScore,
      cohort_relative_score: grade.cohortRelativeScore,
      percent: grade.absolutePercent,
      letter: grade.letterGrade,
    },
    confidence: {
      value: metrics.confidence,
      warnings: metrics.warnings,
    },
    achievement: achievementFor(metrics),
    feedback: feedbackFor(metrics),
    evidence_summary: evidenceSummaryFor(metrics),
    evidence: metrics.evidence,
    timeline: metrics.timeline,
  }
}

function strengthsFor(result: RepocatContributorResult): string[] {
  const strengths: string[] = []
  if (result.component_scores.impact >= 0.75) {
    strengths.push('meaningful project impact')
  }
  if (result.component_scores.workflow >= 0.65) {
    strengths.push('steady workflow across sessions')
  }
  if (result.component_scores.quality >= 0.65) {
    strengths.push('visible iteration and refinement')
  }
  if (result.activity.active_days >= 3) {
    strengths.push(`${result.activity.active_days} active work days`)
  }
  if (result.activity.session_count >= 4) {
    strengths.push(`${result.activity.session_count} separate work sessions`)
  }
  if (strengths.length === 0 && result.activity.commit_count > 0) {
    strengths.push('visible committed progress')
  }
  return strengths
}

function nextStepFor(result: RepocatContributorResult, includeCollaboration: boolean): string {
  const entries = componentEntriesFromScores(result.component_scores)
    .filter(([component]) => includeCollaboration || component !== 'collaboration')
  const lowest = entries
    .sort((left, right) => left[1] - right[1])[0]?.[0] || 'workflow'
  if (result.activity.commit_count === 0) {
    return 'Make sure project work is committed from the GitHub account or email connected to the assignment.'
  }
  if (lowest === 'impact') {
    return 'Add a few more commits that show meaningful feature work or bug fixes.'
  }
  if (lowest === 'quality') {
    return 'Add commits that clearly show debugging, testing, cleanup, or refinement.'
  }
  if (lowest === 'collaboration') {
    return 'For collaborative assignments, use pull requests or reviews so collaboration evidence is visible.'
  }
  return 'Spread progress over more days or work sessions so the development process is easier to see.'
}

function feedbackCommentFor(
  result: RepocatContributorResult,
  strengths: string[],
  nextStep: string,
): string {
  if (result.activity.commit_count === 0) {
    return [
      'RepoLight did not find matching commits for this contributor in the analysis window.',
      nextStep,
      `Confidence: ${Math.round(result.confidence.value * 100)}%.`,
    ].join(' ')
  }

  const strengthText = strengths.length > 0
    ? `Strongest evidence: ${strengths.join(', ')}.`
    : 'Strongest evidence: visible committed progress.'

  return [
    `RepoLight found ${result.activity.commit_count} matching commit(s) across ${result.activity.active_days} active day(s) and ${result.activity.session_count} work session(s).`,
    strengthText,
    `Achievement: ${result.achievement}.`,
    `Next step: ${nextStep}`,
    `Confidence: ${Math.round(result.confidence.value * 100)}%.`,
  ].join(' ')
}

function achievementFor(metrics: ContributorMetrics): string {
  if (metrics.commitCount === 0) return 'Ready to Start'
  if (metrics.qualityScore >= 0.75) return 'Iteration Pro'
  if (metrics.workflowScore >= 0.75) return 'Steady Builder'
  if (metrics.impactScore >= 0.85) return 'Strong Builder'
  if (metrics.sessionCount >= 4) return 'Persistent Builder'
  return 'Emerging Builder'
}

function feedbackFor(metrics: ContributorMetrics): string {
  if (metrics.commitCount === 0) {
    return 'No matching commits were found for this run. The next step is to commit work from the GitHub account or email connected to the assignment.'
  }

  const strength = strongestComponent(metrics)
  const nextStep = weakestComponent(metrics)
  return [
    `You have ${metrics.commitCount} matching commit(s) across ${metrics.activeDays} active day(s).`,
    strengthMessage(strength),
    nextStepMessage(nextStep),
  ].join(' ')
}

function strongestComponent(metrics: ContributorMetrics): 'impact' | 'workflow' | 'quality' {
  return componentEntries(metrics).sort((left, right) => right[1] - left[1])[0]?.[0] || 'impact'
}

function weakestComponent(metrics: ContributorMetrics): 'impact' | 'workflow' | 'quality' {
  return componentEntries(metrics).sort((left, right) => left[1] - right[1])[0]?.[0] || 'workflow'
}

function componentEntries(metrics: ContributorMetrics): Array<['impact' | 'workflow' | 'quality', number]> {
  return [
    ['impact', metrics.impactScore],
    ['workflow', metrics.workflowScore],
    ['quality', metrics.qualityScore],
  ]
}

function componentEntriesFromScores(scores: NormalizedComponentScores): Array<['impact' | 'workflow' | 'quality' | 'collaboration', number]> {
  return [
    ['impact', scores.impact],
    ['workflow', scores.workflow],
    ['quality', scores.quality],
    ['collaboration', scores.collaboration],
  ]
}

function strengthMessage(component: 'impact' | 'workflow' | 'quality'): string {
  if (component === 'impact') return 'Your strongest evidence is the amount of meaningful project work you produced.'
  if (component === 'quality') return 'Your strongest evidence is iteration: debugging, refactoring, tests, or improvements.'
  return 'Your strongest evidence is workflow: spreading work across sessions instead of leaving everything to the end.'
}

function nextStepMessage(component: 'impact' | 'workflow' | 'quality'): string {
  if (component === 'impact') return 'Next time, aim for a few more meaningful feature or bug-fix commits.'
  if (component === 'quality') return 'Next time, add commits that show refinement, debugging, cleanup, or testing.'
  return 'Next time, commit progress over more days or work sessions so the process is easier to see.'
}

function evidenceSummaryFor(metrics: ContributorMetrics): string {
  if (metrics.evidence.length === 0) return 'No matched commit evidence.'
  return metrics.evidence
    .slice(0, 3)
    .map((item) => item.title)
    .join(' | ')
}

function normalizedScore(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000
}

function benchmark(values: number[]): Benchmark {
  if (values.length === 0) return { min: 0, median: 0, max: 0 }
  const sorted = [...values].sort((left, right) => left - right)
  const mid = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 === 0
    ? ((sorted[mid - 1] || 0) + (sorted[mid] || 0)) / 2
    : sorted[mid] || 0
  return {
    min: normalizedNumber(sorted[0] || 0),
    median: normalizedNumber(median),
    max: normalizedNumber(sorted[sorted.length - 1] || 0),
  }
}

function normalizedNumber(value: number): number {
  return Math.round(value * 1000) / 1000
}

function escapeCsvCell(value: string): string {
  if (!/[",\n]/.test(value)) return value
  return `"${value.replace(/"/g, '""')}"`
}
