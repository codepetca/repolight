import { normalizeGitHubLogin, makeRepositoryTarget } from '@/lib/engine/repo'
import { formatDayInZone, round } from '@/lib/engine/time'
import type { MetricStatus, ReportBuildInput, RepositoryReport } from '@/lib/report/contract'
import type { ScopeFacts } from '@/lib/report/bundle-contract'

type CalculationInput = Omit<ReportBuildInput, 'identity' | 'reportRef' | 'studentRef'>
export type PreparedCommits = { commits: RepositoryReport['commits']; unmatchedCommitCount: number }

/** Validate/filter once; identity is an explicit legacy predicate, never synthesized. */
export function prepareReportCommits(input: CalculationInput, matches?: (event: ReportBuildInput['events'][number]) => boolean): PreparedCommits {
  const target = makeRepositoryTarget(input.repositoryUrl, input.branch)!
  const bots = new Set(input.exclusions.botLogins.map(normalizeGitHubLogin).filter((login): login is string => login !== null))
  const excludedShas = new Set(input.exclusions.commitShas)
  const start = Date.parse(input.period.startAt), end = Date.parse(input.period.endAt)
  const schedule = input.scheduledProjectDates === null ? null : [...new Set(input.scheduledProjectDates)].sort()
  // Only dates whose local day intersects this report period can enter the denominator.
  const firstDate = formatDayInZone(input.period.startAt, input.period.timezone)
  const lastDate = formatDayInZone(new Date(end - 1).toISOString(), input.period.timezone)
  if (schedule?.some(day => day < firstDate || day > lastDate)) throw new Error('Scheduled project dates must fall within the report period.')

  const bySha = new Map<string, typeof input.events[number]>()
  for (const event of input.events) {
    if (event.type !== 'commit') continue
    if (event.repositoryKey !== target.key) throw new Error('Commit evidence belongs to a different repository or branch.')
    const previous = bySha.get(event.externalId)
    if (previous && JSON.stringify(previous) !== JSON.stringify(event)) throw new Error('Conflicting duplicate commit evidence.')
    bySha.set(event.externalId, event)
  }
  if (input.coverage.history === 'unavailable' && bySha.size) throw new Error('Unavailable history cannot contain commit evidence.')
  let unmatchedCommitCount = 0
  const commits: RepositoryReport['commits'] = []
  const excludedPath = (path: string) => input.exclusions.pathPrefixes.some(prefix => path === prefix || path.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`))
  for (const event of bySha.values()) {
    const login = normalizeGitHubLogin(event.githubLogin)
    if (excludedShas.has(event.externalId) || (login !== null && bots.has(login))) continue
    if (event.authoredAt && (Date.parse(event.authoredAt) < start || Date.parse(event.authoredAt) >= end)) continue
    if (matches && !matches(event)) { unmatchedCommitCount++; continue }
    const hasFiles = input.coverage.files !== 'unavailable' && event.files !== undefined
    const files = hasFiles ? event.files!.filter(file => !excludedPath(file.filename)).map(file => ({ path: file.filename, status: file.status, additions: file.additions, deletions: file.deletions })) : []
    if (input.coverage.files === 'complete' && hasFiles && event.files!.length > 0 && files.length === 0) continue
    if (new Set(files.map(file => file.path)).size !== files.length) throw new Error('Duplicate file evidence in a commit.')
    commits.push({
      sha: event.externalId, message: event.title, authoredAt: event.authoredAt ? new Date(event.authoredAt).toISOString() : null,
      githubLogin: login, url: `${target.repoUrl}/commit/${event.externalId}`,
      additions: hasFiles ? files.reduce((sum, file) => sum + file.additions, 0) : null,
      deletions: hasFiles ? files.reduce((sum, file) => sum + file.deletions, 0) : null, files,
    })
  }
  return { commits, unmatchedCommitCount }
}

export function calculateScopeFacts(input: CalculationInput, commits: RepositoryReport['commits'], identityAvailable = true, wording: 'legacy' | 'scope' = 'scope'): ScopeFacts {
  const notes = [...input.coverage.notes]
  const schedule = input.scheduledProjectDates === null ? null : [...new Set(input.scheduledProjectDates)].sort()
  const scheduleSet = new Set(schedule || [])
  if (input.baseline.status !== 'applied') notes.push('Starter baseline is not applied; supplied code may remain in observed changes.')
  if (!identityAvailable) notes.push('Student identity is not configured; repository commits are not labeled student work.')
  const undatedCommitCount = commits.filter(commit => !commit.authoredAt).length
  const missingFileEvidence = input.coverage.files !== 'complete' || commits.some(commit => commit.additions === null)
  commits = [...commits].sort((a, b) => (a.authoredAt || '').localeCompare(b.authoredAt || '') || a.sha.localeCompare(b.sha))
  const timelineMap = new Map<string, string[]>()
  for (const commit of commits) if (commit.authoredAt) {
    const day = formatDayInZone(commit.authoredAt, input.period.timezone)
    timelineMap.set(day, [...(timelineMap.get(day) || []), commit.sha])
  }
  const timeline = [...timelineMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, commitShas]) => ({ date, commitShas, commitCount: commitShas.length }))
  const n = commits.length
  const historyUnavailable = input.coverage.history === 'unavailable' || !identityAvailable
  const partialCount = input.coverage.history !== 'complete' || input.baseline.status !== 'applied' || (input.exclusions.pathPrefixes.length > 0 && missingFileEvidence)
  const countStatus: MetricStatus = historyUnavailable ? 'unavailable' : partialCount ? 'partial' : 'available'
  const timeStatus: MetricStatus = countStatus === 'available' && undatedCommitCount > 0 ? 'partial' : countStatus
  const metric = (value: number | null, numerator: number | null, denominator: number | null, status: MetricStatus, reason: string | null = null) => ({
    value: status === 'unavailable' ? null : value, numerator: status === 'unavailable' ? null : numerator,
    denominator, status, reason: status === 'available' ? null : (reason || 'Evidence is incomplete; this value describes only collected, attributable records.'),
  })
  const scheduleAvailable = schedule !== null && schedule.length > 0
  const scheduledActiveDays = timeline.filter(point => scheduleSet.has(point.date)).length
  const busiestCount = Math.max(0, ...timeline.map(point => point.commitCount))
  const noDatedEvidence = n > 0 && timeline.length === 0
  const distributionReason = noDatedEvidence ? 'No dated commits are available to determine a day distribution.' : null
  if (undatedCommitCount) notes.push(`${undatedCommitCount} ${wording === 'legacy' ? 'matched' : 'included'} commit(s) have no author date; period membership and day distribution cannot be fully verified.`)
  if (missingFileEvidence) notes.push('File-change evidence is incomplete; absent heatmap cells must not be interpreted as zero changes.')
  return {
    coverage: { history: input.coverage.history, files: missingFileEvidence && input.coverage.files === 'complete' ? 'partial' : input.coverage.files, notes: [...new Set(notes)] },
    metrics: {
      commits: metric(n, n, null, undatedCommitCount && countStatus === 'available' ? 'partial' : countStatus),
      commitDensity: metric(scheduleAvailable ? round(n / schedule!.length) : null, n, schedule?.length ?? null, scheduleAvailable ? timeStatus : 'unavailable', scheduleAvailable ? null : 'Scheduled project dates are missing or empty.'),
      scheduledDayCoverage: metric(scheduleAvailable ? round(scheduledActiveDays / schedule!.length) : null, scheduledActiveDays, schedule?.length ?? null, scheduleAvailable && !noDatedEvidence ? timeStatus : 'unavailable', scheduleAvailable ? distributionReason : 'Scheduled project dates are missing or empty.'),
      busiestDayShare: metric(n ? round(busiestCount / n) : null, busiestCount, n, n && !noDatedEvidence ? timeStatus : 'unavailable', n ? distributionReason : 'No attributable commits are available.'),
    },
    activity: { undatedCommitCount, outsideScheduleCommitCount: historyUnavailable || schedule === null ? null : timeline.filter(point => !scheduleSet.has(point.date)).reduce((sum, point) => sum + point.commitCount, 0) },
    commits, timeline,
    heatmap: {
      status: historyUnavailable || input.coverage.files === 'unavailable' ? 'unavailable' : (missingFileEvidence || countStatus !== 'available') ? 'partial' : 'available',
      files: [...new Set(commits.flatMap(commit => commit.files.map(file => file.path)))].sort(),
      cells: commits.flatMap(commit => commit.files.map(file => ({ commitSha: commit.sha, path: file.path, additions: file.additions, deletions: file.deletions }))),
    },
    pushActivity: { status: 'unavailable', reason: 'push_events_not_collected' },
    interpretation: { status: 'not_requested', generator: null, observations: [], feedbackDraft: null },
  }
}
