import { describe, expect, it } from 'vitest'
import { computeContributorAnalysis, computeWeightedContribution } from '@/lib/engine/metrics'
import type { AnalysisEvent, ContributorIdentity } from '@/lib/engine/types'

describe('metrics and scoring', () => {
  const identities: ContributorIdentity[] = [
    {
      contributorId: 'alex',
      name: 'Alex Lee',
      githubLogin: 'alex',
      commitEmails: ['alex@example.com'],
      repositoryKeys: ['acme/app#main'],
    },
    {
      contributorId: 'sam',
      name: 'Sam Cruz',
      githubLogin: 'sam',
      commitEmails: ['sam@example.com'],
      repositoryKeys: ['acme/app#main'],
    },
  ]

  it('computes weighted contribution using semantic weights and churn scaling', () => {
    expect(computeWeightedContribution('feature', [
      { filename: 'src/app.ts', status: 'modified', additions: 50, deletions: 10 },
    ])).toBe(1.5)
    expect(computeWeightedContribution('generated', [
      { filename: 'dist/app.js', status: 'modified', additions: 500, deletions: 20 },
    ])).toBe(0)
  })

  it('computes relative contribution, workflow metrics, grades, and evidence', () => {
    const events: AnalysisEvent[] = [
      commit('a1', 'alex', 'alex@example.com', '2026-03-01T14:00:00.000Z', 'feature', 50, 10),
      commit('a2', 'alex', 'alex@example.com', '2026-03-03T14:00:00.000Z', 'test', 20, 0),
      commit('s1', 'sam', 'sam@example.com', '2026-03-04T14:00:00.000Z', 'bugfix', 18, 5),
      {
        type: 'review',
        externalId: 'r1',
        repositoryKey: 'acme/app#main',
        title: 'APPROVED on PR #3',
        authoredAt: '2026-03-04T15:00:00.000Z',
        githubLogin: 'alex',
      },
    ]

    const analysis = computeContributorAnalysis({
      identities,
      events,
      window: {
        startAt: '2026-03-01T00:00:00.000Z',
        endAt: '2026-03-07T23:59:59.000Z',
        timezone: 'America/Toronto',
      },
    })

    expect(analysis.contributors).toHaveLength(2)
    const alex = analysis.contributors.find((item) => item.metrics.contributorId === 'alex')
    const sam = analysis.contributors.find((item) => item.metrics.contributorId === 'sam')
    expect(alex?.metrics.commitCount).toBe(2)
    expect(alex?.metrics.reviewActivityCount).toBe(1)
    expect(alex?.metrics.relativeContributionShare).toBeGreaterThan(sam?.metrics.relativeContributionShare || 0)
    expect(alex?.grade.absolutePercent).toBeGreaterThan(0)
    expect(alex?.metrics.evidence[0]?.type).toBe('review')
  })

  it('keeps empty contributors at zero percent and F', () => {
    const analysis = computeContributorAnalysis({
      identities,
      events: [],
      window: {
        startAt: '2026-03-01T00:00:00.000Z',
        endAt: '2026-03-07T23:59:59.000Z',
        timezone: 'America/Toronto',
      },
    })

    expect(analysis.contributors.every((item) => item.grade.absolutePercent === 0)).toBe(true)
    expect(analysis.contributors.every((item) => item.grade.letterGrade === 'F')).toBe(true)
  })
})

function commit(
  externalId: string,
  login: string,
  email: string,
  authoredAt: string,
  category: AnalysisEvent['category'],
  additions: number,
  deletions: number,
): AnalysisEvent {
  return {
    type: 'commit',
    externalId,
    repositoryKey: 'acme/app#main',
    title: externalId,
    authoredAt,
    githubLogin: login,
    authorEmail: email,
    category,
    files: [{ filename: `src/${externalId}.ts`, status: 'modified', additions, deletions }],
    additions,
    deletions,
    areas: ['src/app'],
  }
}
