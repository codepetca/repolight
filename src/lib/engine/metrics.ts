import { createEmptySemanticBreakdown, inferAreaFromPath } from '@/lib/engine/categorize'
import { normalizeCommitEmails, normalizeGitHubLogin } from '@/lib/engine/repo'
import { normalizeRubric } from '@/lib/engine/rubric'
import { clamp, enumerateDays, formatDayInZone, round } from '@/lib/engine/time'
import type {
  AnalysisEvent,
  AnalysisResult,
  AnalysisWindow,
  CommitFile,
  ContributorGrade,
  ContributorIdentity,
  ContributorMetrics,
  EvidenceItem,
  RubricConfig,
  RunWarning,
  SemanticBreakdown,
  SemanticCategory,
  TimelinePoint,
} from '@/lib/engine/types'

const SESSION_GAP_MS = 90 * 60 * 1000
const MAX_EVIDENCE_ITEMS = 12

interface MatchedContributor {
  identity: ContributorIdentity
  commitEvents: AnalysisEvent[]
  reviewEvents: AnalysisEvent[]
  warnings: RunWarning[]
}

export function computeWeightedContribution(
  category: SemanticCategory,
  files: CommitFile[],
  rubricInput?: Partial<RubricConfig>,
): number {
  const rubric = normalizeRubric(rubricInput)
  const churn = files.reduce((sum, file) => sum + file.additions + file.deletions, 0)
  const volume = clamp(
    churn / rubric.contributionScale.churnDivisor,
    rubric.contributionScale.minVolume,
    rubric.contributionScale.maxVolume,
  )
  return round((rubric.semanticWeights[category] ?? 0) * volume)
}

export function computeContributorAnalysis(opts: {
  identities: ContributorIdentity[]
  events: AnalysisEvent[]
  window: AnalysisWindow
  rubric?: Partial<RubricConfig>
}): AnalysisResult {
  const rubric = normalizeRubric(opts.rubric)
  const identities = opts.identities.map((identity) => ({
    ...identity,
    githubLogin: normalizeGitHubLogin(identity.githubLogin),
    commitEmails: normalizeCommitEmails(identity.commitEmails),
    repositoryKeys: [...new Set(identity.repositoryKeys)],
  }))
  const matched = new Map<string, MatchedContributor>()
  const warnings: RunWarning[] = []

  for (const identity of identities) {
    matched.set(identity.contributorId, {
      identity,
      commitEvents: [],
      reviewEvents: [],
      warnings: [],
    })
  }

  const unmatchedCommits: AnalysisEvent[] = []
  for (const event of opts.events) {
    if (event.type === 'commit') {
      const identity = findMatchingIdentity(event, identities, true)
      if (!identity) {
        unmatchedCommits.push(event)
        continue
      }
      matched.get(identity.contributorId)?.commitEvents.push(event)
    } else {
      const identity = findMatchingIdentity(event, identities, false)
      if (identity) matched.get(identity.contributorId)?.reviewEvents.push(event)
    }
  }

  if (unmatchedCommits.length > 0) {
    warnings.push({
      code: 'unmatched-commits',
      message: `${unmatchedCommits.length} commit(s) could not be matched to the uploaded contributor identities and were excluded from grading.`,
    })
  }

  const totalDays = enumerateDays(opts.window.startAt, opts.window.endAt, opts.window.timezone).length || 1
  const burstCutoffMs = new Date(opts.window.endAt).getTime() - 48 * 60 * 60 * 1000
  const totalWeightedContribution = [...matched.values()].reduce((sum, item) => {
    return sum + item.commitEvents.reduce((commitSum, event) => commitSum + eventContribution(event, rubric), 0)
  }, 0)

  const metrics = [...matched.values()].map((item) => {
    return buildContributorMetrics({
      item,
      totalDays,
      totalWeightedContribution,
      burstCutoffMs,
      timezone: opts.window.timezone,
      rubric,
    })
  })

  const impactValues = metrics.map((metric) => metric.weightedContribution)
  for (const metric of metrics) {
    const hasActivity = metric.commitCount > 0 || metric.reviewActivityCount > 0
    if (!hasActivity) {
      metric.impactScore = 0
      metric.workflowScore = 0
      metric.qualityScore = 0
      metric.collaborationScore = 0
      continue
    }
    metric.impactScore = cappedScale(metric.weightedContribution, impactValues, rubric.curve.capPercentile, 'binary')
    metric.workflowScore = metric.commitCount === 0
      ? 0
      : round(clamp(
          metric.spreadScore * 0.45 +
          (1 - metric.burstRatio) * 0.3 +
          Math.min(metric.sessionCount, 6) / 6 * 0.25,
          0,
          1,
        ))
    const refinement = metric.semanticBreakdown.test + metric.semanticBreakdown.refactor
    const meaningful = metric.semanticBreakdown.feature + metric.semanticBreakdown.bugfix + refinement
    const qualityRatio = metric.weightedContribution === 0
      ? 0
      : clamp((refinement / Math.max(metric.weightedContribution, 0.0001)) * 0.55 + (meaningful / Math.max(metric.weightedContribution, 0.0001)) * 0.25 + metric.iterationScore * 0.2, 0, 1)
    metric.qualityScore = round(qualityRatio)
    metric.collaborationScore = round(clamp(metric.reviewActivityCount / 4, 0, 1))
  }

  const rawScores = metrics.map((metric) => computeRawScore(metric, rubric))
  const confidence = computeGlobalConfidence(identities.length, metrics, unmatchedCommits.length, opts.events.length)
  const contributors = metrics.map((metric, index) => {
    const rawScore = rawScores[index] || 0
    const cohortRelativeScore = cappedScale(rawScore, rawScores, rubric.curve.capPercentile, 'identity')
    const gradeInput = rawScore * (1 - rubric.curve.relativeWeight) + cohortRelativeScore * rubric.curve.relativeWeight
    const absolutePercent = rawScore <= 0 ? 0 : mapScoreToPercent(gradeInput, rubric)
    metric.confidence = confidence
    const grade: ContributorGrade = {
      contributorId: metric.contributorId,
      rawScore: round(rawScore),
      cohortRelativeScore: round(cohortRelativeScore),
      absolutePercent,
      letterGrade: letterGradeForPercent(absolutePercent, rubric),
    }
    return { metrics: metric, grade }
  })

  return {
    warnings,
    confidence,
    contributors,
  }
}

