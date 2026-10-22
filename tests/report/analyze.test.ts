import { describe, expect, it, vi } from 'vitest'
import { GitHubClient } from '@/lib/engine/github'
import { makeRepositoryTarget } from '@/lib/engine/repo'
import { analyzePublicRepository } from '@/lib/report/analyze'
import { skyHopInput } from '../../fixtures/reports/sky-hop'

describe('public report analysis integration', () => {
  it('passes collected evidence through attribution, period, exclusions and deterministic rules', async () => {
    const fixture = skyHopInput()
    const client = new GitHubClient()
    const collect = vi.spyOn(client, 'collectPublicReportEvidence').mockResolvedValue({ target: makeRepositoryTarget(fixture.repositoryUrl, 'trunk')!, snapshot: { ...fixture.snapshot, kind:'analysis_time' }, events:fixture.events.map(event => ({...event,repositoryKey:'sample-student/sky-hop#trunk'})), coverage:fixture.coverage })
    const result = await analyzePublicRepository({ repositoryUrl:fixture.repositoryUrl,githubLogins:['sample-student'],period:fixture.period,scheduledProjectDates:fixture.scheduledProjectDates,exclusions:fixture.exclusions,baselineReviewed:true }, client)
    expect(collect.mock.calls[0][0].branch).toBe('')
    expect(result.report.repository.branch).toBe('trunk')
    expect(result.report.metrics.studentCommits.value).toBe(12)
    expect(result.report.interpretation.status).toBe('not_requested')
    expect(result.ruleFeedback.summary.genericMessageCount).toBe(4)
    expect(JSON.stringify(result)).not.toContain('authorEmail')
  })
  it('rejects invalid schedule settings before collecting GitHub data', async () => {
    const fixture = skyHopInput()
    const client = new GitHubClient()
    const collect = vi.spyOn(client, 'collectPublicReportEvidence')
    await expect(analyzePublicRepository({ repositoryUrl:fixture.repositoryUrl,githubLogins:['sample-student'],period:fixture.period,scheduledProjectDates:['2026-01-01'],exclusions:fixture.exclusions }, client)).rejects.toThrow('Scheduled project dates')
    expect(collect).not.toHaveBeenCalled()
  })
})
