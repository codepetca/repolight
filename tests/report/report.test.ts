import { describe, expect, it } from 'vitest'
import { buildRepositoryReport } from '@/lib/report/build'
import { repositoryReportSchema } from '@/lib/report/contract'
import { sampleSha, skyHopInput } from '../../fixtures/reports/sky-hop'

describe('report contract v2', () => {
  it('reproduces the designed report from existing normalized engine events', () => {
    const report = buildRepositoryReport(skyHopInput())
    expect(report.schemaVersion).toBe('2.0')
    expect(report.metrics.studentCommits).toMatchObject({ status: 'available', value: 12 })
    expect(report.metrics.commitDensity).toMatchObject({ value: 1.3333, numerator: 12, denominator: 9 })
    expect(report.metrics.scheduledDayCoverage).toMatchObject({ value: 0.6667, numerator: 6, denominator: 9 })
    expect(report.metrics.busiestDayShare).toMatchObject({ value: 0.25, numerator: 3, denominator: 12 })
    expect(report.timeline).toHaveLength(6)
    expect(report.heatmap.files).toHaveLength(7)
    expect(report.heatmap.cells.find(cell => cell.commitSha === sampleSha(4) && cell.path === 'Pipe.java')).toMatchObject({ additions: 130, deletions: 0 })
    expect(report.pushActivity.status).toBe('unavailable')
    expect(report.interpretation.status).toBe('not_requested')
    expect(repositoryReportSchema.parse(report)).toEqual(report)
  })

  it('deduplicates commit SHAs and excludes other authors, reviews and out-of-window commits', () => {
    const input = skyHopInput()
    input.events.push(structuredClone(input.events[0]))
    input.events.push({ ...input.events[0], externalId: sampleSha(20), githubLogin: 'other' })
    input.events.push({ ...input.events[0], externalId: sampleSha(21), authoredAt: input.period.endAt })
    input.events.push({ ...input.events[0], type: 'review', externalId: 'review-1' })
    const report = buildRepositoryReport(input)
    expect(report.metrics.studentCommits.value).toBe(12)
    expect(report.attribution.unmatchedCommitCount).toBe(1)
    expect(report.commits).toHaveLength(12)
  })

  it('distinguishes missing schedules and zero scheduled days from zero activity', () => {
    for (const dates of [null, []]) {
      const report = buildRepositoryReport({ ...skyHopInput(), scheduledProjectDates: dates })
      expect(report.metrics.studentCommits.value).toBe(12)
      expect(report.metrics.commitDensity).toMatchObject({ status: 'unavailable', value: null })
      expect(report.metrics.scheduledDayCoverage.value).toBeNull()
    }
    const empty = buildRepositoryReport({ ...skyHopInput(), events: [] })
    expect(empty.metrics.studentCommits.value).toBe(0)
    expect(empty.metrics.commitDensity.value).toBe(0)
    expect(empty.metrics.scheduledDayCoverage.value).toBe(0)
    expect(empty.metrics.busiestDayShare).toMatchObject({ status: 'unavailable', value: null })
  })

  it('separates home/weekend activity from scheduled-day coverage in the supplied timezone', () => {
    const input = skyHopInput()
    input.events = [{ ...input.events[0], authoredAt: '2026-10-11T02:00:00Z' }]
    const report = buildRepositoryReport(input)
    expect(report.timeline[0].date).toBe('2026-10-10')
    expect(report.activity.outsideScheduleCommitCount).toBe(1)
    expect(report.metrics.scheduledDayCoverage.value).toBe(0)
    expect(report.metrics.commitDensity.value).toBe(0.1111)
  })

  it('excludes supplied history, bots and generated-only changes while retaining edits to starter files', () => {
    const input = skyHopInput()
    input.exclusions = { commitShas: [sampleSha(1)], botLogins: ['sample-bot'], pathPrefixes: ['generated/'] }
    input.events[1].githubLogin = 'sample-bot'
    input.events[2].files = [{ filename: 'generated/App.java', status: 'modified', additions: 999, deletions: 0 }]
    input.events[3].files!.push({ filename: 'generated/Output.java', status: 'added', additions: 500, deletions: 0 })
    const report = buildRepositoryReport(input)
    expect(report.metrics.studentCommits.value).toBe(9)
    expect(report.commits.find(c => c.sha === sampleSha(4))?.additions).toBe(220)
    expect(report.heatmap.files).not.toContain('generated/Output.java')
    expect(report.commits.find(c => c.sha === sampleSha(8))?.files.some(f => f.path === 'Main.java')).toBe(true)
  })

  it('marks partial evidence and unknown dates without manufacturing completeness', () => {
    const input = skyHopInput()
    delete input.events[0].authoredAt
    const report = buildRepositoryReport({ ...input, coverage: { history: 'partial', files: 'partial', notes: ['Collector limit reached'] } })
    expect(report.metrics.studentCommits.status).toBe('partial')
    expect(report.metrics.scheduledDayCoverage.status).toBe('partial')
    expect(report.heatmap.status).toBe('partial')
    expect(report.activity.undatedCommitCount).toBe(1)
    expect(report.coverage.notes).toContain('Collector limit reached')
    expect(report.commits).toHaveLength(12)
  })

  it('keeps unavailable collection distinct from a verified empty repository', () => {
    const report = buildRepositoryReport({ ...skyHopInput(), events: [], coverage: { history: 'unavailable', files: 'unavailable', notes: ['GitHub unavailable'] } })
    expect(report.metrics.studentCommits).toMatchObject({ status: 'unavailable', value: null })
    expect(report.metrics.commitDensity.value).toBeNull()
    expect(report.heatmap.status).toBe('unavailable')
  })

  it('does not claim student attribution without declared matching identities', () => {
    const report = buildRepositoryReport({ ...skyHopInput(), identity: { githubLogins: [], commitEmails: [] } })
    expect(report.metrics.studentCommits.value).toBeNull()
    expect(report.attribution.unmatchedCommitCount).toBe(12)
    expect(report.commits).toEqual([])
  })

  it('rejects invalid dates, unsafe repository URLs, invalid timezone and conflicting duplicate evidence', () => {
    const input = skyHopInput()
    for (const repositoryUrl of ['http://github.com/a/b', 'https://evilgithub.com/a/b', 'https://github.com/a/b?token=secret', 'https://user:pass@github.com/a/b']) {
      expect(() => buildRepositoryReport({ ...input, repositoryUrl })).toThrow()
    }
    expect(() => buildRepositoryReport({ ...input, scheduledProjectDates: ['2026-02-30'] })).toThrow()
    expect(() => buildRepositoryReport({ ...input, period: { ...input.period, timezone: 'Not/AZone' } })).toThrow()
    expect(() => buildRepositoryReport({ ...input, period: { ...input.period, endAt: input.period.startAt } })).toThrow()
    expect(() => buildRepositoryReport({ ...input, events: [...input.events, { ...input.events[0], title: 'different evidence' }] })).toThrow()
  })

  it('rejects unsupported scores and unresolved AI citations at the contract boundary', () => {
    const report = buildRepositoryReport(skyHopInput())
    expect(() => repositoryReportSchema.parse({ ...report, aiAuthorshipPercent: 90 })).toThrow()
    expect(() => repositoryReportSchema.parse({ ...report, gradeSuggestion: 'A' })).toThrow()
    expect(() => repositoryReportSchema.parse({ ...report, interpretation: {
      status: 'available', generator: { provider: 'example', model: 'example', promptVersion: '1' },
      observations: [{ id: 'o1', kind: 'improvement', text: 'Improve this', evidence: [{ commitSha: sampleSha(999), path: null }] }], feedbackDraft: null,
    } })).toThrow()
  })

  it('strips private commit emails from the report and normalizes identity matching', () => {
    const input = skyHopInput()
    input.identity = { githubLogins: ['@SAMPLE-STUDENT'], commitEmails: ['private@example.test'] }
    input.events[0].authorEmail = 'private@example.test'
    const report = buildRepositoryReport(input)
    expect(report.metrics.studentCommits.value).toBe(12)
    expect(JSON.stringify(report)).not.toContain('private@example.test')
  })

  it('orders instants chronologically across offsets and retains inspectable exclusions', () => {
    const input = skyHopInput()
    input.events = [
      { ...input.events[0], authoredAt: '2026-10-05T09:00:00-04:00' },
      { ...input.events[1], authoredAt: '2026-10-05T12:00:00Z' },
    ]
    const report = buildRepositoryReport(input)
    expect(report.commits.map(c => c.sha)).toEqual([sampleSha(2), sampleSha(1)])
    expect(report.exclusions).toEqual(input.exclusions)
  })

  it('validates file-level interpretation citations without introducing grading fields', () => {
    const report = buildRepositoryReport(skyHopInput())
    const interpretation = {
      status: 'available', generator: { provider: 'example', model: 'example', promptVersion: '1' },
      observations: [{ id: 'o1', kind: 'review_question', text: 'Explain this collision implementation.', evidence: [{ commitSha: sampleSha(4), path: 'Collision.java' }] }],
      feedbackDraft: { text: 'Walk through your collision implementation.', observationIds: ['o1'] },
    }
    expect(repositoryReportSchema.safeParse({ ...report, interpretation }).success).toBe(true)
    interpretation.observations[0].evidence[0].path = 'Missing.java'
    expect(repositoryReportSchema.safeParse({ ...report, interpretation }).success).toBe(false)
  })

  it('retains uncertain mixed commits when a partial file list only shows excluded files', () => {
    const input = skyHopInput()
    input.events = [{ ...input.events[0], files: [{ filename: 'generated/Output.java', status: 'added', additions: 100, deletions: 0 }] }]
    input.exclusions.pathPrefixes = ['generated/']
    const report = buildRepositoryReport({ ...input, coverage: { history: 'complete', files: 'partial', notes: ['File list truncated'] } })
    expect(report.metrics.studentCommits).toMatchObject({ value: 1, status: 'partial' })
    expect(report.commits).toHaveLength(1)
    expect(report.heatmap.status).toBe('partial')
  })

  it('does not manufacture a day distribution when every commit lacks a date', () => {
    const input = skyHopInput()
    input.events = [{ ...input.events[0], authoredAt: undefined }]
    const report = buildRepositoryReport(input)
    expect(report.metrics.studentCommits).toMatchObject({ value: 1, status: 'partial' })
    expect(report.metrics.busiestDayShare).toMatchObject({ value: null, status: 'unavailable' })
    expect(report.metrics.scheduledDayCoverage).toMatchObject({ value: null, status: 'unavailable' })
  })

  it('rejects impossible serialized ratios and inconsistent numerators/denominators', () => {
    const report = buildRepositoryReport(skyHopInput())
    const invalidMetrics = [
      ['scheduledDayCoverage', { status: 'available', value: 2, numerator: 18, denominator: 9, reason: null }],
      ['busiestDayShare', { status: 'available', value: 1.1, numerator: 11, denominator: 10, reason: null }],
      ['scheduledDayCoverage', { status: 'available', value: 0, numerator: 0, denominator: 0, reason: null }],
      ['scheduledDayCoverage', { status: 'partial', value: 0.5, numerator: 6, denominator: 9, reason: 'Partial evidence' }],
      ['commitDensity', { status: 'available', value: 1.5, numerator: 12, denominator: 9, reason: null }],
      ['studentCommits', { status: 'available', value: 1.5, numerator: 1, denominator: null, reason: null }],
    ] as const
    for (const [key, value] of invalidMetrics) {
      expect(repositoryReportSchema.safeParse({ ...report, metrics: { ...report.metrics, [key]: value } }).success).toBe(false)
    }
  })
})