function buildContributorMetrics(opts: {
  item: MatchedContributor
  totalDays: number
  totalWeightedContribution: number
  burstCutoffMs: number
  timezone: string
  rubric: RubricConfig
}): ContributorMetrics {
  const commits = [...opts.item.commitEvents].sort(compareEventsAsc)
  const reviews = [...opts.item.reviewEvents].sort(compareEventsAsc)
  const activeDaysSet = new Set<string>()
  const timelineMap = new Map<string, TimelinePoint>()
  const breakdown = createEmptySemanticBreakdown()
  const areaCounts = new Map<string, number>()
  let weightedContribution = 0
  let burstWeightedContribution = 0
  let lastCommitAt = 0
  let sessionCount = 0

  for (const event of commits) {
    const category = event.category || 'feature'
    const contribution = eventContribution(event, opts.rubric)
    weightedContribution += contribution
    breakdown[category] += contribution

    const authoredMs = event.authoredAt ? new Date(event.authoredAt).getTime() : 0
    if (authoredMs >= opts.burstCutoffMs) {
      burstWeightedContribution += contribution
    }

    if (authoredMs && (!lastCommitAt || authoredMs - lastCommitAt > SESSION_GAP_MS)) {
      sessionCount += 1
    }
    if (authoredMs) lastCommitAt = authoredMs

    if (event.authoredAt) {
      const day = formatDayInZone(event.authoredAt, opts.timezone)
      activeDaysSet.add(day)
      const point = timelineMap.get(day) || { date: day, weightedContribution: 0, commitCount: 0 }
      point.weightedContribution = round(point.weightedContribution + contribution)
      point.commitCount += 1
      timelineMap.set(day, point)
    }

    for (const area of event.areas || event.files?.map((file) => inferAreaFromPath(file.filename)) || []) {
      areaCounts.set(area, (areaCounts.get(area) || 0) + 1)
    }
  }

  const refinement = breakdown.test + breakdown.refactor
  const spreadScore = commits.length === 0 ? 0 : round(clamp(activeDaysSet.size / Math.max(opts.totalDays, 1), 0, 1))
  const iterationScore = commits.length === 0
    ? 0
    : round(clamp((refinement / Math.max(weightedContribution, 0.0001)) * 0.7 + Math.min(sessionCount, 6) / 6 * 0.3, 0, 1))
  const burstRatio = commits.length === 0
    ? 0
    : round(clamp(burstWeightedContribution / Math.max(weightedContribution, 0.0001), 0, 1))
  const relativeContributionShare = opts.totalWeightedContribution === 0
    ? 0
    : round(weightedContribution / opts.totalWeightedContribution)

  return {
    contributorId: opts.item.identity.contributorId,
    name: opts.item.identity.name,
    githubLogin: opts.item.identity.githubLogin,
    commitCount: commits.length,
    activeDays: activeDaysSet.size,
    sessionCount,
    burstRatio,
    weightedContribution: round(weightedContribution),
    relativeContributionShare,
    spreadScore,
    iterationScore,
    semanticBreakdown: roundBreakdown(breakdown),
    timeline: [...timelineMap.values()].sort((left, right) => left.date.localeCompare(right.date)),
    evidence: buildEvidence([...commits, ...reviews]),
    areas: [...areaCounts.entries()].sort((left, right) => right[1] - left[1]).slice(0, 5).map(([area]) => area),
    reviewActivityCount: reviews.length,
    impactScore: 0,
    workflowScore: 0,
    qualityScore: 0,
    collaborationScore: 0,
    warnings: opts.item.warnings,
    confidence: 0,
  }
}

