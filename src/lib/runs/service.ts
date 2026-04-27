import { and, asc, desc, eq } from 'drizzle-orm'
import { getDb } from '@/db'
import {
  analysisEvents,
  analysisRuns,
  contributorResults,
  runContributors,
  runRepositories,
  type AnalysisRun,
  type RunContributor,
  type RunRepository,
} from '@/db/schema'
import { parseRunCsv } from '@/lib/engine/csv'
import { serializeResultsCsv } from '@/lib/engine/export'
import { buildFixtureRepositoryEvents } from '@/lib/engine/fixtures'
import { computeContributorAnalysis } from '@/lib/engine/metrics'
import { normalizeRubric } from '@/lib/engine/rubric'
import type {
  AnalysisEvent,
  AnalysisWindow,
  ContributorGrade,
  ContributorIdentity,
  ContributorMetrics,
  RepositoryTarget,
  RubricConfig,
  RunWarning,
} from '@/lib/engine/types'
import { getGitHubToken, GitHubClient } from '@/lib/engine/github'

export interface CreateRunInput {
  name?: string
  csvText: string
  startAt: string
  endAt: string
  timezone: string
  rubric?: Partial<RubricConfig>
  externalSystem?: string | null
  externalRunKey?: string | null
  externalAssignmentId?: string | null
  externalClassroomId?: string | null
  externalMetadata?: Record<string, unknown>
}

export interface CreateRunFromParsedInput extends Omit<CreateRunInput, 'csvText'> {
  parsed: {
    contributors: ContributorIdentity[]
    repositories: RepositoryTarget[]
    warnings: RunWarning[]
  }
}

export interface RunSummary {
  id: string
  name: string
  status: string
  externalSystem: string | null
  externalRunKey: string | null
  externalAssignmentId: string | null
  externalClassroomId: string | null
  externalMetadata: Record<string, unknown>
  startAt: string
  endAt: string
  timezone: string
  rubric: RubricConfig
  warnings: RunWarning[]
  totalRepositories: number
  processedRepositories: number
  failedRepositories: number
  createdAt: string
  completedAt: string | null
}

export interface RunDetail extends RunSummary {
  repositories: Array<{
    id: string
    repositoryKey: string
    repoUrl: string
    owner: string
    name: string
    branch: string
    status: string
    warnings: RunWarning[]
    lastError: string | null
    processedAt: string | null
  }>
  contributors: Array<{
    contributorId: string
    name: string
    githubLogin: string | null
    commitEmails: string[]
    repositoryKeys: string[]
    groupName: string | null
    notes: string | null
  }>
}

export interface RunResults {
  run: RunSummary
  contributors: Array<{
    metrics: ContributorMetrics
    grade: ContributorGrade
  }>
}

export async function createRun(userId: string, input: CreateRunInput): Promise<RunDetail> {
  return createRunFromParsed(userId, {
    ...input,
    parsed: parseRunCsv(input.csvText),
  })
}

