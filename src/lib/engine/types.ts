export type RepoProvider = 'github'

export type SemanticCategory =
  | 'feature'
  | 'bugfix'
  | 'test'
  | 'refactor'
  | 'docs'
  | 'styling'
  | 'config'
  | 'generated'

export type AnalysisEventType = 'commit' | 'pull_request' | 'review'

export interface RunWarning {
  code: string
  message: string
  repositoryKey?: string
  contributorId?: string
  githubLogin?: string
}

export interface RepositoryTarget {
  key: string
  provider: RepoProvider
  repoUrl: string
  owner: string
  name: string
  branch: string
}

export interface ContributorIdentity {
  contributorId: string
  name: string
  githubLogin: string | null
  commitEmails: string[]
  repositoryKeys: string[]
  groupName?: string | null
  notes?: string | null
}

export interface AnalysisWindow {
  startAt: string
  endAt: string
  timezone: string
}

export interface CommitFile {
  filename: string
  status: string
  additions: number
  deletions: number
}

export interface AnalysisEvent {
  type: AnalysisEventType
  externalId: string
  repositoryKey: string
  title: string
  authoredAt?: string
  url?: string
  githubLogin?: string | null
  authorEmail?: string | null
  summary?: string
  category?: SemanticCategory
  files?: CommitFile[]
  additions?: number
  deletions?: number
  areas?: string[]
}

export interface SemanticBreakdown {
  feature: number
  bugfix: number
  test: number
  refactor: number
  docs: number
  styling: number
  config: number
  generated: number
}

export interface TimelinePoint {
  date: string
  weightedContribution: number
  commitCount: number
}

export interface EvidenceItem {
  type: AnalysisEventType
  id: string
  repositoryKey: string
  title: string
  url?: string
  authoredAt?: string
  summary?: string
  category?: SemanticCategory
}

export interface RubricConfig {
  version: 'v1'
  componentWeights: {
    impact: number
    workflow: number
    quality: number
    collaboration: number
  }
  semanticWeights: Record<SemanticCategory, number>
  contributionScale: {
    churnDivisor: number
    minVolume: number
    maxVolume: number
  }
  curve: {
    relativeWeight: number
    floorPercent: number
    medianPercent: number
    excellentPercent: number
    capPercentile: number
  }
  gradeBands: Array<{
    label: string
    minPercent: number
  }>
}

export interface ContributorMetrics {
  contributorId: string
  name: string
  githubLogin: string | null
  commitCount: number
  activeDays: number
  sessionCount: number
  burstRatio: number
  weightedContribution: number
  relativeContributionShare: number
  spreadScore: number
  iterationScore: number
  semanticBreakdown: SemanticBreakdown
  timeline: TimelinePoint[]
  evidence: EvidenceItem[]
  areas: string[]
  reviewActivityCount: number
  impactScore: number
  workflowScore: number
  qualityScore: number
  collaborationScore: number
  warnings: RunWarning[]
  confidence: number
}

export interface ContributorGrade {
  contributorId: string
  rawScore: number
  cohortRelativeScore: number
  absolutePercent: number
  letterGrade: string
}

export interface AnalysisResult {
  warnings: RunWarning[]
  confidence: number
  contributors: Array<{
    metrics: ContributorMetrics
    grade: ContributorGrade
  }>
}
