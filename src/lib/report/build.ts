import { normalizeCommitEmails, normalizeGitHubLogin, makeRepositoryTarget } from '@/lib/engine/repo'
import { formatDayInZone, round } from '@/lib/engine/time'
import { METRICS_VERSION, REPORT_VERSION, reportBuildInputSchema, repositoryReportSchema, type MetricStatus, type RepositoryReport } from '@/lib/report/contract'

/** Pure report construction from collected evidence. No grading, AI, database or network calls. */
export function buildRepositoryReport(rawInput: unknown): RepositoryReport {
  const input = reportBuildInputSchema.parse(rawInput)
  const target = makeRepositoryTarget(input.repositoryUrl, input.branch)!
  const notes = [...input.coverage.notes]
  const logins = new Set(input.identity.githubLogins.map(normalizeGitHubLogin).filter((login): login is string => login !== null))
  const emails = new Set(normalizeCommitEmails(input.identity.commitEmails))
  const attributionConfigured = logins.size > 0 || emails.size > 0
  const bots = new Set(input.exclusions.botLogins.map(normalizeGitHubLogin).filter((login): login is string => login !== null))
  const excludedShas = new Set(input.exclusions.commitShas)
  const start = Date.parse(input.period.startAt), end = Date.parse(input.period.endAt)
  const schedule = input.scheduledProjectDates === null ? null : [...new Set(input.scheduledProjectDates)].sort()
  const scheduleSet = new Set(schedule || [])
  // Only dates whose local day intersects this report period can enter the denominator.
  const firstDate = formatDayInZone(input.period.startAt, input.period.timezone)
  const lastDate = formatDayInZone(new Date(end - 1).toISOString(), input.period.timezone)
  if (schedule?.some(day => day < firstDate || day > lastDate)) throw new Error('Scheduled project dates must fall within the report period.')
  if (input.baseline.status !== 'applied') notes.push('Starter baseline is not applied; supplied code may remain in observed changes.')
  if (!attributionConfigured) notes.push('Student identity is not configured; repository commits are not labeled student work.')

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
  let undatedCommitCount = 0
  let missingFileEvidence = input.coverage.files !== 'complete'
  const commits: RepositoryReport['commits'] = []
  const excludedPath = (path: string) => input.exclusions.pathPrefixes.some(prefix => path === prefix || path.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`))
  for (const event of bySha.values()) {
    const login = normalizeGitHubLogin(event.githubLogin)
    if (excludedShas.has(event.externalId) || (login !== null && bots.has(login))) continue
    if (event.authoredAt && (Date.parse(event.authoredAt) < start || Date.parse(event.authoredAt) >= end)) continue
    const matching = (login !== null && logins.has(login)) || (event.authorEmail && emails.has(event.authorEmail.trim().toLowerCase()))
    if (!attributionConfigured || !matching) { unmatchedCommitCount++; continue }
    const hasFiles = input.coverage.files !== 'unavailable' && event.files !== undefined
    if (!hasFiles) missingFileEvidence = true
    const files = hasFiles ? event.files!.filter(file => !excludedPath(file.filename)).map(file => ({ path: file.filename, status: file.status, additions: file.additions, deletions: file.deletions })) : []
    if (hasFiles && event.files!.length > 0 && files.length === 0) continue
    if (!event.authoredAt) undatedCommitCount++
    if (new Set(files.map(file => file.path)).size !== files.length) throw new Error('Duplicate file evidence in a commit.')
    commits.push({
      sha: event.externalId, message: event.title, authoredAt: event.authoredAt ? new Date(event.authoredAt).toISOString() : null,
      githubLogin: login, url: `${target.repoUrl}/commit/${event.externalId}`,
      additions: hasFiles ? files.reduce((sum, file) => sum + file.additions, 0) : null,
      deletions: hasFiles ? files.reduce((sum, file) => sum + file.deletions, 0) : null, files,
    })
  }
  commits.sort((a, b) => (a.authoredAt || '').localeCompare(b.authoredAt || '') || a.sha.localeCompare(b.sha))
  const timelineMap = new Map<string, string[]>()
  for (const commit of commits) if (commit.authoredAt) {
    const day = formatDayInZone(commit.authoredAt, input.period.timezone)
    timelineMap.set(day, [...(timelineMap.get(day) || []), commit.sha])
  }
  const timeline = [...timelineMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, commitShas]) => ({ date, commitShas, commitCount: commitShas.length }))
  const n = commits.length
  const historyUnavailable = input.coverage.history === 'unavailable' || !attributionConfigured
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
  if (undatedCommitCount) notes.push(`${undatedCommitCount} matched commit(s) have no author date; period membership and day distribution cannot be fully verified.`)
  if (missingFileEvidence) notes.push('File-change evidence is incomplete; absent heatmap cells must not be interpreted as zero changes.')
  const report: RepositoryReport = {
    schemaVersion: REPORT_VERSION, metricsVersion: METRICS_VERSION, reportRef: input.reportRef, studentRef: input.studentRef,
    repository: { url: target.repoUrl, branch: input.branch, visibility: 'public' }, snapshot: input.snapshot,
    period: input.period, scheduledProjectDates: schedule, baseline: input.baseline, exclusions: input.exclusions,
    coverage: { history: input.coverage.history, files: missingFileEvidence && input.coverage.files === 'complete' ? 'partial' : input.coverage.files, notes: [...new Set(notes)] },
    attribution: { status: attributionConfigured ? 'matched' : 'not_configured', unmatchedCommitCount },
    metrics: {
      studentCommits: metric(n, n, null, undatedCommitCount && countStatus === 'available' ? 'partial' : countStatus),
      commitDensity: metric(scheduleAvailable ? round(n / schedule!.length) : null, n, schedule?.length ?? null, scheduleAvailable ? timeStatus : 'unavailable', scheduleAvailable ? null : 'Scheduled project dates are missing or empty.'),
      scheduledDayCoverage: metric(scheduleAvailable ? round(scheduledActiveDays / schedule!.length) : null, scheduledActiveDays, schedule?.length ?? null, scheduleAvailable ? timeStatus : 'unavailable', scheduleAvailable ? null : 'Scheduled project dates are missing or empty.'),
      busiestDayShare: metric(n ? round(busiestCount / n) : null, busiestCount, n, n ? timeStatus : 'unavailable', n ? null : 'No attributable commits are available.'),
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
  return repositoryReportSchema.parse(report)
}