export async function createRunFromParsed(userId: string, input: CreateRunFromParsedInput): Promise<RunDetail> {
  const startAt = normalizeIso(input.startAt, 'startAt')
  const endAt = normalizeIso(input.endAt, 'endAt')
  if (new Date(startAt).getTime() > new Date(endAt).getTime()) {
    throw new Error('startAt must be before endAt.')
  }

  const parsed = input.parsed
  if (parsed.contributors.length === 0 || parsed.repositories.length === 0) {
    throw new Error('Run must include at least one contributor and repository.')
  }
  if (parsed.contributors.length > 100 || parsed.repositories.length > 100) {
    throw new Error('V1 supports up to 100 contributors and 100 repositories per run.')
  }

  const rubric = normalizeRubric(input.rubric)
  const database = getDb()
  const now = new Date().toISOString()
  const externalSystem = normalizedOptional(input.externalSystem)
  const externalRunKey = normalizedOptional(input.externalRunKey)
  const externalAssignmentId = normalizedOptional(input.externalAssignmentId)
  const externalClassroomId = normalizedOptional(input.externalClassroomId)

  if (externalSystem && externalRunKey) {
    const [existingRun] = await database
      .select()
      .from(analysisRuns)
      .where(and(
        eq(analysisRuns.userId, userId),
        eq(analysisRuns.externalSystem, externalSystem),
        eq(analysisRuns.externalRunKey, externalRunKey),
      ))
      .limit(1)

    if (existingRun) return getRunDetail(userId, existingRun.id)
  }

  const [run] = await database.insert(analysisRuns).values({
    userId,
    name: input.name?.trim() || `Repo analysis ${now.slice(0, 10)}`,
    status: 'queued',
    externalSystem,
    externalRunKey,
    externalAssignmentId,
    externalClassroomId,
    externalMetadataJson: input.externalMetadata || {},
    startAt,
    endAt,
    timezone: input.timezone || 'America/Toronto',
    rubricJson: rubric,
    warningsJson: parsed.warnings,
    totalRepositories: parsed.repositories.length,
    processedRepositories: 0,
    failedRepositories: 0,
  }).returning()

  if (!run) throw new Error('Failed to create run.')

  await database.insert(runContributors).values(parsed.contributors.map((contributor) => ({
    runId: run.id,
    contributorId: contributor.contributorId,
    name: contributor.name,
    githubLogin: contributor.githubLogin,
    commitEmails: contributor.commitEmails,
    repositoryKeys: contributor.repositoryKeys,
    groupName: contributor.groupName || null,
    notes: contributor.notes || null,
  })))

  await database.insert(runRepositories).values(parsed.repositories.map((repository) => ({
    runId: run.id,
    repositoryKey: repository.key,
    repoUrl: repository.repoUrl,
    owner: repository.owner,
    name: repository.name,
    branch: repository.branch,
    status: 'queued',
    warningsJson: [],
  })))

  await recalculateRunResults(userId, run.id)
  return getRunDetail(userId, run.id)
}

export async function listRunsForUser(userId: string): Promise<RunSummary[]> {
  const rows = await getDb()
    .select()
    .from(analysisRuns)
    .where(eq(analysisRuns.userId, userId))
    .orderBy(desc(analysisRuns.createdAt))
    .limit(30)

  return rows.map(summarizeRun)
}

export async function getRunDetail(userId: string, runId: string): Promise<RunDetail> {
  const run = await getRunForUser(userId, runId)
  const database = getDb()
  const [repositories, contributors] = await Promise.all([
    database.select().from(runRepositories).where(eq(runRepositories.runId, run.id)).orderBy(asc(runRepositories.createdAt)),
    database.select().from(runContributors).where(eq(runContributors.runId, run.id)).orderBy(asc(runContributors.createdAt)),
  ])

  return {
    ...summarizeRun(run),
    repositories: repositories.map((repository) => ({
      id: repository.id,
      repositoryKey: repository.repositoryKey,
      repoUrl: repository.repoUrl,
      owner: repository.owner,
      name: repository.name,
      branch: repository.branch,
      status: repository.status,
      warnings: repository.warningsJson || [],
      lastError: repository.lastError,
      processedAt: repository.processedAt,
    })),
    contributors: contributors.map(toContributorResponse),
  }
}

export async function getRunResults(userId: string, runId: string): Promise<RunResults> {
  const run = await getRunForUser(userId, runId)
  const rows = await getDb()
    .select()
    .from(contributorResults)
    .where(eq(contributorResults.runId, run.id))
    .orderBy(asc(contributorResults.createdAt))

  return {
    run: summarizeRun(run),
    contributors: rows.map((row) => ({
      metrics: row.metricsJson,
      grade: row.gradeJson,
    })),
  }
}

export async function exportRunResultsCsv(userId: string, runId: string): Promise<string> {
  const results = await getRunResults(userId, runId)
  return serializeResultsCsv(results.contributors)
}

export async function updateRunRubric(userId: string, runId: string, rubricInput: Partial<RubricConfig>): Promise<RunSummary> {
  await getRunForUser(userId, runId)
  const rubric = normalizeRubric(rubricInput)
  const [run] = await getDb()
    .update(analysisRuns)
    .set({ rubricJson: rubric, updatedAt: new Date().toISOString() })
    .where(eq(analysisRuns.id, runId))
    .returning()
  if (!run) throw new Error('Run not found.')
  return summarizeRun(run)
}

