import { describe, expect, it } from 'vitest'
import { buildRepositoryReport } from '@/lib/report/build'
import { buildRuleFeedback } from '@/lib/report/rules'
import { periodFromDates, publicReportRequestSchema } from '@/lib/report/public'
import { skyHopInput } from '../../fixtures/reports/sky-hop'

describe('deterministic report feedback', () => {
  it('uses reproducible generic-message rules with commit evidence, separate from AI', () => {
    const report = buildRepositoryReport(skyHopInput())
    const feedback = buildRuleFeedback(report)
    expect(feedback.summary).toEqual({ activeDays: 6, genericMessageCount: 4, messageCount: 12, longestScheduledGap: 1 })
    const naming = feedback.observations.find(item => item.ruleId === 'generic-messages')!
    expect(naming.evidence).toHaveLength(4)
    expect(naming.text).toContain('4 of 12')
    expect(feedback.feedbackDraft).toContain('Name the specific behavior')
    expect(report.interpretation.status).toBe('not_requested')
    for (const observation of feedback.observations) for (const item of observation.evidence) expect(report.commits.some(commit => commit.sha === item.commitSha)).toBe(true)
  })
  it('flags concentrated large changes as review questions rather than authorship verdicts', () => {
    const input = skyHopInput()
    input.events = input.events.slice(0, 4).map((event, index) => ({ ...event, authoredAt: input.events[0].authoredAt, files: [{filename: 'Main.java', status:'modified', additions:index === 0 ? 1000 : 10, deletions:0}] }))
    const feedback = buildRuleFeedback(buildRepositoryReport(input))
    expect(feedback.observations.find(item => item.ruleId === 'large-change')).toMatchObject({ kind: 'review_question' })
    expect(feedback.observations.find(item => item.ruleId === 'concentration')?.text).toContain('100%')
    expect(feedback.feedbackDraft).toContain('does not establish copying or AI use')
  })
  it('suppresses missing-day and large-change claims when collection is incomplete', () => {
    const input = skyHopInput()
    const report = buildRepositoryReport({ ...input, coverage: {history:'partial',files:'partial',notes:[]}, events:input.events.slice(0, 1) })
    const feedback = buildRuleFeedback(report)
    expect(feedback.summary.longestScheduledGap).toBeNull()
    expect(feedback.observations.some(item => ['large-change','scheduled-gap'].includes(item.ruleId))).toBe(false)
    expect(feedback.feedbackDraft).toContain('provisional')
  })
  it('does not fabricate positive activity feedback for zero commits', () => {
    const feedback = buildRuleFeedback(buildRepositoryReport({...skyHopInput(), events:[], scheduledProjectDates:null}))
    expect(feedback.observations.some(item => item.kind === 'strength')).toBe(false)
    expect(feedback.feedbackDraft).toContain('not enough attributable history')
  })
})

describe('public report periods and settings', () => {
  it('converts inclusive Toronto dates across daylight saving boundaries', () => {
    expect(periodFromDates('2026-11-01','2026-11-01','America/Toronto')).toEqual({startAt:'2026-11-01T04:00:00.000Z',endAt:'2026-11-02T05:00:00.000Z',timezone:'America/Toronto'})
    expect(periodFromDates('2026-03-08','2026-03-08','America/Toronto').endAt).toBe('2026-03-09T04:00:00.000Z')
  })
  it('rejects bad dates, timezones, reversed periods and oversized settings', () => {
    expect(() => periodFromDates('2026-02-30','2026-03-02','UTC')).toThrow()
    expect(() => periodFromDates('2026-10-05','2026-10-04','UTC')).toThrow()
    expect(() => periodFromDates('2026-10-05','2026-10-06','bad/timezone')).toThrow()
    const fixture = skyHopInput()
    const valid = { repositoryUrl:fixture.repositoryUrl,githubLogins:['sample-student'], period:fixture.period,scheduledProjectDates:null,exclusions:fixture.exclusions }
    expect(publicReportRequestSchema.parse(valid).baselineReviewed).toBe(false)
    expect(publicReportRequestSchema.safeParse({...valid,githubLogins:[]}).success).toBe(false)
    expect(publicReportRequestSchema.safeParse({...valid,period:{...fixture.period,startAt:'2020-01-01T00:00:00Z'}}).success).toBe(false)
    expect(publicReportRequestSchema.safeParse({...valid,repositoryUrl:'https://example.com/repo'}).success).toBe(false)
  })
})