function findMatchingIdentity(
  event: AnalysisEvent,
  identities: ContributorIdentity[],
  allowEmail: boolean,
): ContributorIdentity | null {
  const eventRepo = event.repositoryKey
  const eventLogin = normalizeGitHubLogin(event.githubLogin)
  const eventEmail = event.authorEmail?.trim().toLowerCase() || null

  for (const identity of identities) {
    if (!identity.repositoryKeys.includes(eventRepo)) continue
    if (identity.githubLogin && eventLogin && identity.githubLogin === eventLogin) return identity
  }

  if (!allowEmail) return null

  for (const identity of identities) {
    if (!identity.repositoryKeys.includes(eventRepo)) continue
    if (eventEmail && identity.commitEmails.includes(eventEmail)) return identity
  }

  return null
}

function eventContribution(event: AnalysisEvent, rubric: RubricConfig): number {
  return computeWeightedContribution(event.category || 'feature', event.files || [], rubric)
}

function buildEvidence(events: AnalysisEvent[]): EvidenceItem[] {
  return [...events]
    .sort((left, right) => new Date(right.authoredAt || 0).getTime() - new Date(left.authoredAt || 0).getTime())
    .slice(0, MAX_EVIDENCE_ITEMS)
    .map((event) => ({
      type: event.type,
      id: event.externalId,
      repositoryKey: event.repositoryKey,
      title: event.title,
      url: event.url,
      authoredAt: event.authoredAt,
      summary: event.summary,
      category: event.category,
    }))
}

function compareEventsAsc(left: AnalysisEvent, right: AnalysisEvent): number {
  return new Date(left.authoredAt || 0).getTime() - new Date(right.authoredAt || 0).getTime()
}

function roundBreakdown(breakdown: SemanticBreakdown): SemanticBreakdown {
  return {
    feature: round(breakdown.feature),
    bugfix: round(breakdown.bugfix),
    test: round(breakdown.test),
    refactor: round(breakdown.refactor),
    docs: round(breakdown.docs),
    styling: round(breakdown.styling),
    config: round(breakdown.config),
    generated: round(breakdown.generated),
  }
}

function computeRawScore(metric: ContributorMetrics, rubric: RubricConfig): number {
  const weights = rubric.componentWeights
  return round(clamp(
    metric.impactScore * weights.impact +
    metric.workflowScore * weights.workflow +
    metric.qualityScore * weights.quality +
    metric.collaborationScore * weights.collaboration,
    0,
    1,
  ))
}

function cappedScale(
  value: number,
  values: number[],
  percentile: number,
  singleMode: 'identity' | 'binary',
): number {
  if (value <= 0) return 0
  const positive = values.filter((candidate) => candidate > 0).sort((left, right) => left - right)
  if (positive.length === 0) return 0
  if (positive.length === 1) {
    return singleMode === 'identity' ? clamp(value, 0, 1) : 1
  }
  const capIndex = Math.min(positive.length - 1, Math.ceil(clamp(percentile, 0, 1) * (positive.length - 1)))
  const cap = Math.max(positive[capIndex] || positive[positive.length - 1] || 1, 0.0001)
  return round(clamp(value / cap, 0, 1))
}

function mapScoreToPercent(score: number, rubric: RubricConfig): number {
  const normalized = clamp(score, 0, 1)
  if (normalized <= 0.5) {
    return Math.round(rubric.curve.floorPercent + (rubric.curve.medianPercent - rubric.curve.floorPercent) * (normalized / 0.5))
  }
  return Math.round(rubric.curve.medianPercent + (rubric.curve.excellentPercent - rubric.curve.medianPercent) * ((normalized - 0.5) / 0.5))
}

function letterGradeForPercent(percent: number, rubric: RubricConfig): string {
  return rubric.gradeBands.find((band) => percent >= band.minPercent)?.label || 'F'
}

function computeGlobalConfidence(
  identityCount: number,
  metrics: ContributorMetrics[],
  unmatchedCommitCount: number,
  eventCount: number,
): number {
  const activeContributors = metrics.filter((metric) => metric.commitCount > 0 || metric.reviewActivityCount > 0).length
  if (eventCount === 0) return 0.2
  return round(clamp(
    0.55 +
    (activeContributors / Math.max(identityCount, 1)) * 0.25 -
    (unmatchedCommitCount / Math.max(eventCount, 1)) * 0.3,
    0.2,
    1,
  ))
}