export async function recalculateRunResults(userId: string, runId: string): Promise<RunResults> {
  const run = await getRunForUser(userId, runId)
  const database = getDb()
  const [contributors, events] = await Promise.all([
    database.select().from(runContributors).where(eq(runContributors.runId, run.id)),
    database.select().from(analysisEvents).where(eq(analysisEvents.runId, run.id)),
  ])

  const analysis = computeContributorAnalysis({
    identities: contributors.map(toContributorIdentity),
    events: events.map((event) => event.payloadJson),
    window: toAnalysisWindow(run),
    rubric: run.rubricJson,
  })

  await database.delete(contributorResults).where(eq(contributorResults.runId, run.id))
  if (analysis.contributors.length > 0) {
    await database.insert(contributorResults).values(analysis.contributors.map((result) => ({
      runId: run.id,
      contributorId: result.metrics.contributorId,
      metricsJson: result.metrics,
      gradeJson: result.grade,
    })))
  }

  const mergedWarnings = mergeWarnings(run.warningsJson || [], analysis.warnings)
  await database.update(analysisRuns)
    .set({ warningsJson: mergedWarnings, updatedAt: new Date().toISOString() })
    .where(eq(analysisRuns.id, run.id))

  return getRunResults(userId, run.id)
}

export async function processNextRepository(userId: string, runId: string, opts: { retryFailed?: boolean } = {}) {
  const run = await getRunForUser(userId, runId)
  const database = getDb()
  const repositories = await database
    .select()
    .from(runRepositories)
    .where(eq(runRepositories.runId, run.id))
    .orderBy(asc(runRepositories.createdAt))

  let repository = repositories.find((item) => item.status === 'queued')
  if (!repository && opts.retryFailed) {
    repository = repositories.find((item) => item.status === 'failed')
  }

  if (!repository) {
    await refreshRunProgress(run.id)
    const detail = await getRunDetail(userId, run.id)
    return {
      run: detail,
      processed: false,
      hasMore: false,
      message: 'No queued repositories remain.',
    }
  }

  await database.update(runRepositories)
    .set({ status: 'processing', lastError: null })
    .where(eq(runRepositories.id, repository.id))
  await database.update(analysisRuns)
    .set({ status: 'processing', updatedAt: new Date().toISOString() })
    .where(eq(analysisRuns.id, run.id))

  const target = toRepositoryTarget(repository)

  try {
    const window = toAnalysisWindow(run)
    const events = process.env.REPOCAT_USE_FIXTURE_GITHUB === '1'
      ? buildFixtureRepositoryEvents(target, window)
      : await fetchGitHubEvents(target, window)
    await database.delete(analysisEvents).where(and(
      eq(analysisEvents.runId, run.id),
      eq(analysisEvents.repositoryId, repository.id),
    ))
    if (events.length > 0) {
      await database.insert(analysisEvents).values(events.map((event) => ({
        runId: run.id,
        repositoryId: repository.id,
        repositoryKey: repository.repositoryKey,
        eventType: event.type,
        externalId: event.externalId,
        payloadJson: event,
        authoredAt: event.authoredAt || null,
      })))
    }

    await database.update(runRepositories)
      .set({
        status: 'processed',
        warningsJson: [],
        lastError: null,
        processedAt: new Date().toISOString(),
      })
      .where(eq(runRepositories.id, repository.id))
    await refreshRunProgress(run.id)
    await recalculateRunResults(userId, run.id)
    const detail = await getRunDetail(userId, run.id)
    return {
      run: detail,
      processed: true,
      repositoryKey: repository.repositoryKey,
      eventCount: events.length,
      hasMore: detail.repositories.some((item) => item.status === 'queued'),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Repository processing failed.'
    const warning: RunWarning = {
      code: 'repository-processing-failed',
      message: `${repository.repositoryKey}: ${message}`,
      repositoryKey: repository.repositoryKey,
    }
    await database.update(runRepositories)
      .set({
        status: 'failed',
        lastError: message,
        warningsJson: mergeWarnings(repository.warningsJson || [], [warning]),
      })
      .where(eq(runRepositories.id, repository.id))
    await database.update(analysisRuns)
      .set({
        warningsJson: mergeWarnings(run.warningsJson || [], [warning]),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(analysisRuns.id, run.id))
    await refreshRunProgress(run.id)
    const detail = await getRunDetail(userId, run.id)
    return {
      run: detail,
      processed: false,
      repositoryKey: repository.repositoryKey,
      error: message,
      hasMore: detail.repositories.some((item) => item.status === 'queued'),
    }
  }
}

async function fetchGitHubEvents(target: RepositoryTarget, window: AnalysisWindow): Promise<AnalysisEvent[]> {
  const client = new GitHubClient({ token: getGitHubToken() })
  const validated = await client.validatePublicRepository(target)
  return client.fetchRepositoryEvents(validated, window, true)
}

async function getRunForUser(userId: string, runId: string): Promise<AnalysisRun> {
  const [run] = await getDb()
    .select()
    .from(analysisRuns)
    .where(and(eq(analysisRuns.id, runId), eq(analysisRuns.userId, userId)))
    .limit(1)

  if (!run) throw new Error('Run not found.')
  return run
}

async function refreshRunProgress(runId: string): Promise<void> {
  const database = getDb()
  const repositories = await database.select().from(runRepositories).where(eq(runRepositories.runId, runId))
  const processed = repositories.filter((repository) => repository.status === 'processed').length
  const failed = repositories.filter((repository) => repository.status === 'failed').length
  const queued = repositories.filter((repository) => repository.status === 'queued' || repository.status === 'processing').length
  const completed = queued === 0
  await database.update(analysisRuns)
    .set({
      status: completed ? 'completed' : 'processing',
      processedRepositories: processed,
      failedRepositories: failed,
      completedAt: completed ? new Date().toISOString() : null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(analysisRuns.id, runId))
}

function summarizeRun(run: AnalysisRun): RunSummary {
  return {
    id: run.id,
    name: run.name,
    status: run.status,
    externalSystem: run.externalSystem,
    externalRunKey: run.externalRunKey,
    externalAssignmentId: run.externalAssignmentId,
    externalClassroomId: run.externalClassroomId,
    externalMetadata: run.externalMetadataJson || {},
    startAt: run.startAt,
    endAt: run.endAt,
    timezone: run.timezone,
    rubric: normalizeRubric(run.rubricJson),
    warnings: run.warningsJson || [],
    totalRepositories: run.totalRepositories,
    processedRepositories: run.processedRepositories,
    failedRepositories: run.failedRepositories,
    createdAt: run.createdAt,
    completedAt: run.completedAt,
  }
}

function toContributorResponse(contributor: RunContributor) {
  return {
    contributorId: contributor.contributorId,
    name: contributor.name,
    githubLogin: contributor.githubLogin,
    commitEmails: contributor.commitEmails,
    repositoryKeys: contributor.repositoryKeys,
    groupName: contributor.groupName,
    notes: contributor.notes,
  }
}

function toContributorIdentity(contributor: RunContributor): ContributorIdentity {
  return {
    contributorId: contributor.contributorId,
    name: contributor.name,
    githubLogin: contributor.githubLogin,
    commitEmails: contributor.commitEmails,
    repositoryKeys: contributor.repositoryKeys,
    groupName: contributor.groupName,
    notes: contributor.notes,
  }
}

function toRepositoryTarget(repository: RunRepository): RepositoryTarget {
  return {
    key: repository.repositoryKey,
    provider: 'github',
    repoUrl: repository.repoUrl,
    owner: repository.owner,
    name: repository.name,
    branch: repository.branch,
  }
}

function toAnalysisWindow(run: AnalysisRun): AnalysisWindow {
  return {
    startAt: run.startAt,
    endAt: run.endAt,
    timezone: run.timezone,
  }
}

function normalizeIso(value: string, field: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error(`${field} must be a valid date/time.`)
  return date.toISOString()
}

function normalizedOptional(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  return normalized || null
}

function mergeWarnings(existing: RunWarning[], next: RunWarning[]): RunWarning[] {
  const byKey = new Map<string, RunWarning>()
  for (const warning of [...existing, ...next]) {
    byKey.set(`${warning.code}:${warning.repositoryKey || ''}:${warning.contributorId || ''}:${warning.message}`, warning)
  }
  return [...byKey.values()]
}
