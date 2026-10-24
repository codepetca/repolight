import { describe, expect, it, vi } from 'vitest'
import { skyHopInput, sampleSha } from '../../fixtures/reports/sky-hop'
import { buildPublicRepositoryBundle } from '@/lib/report/bundle-build'
import { publicRepositoryBundleSchema, publicRepositoryRequestSchema } from '@/lib/report/bundle-contract'
import { analyzePublicRepositoryBundle } from '@/lib/report/bundle-analyze'
import { GitHubClient } from '@/lib/engine/github'
import { makeRepositoryTarget } from '@/lib/engine/repo'

function input() {
  const fixture = skyHopInput()
  return { bundleRef: 'test-bundle', settings: { repositoryUrl: fixture.repositoryUrl, period: fixture.period, scheduledProjectDates: fixture.scheduledProjectDates, exclusions: fixture.exclusions, baselineReviewed: true }, evidence: { target: makeRepositoryTarget(fixture.repositoryUrl, fixture.branch)!, snapshot: fixture.snapshot, events: fixture.events, coverage: fixture.coverage } }
}

describe('contributor bundles', () => {
  it('partitions one overview into linked, unlinked and unknown buckets without guessing aliases', () => {
    const value = input()
    value.evidence.events = value.evidence.events.slice(0, 6).map((event, index) => ({ ...event, githubLogin: index < 2 ? index ? 'OTHER' : '@Sample-Student' : null, authorEmail: index < 4 ? 'private@example.test' : index === 4 ? 'second@example.test' : null }))
    const result = buildPublicRepositoryBundle(value)
    expect(result.overview.facts.metrics.commits.value).toBe(6)
    expect(result.contributors).toHaveLength(5)
    expect(result.contributors.reduce((n, entry) => n + entry.analysis.facts.commits.length, 0)).toBe(6)
    expect(result.contributors.filter(entry => entry.contributor.kind === 'unlinked_email')).toHaveLength(2)
    expect(result.contributors.find(entry => entry.contributor.kind === 'unknown_author')?.analysis.facts.commits).toHaveLength(1)
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('private@example.test')
    expect(serialized).not.toContain('second@example.test')
    expect(serialized).not.toContain('authorEmail')
    expect(serialized).not.toContain('studentCommits')
    expect(publicRepositoryBundleSchema.parse(result)).toEqual(result)
    const reordered = buildPublicRepositoryBundle({ ...value, evidence: { ...value.evidence, events: [...value.evidence.events].reverse() } })
    expect(reordered.contributors.map(entry => entry.contributor)).toEqual(result.contributors.map(entry => entry.contributor))
  })
  it.each([
    [undefined, 'not_requested'], ['', 'not_requested'], ['@SAMPLE-STUDENT', 'matched'], ['missing', 'not_found'], ['bad name/@', 'invalid'], ['!!!!', 'invalid'],
  ])('selects or falls back for %s', (githubUsername, status) => {
    const value = input()
    const result = buildPublicRepositoryBundle({ ...value, settings: { ...value.settings, githubUsername } })
    expect(result.selection.status).toBe(status)
    expect(result.selection.contributorId !== null).toBe(status === 'matched')
    expect(result.selection.notice !== null).toBe(status !== 'matched')
    expect(result.overview.facts.commits).toHaveLength(12)
  })
  it('resolves only included period evidence and preserves explicit exclusions', () => {
    const value = input()
    value.settings.exclusions = { ...value.settings.exclusions, commitShas: [sampleSha(1)] }
    value.evidence.events[0].githubLogin = 'only-excluded'
    const result = buildPublicRepositoryBundle({ ...value, settings: { ...value.settings, githubUsername: 'only-excluded' } })
    expect(result.selection.status).toBe('not_found')
    expect(result.overview.facts.commits).toHaveLength(11)
    expect(result.contributors).toHaveLength(1)
  })
  it('includes bots by default using explicit collected metadata', () => {
    const value = input()
    value.evidence.events[0].githubLogin = 'build-bot[bot]'
    const result = buildPublicRepositoryBundle({ ...value, settings: { ...value.settings, githubUsername: '@BUILD-BOT[bot]' }, evidence: { ...value.evidence, accountTypes: { [sampleSha(1)]: 'bot' as const } } })
    expect(result.contributors.find(entry => entry.contributor.githubLogin === 'build-bot[bot]')?.contributor.accountType).toBe('bot')
    expect(result.overview.facts.commits).toHaveLength(12)
    expect(result.selection.status).toBe('matched')
    value.settings.exclusions.botLogins = ['BUILD-BOT[bot]']
    expect(buildPublicRepositoryBundle(value).overview.facts.commits).toHaveLength(11)
  })
  it('preserves unavailable schedules, missing dates, baseline and partial files', () => {
    const value = input()
    value.evidence.events[0].authoredAt = undefined
    const result = buildPublicRepositoryBundle({ ...value, settings: { ...value.settings, scheduledProjectDates: null, baselineReviewed: false }, evidence: { ...value.evidence, coverage: { history: 'partial', files: 'partial', notes: ['Bounded collection.'] } } })
    expect(result.overview.facts.metrics.commits.status).toBe('partial')
    expect(result.overview.facts.metrics.commitDensity.value).toBeNull()
    expect(result.overview.facts.activity.undatedCommitCount).toBe(1)
    expect(result.overview.ruleFeedback.summary.longestScheduledGap).toBeNull()
    expect(result.overview.facts.interpretation.status).toBe('not_requested')
    expect(result.overview.ruleFeedback.observations.some(item => item.ruleId === 'large-change')).toBe(false)
  })
  it('distinguishes empty observed history and unavailable history', () => {
    const value = input()
    value.evidence.events = []
    expect(buildPublicRepositoryBundle(value).overview.facts.metrics.commits.value).toBe(0)
    expect(buildPublicRepositoryBundle({ ...value, evidence: { ...value.evidence, coverage: { history: 'unavailable', files: 'unavailable', notes: [] } } }).overview.facts.metrics.commits.value).toBeNull()
  })
  it('rejects conflicts and unsafe/dangling bundle evidence', () => {
    const value = input()
    expect(() => buildPublicRepositoryBundle({ ...value, evidence: { ...value.evidence, events: [...value.evidence.events, { ...value.evidence.events[0], title: 'conflict' }] } })).toThrow('Conflicting')
    const result = buildPublicRepositoryBundle(value)
    result.contributors[0].analysis.ruleFeedback.observations[0].evidence = [{ commitSha: sampleSha(999), path: null }]
    expect(publicRepositoryBundleSchema.safeParse(result).success).toBe(false)
  })
  it.each(['commit', 'metrics', 'rule'] as const)('rejects inconsistent %s data in an exported bundle', kind => {
    const result = buildPublicRepositoryBundle(input())
    const scope = result.contributors[0].analysis
    if (kind === 'commit') scope.facts.commits[0].message = 'Different evidence'
    if (kind === 'metrics') {
      scope.facts.metrics.commits.value!++
      scope.facts.metrics.commits.numerator!++
    }
    if (kind === 'rule') scope.ruleFeedback.observations.find(item => item.kind !== 'limitation')!.evidence = []
    expect(publicRepositoryBundleSchema.safeParse(result).success).toBe(false)
  })
  it('keeps unknown buckets stable and does not combine different unlinked email aliases', () => {
    const value = input()
    value.evidence.events = value.evidence.events.slice(0, 3).map((event, index) => ({ ...event, githubLogin: null, authorEmail: index === 0 ? null : `alias-${index}@example.test` }))
    const result = buildPublicRepositoryBundle(value)
    expect(result.contributors.filter(entry => entry.contributor.kind === 'unlinked_email')).toHaveLength(2)
    const unknownId = result.contributors.find(entry => entry.contributor.kind === 'unknown_author')!.contributor.id
    value.evidence.events.push({ ...value.evidence.events[0], externalId: sampleSha(100) })
    expect(buildPublicRepositoryBundle(value).contributors.find(entry => entry.contributor.kind === 'unknown_author')!.contributor.id).toBe(unknownId)
  })
  it('uses only dated eligible commits for period and schedule attribution and preserves uncertain exclusions', () => {
    const value = input()
    value.evidence.events = [value.evidence.events[0], { ...value.evidence.events[1], authoredAt: value.settings.period.endAt }, { ...value.evidence.events[2], type: 'review' }]
    value.settings.exclusions.pathPrefixes = ['generated/']
    value.evidence.events[0].files = [{ filename: 'generated/Output.java', status: 'added', additions: 1, deletions: 0 }]
    expect(buildPublicRepositoryBundle(value).overview.facts.commits).toHaveLength(0)
    const uncertain = buildPublicRepositoryBundle({ ...value, evidence: { ...value.evidence, coverage: { history: 'partial', files: 'partial', notes: ['Some files may be omitted.'] } } })
    expect(uncertain.overview.facts.commits).toHaveLength(1)
    expect(uncertain.overview.facts.metrics.commits.status).toBe('partial')
  })
  it('collects once and validates bounds before networking', async () => {
    const value = input()
    const client = new GitHubClient()
    const collect = vi.spyOn(client, 'collectPublicReportEvidence').mockResolvedValue({ ...value.evidence, snapshot: { ...value.evidence.snapshot, kind: 'analysis_time' } })
    await analyzePublicRepositoryBundle({ ...value.settings, githubUsername: 'nonsense !!!' }, client)
    expect(collect).toHaveBeenCalledTimes(1)
    expect(collect.mock.calls[0][0].branch).toBe('')
    await expect(analyzePublicRepositoryBundle({ ...value.settings, githubUsername: 'x'.repeat(201) }, client)).rejects.toThrow()
    expect(collect).toHaveBeenCalledTimes(1)
    expect(publicRepositoryRequestSchema.safeParse({ ...value.settings, githubLogins: ['fake'] }).success).toBe(false)
  })
})
