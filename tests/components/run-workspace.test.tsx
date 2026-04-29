import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RunWorkspace } from '@/components/RunWorkspace'
import { createEmptySemanticBreakdown } from '@/lib/engine/categorize'
import type { RunDetail, RunResults } from '@/lib/runs/service'

describe('RunWorkspace', () => {
  it('shows encouragement feedback for the selected contributor', () => {
    render(<RunWorkspace initialRun={buildRun()} initialResults={buildResults()} />)

    expect(screen.getByRole('heading', { name: 'Feedback' })).toBeTruthy()
    expect(screen.getAllByText('Iteration Pro').length).toBeGreaterThan(0)
    expect(screen.getByText(/Repocat found 7 matching commit\(s\)/)).toBeTruthy()
    expect(screen.getByText('meaningful project impact')).toBeTruthy()
    expect(screen.getByText('visible iteration and refinement')).toBeTruthy()
    expect(screen.getAllByText(/Spread progress over more days or work sessions/).length).toBeGreaterThan(0)
  })
})

function buildRun(): RunDetail {
  return {
    id: 'run-1',
    name: 'Class Run',
    status: 'completed',
    externalSystem: null,
    externalRunKey: null,
    externalAssignmentId: null,
    externalClassroomId: null,
    externalMetadata: {},
    startAt: '2026-04-01T00:00:00.000Z',
    endAt: '2026-04-27T23:59:59.000Z',
    timezone: 'America/Toronto',
    rubric: {
      version: 'v1',
      componentWeights: { impact: 0.45, workflow: 0.35, quality: 0.2, collaboration: 0 },
      semanticWeights: {
        feature: 1,
        bugfix: 0.9,
        test: 0.8,
        refactor: 0.7,
        docs: 0.4,
        styling: 0.4,
        config: 0.2,
        generated: 0,
      },
      contributionScale: { churnDivisor: 40, minVolume: 0.25, maxVolume: 3 },
      curve: { relativeWeight: 0.35, floorPercent: 55, medianPercent: 80, excellentPercent: 96, capPercentile: 0.9 },
      gradeBands: [
        { label: 'A', minPercent: 90 },
        { label: 'B', minPercent: 80 },
        { label: 'C', minPercent: 70 },
        { label: 'D', minPercent: 60 },
        { label: 'F', minPercent: 0 },
      ],
    },
    warnings: [],
    totalRepositories: 1,
    processedRepositories: 1,
    failedRepositories: 0,
    createdAt: '2026-04-27T00:00:00.000Z',
    completedAt: '2026-04-27T00:01:00.000Z',
    repositories: [
      {
        id: 'repo-1',
        repositoryKey: 'org/repo#main',
        repoUrl: 'https://github.com/org/repo',
        owner: 'org',
        name: 'repo',
        branch: 'main',
        status: 'processed',
        warnings: [],
        lastError: null,
        processedAt: '2026-04-27T00:01:00.000Z',
      },
    ],
    contributors: [
      {
        contributorId: 'student-1',
        name: 'Alex Lee',
        githubLogin: 'alex',
        commitEmails: ['alex@example.com'],
        repositoryKeys: ['org/repo#main'],
        groupName: null,
        notes: null,
      },
    ],
  }
}

function buildResults(): RunResults {
  const run = buildRun()
  return {
    run,
    contributors: [
      {
        metrics: {
          contributorId: 'student-1',
          name: 'Alex Lee',
          githubLogin: 'alex',
          commitCount: 7,
          activeDays: 4,
          sessionCount: 5,
          burstRatio: 0.1,
          weightedContribution: 9,
          relativeContributionShare: 1,
          spreadScore: 0.6,
          iterationScore: 0.8,
          semanticBreakdown: { ...createEmptySemanticBreakdown(), feature: 5, test: 2 },
          timeline: [
            { date: '2026-04-02', weightedContribution: 3, commitCount: 2 },
            { date: '2026-04-05', weightedContribution: 6, commitCount: 5 },
          ],
          evidence: [
            { type: 'commit', id: 'abc', repositoryKey: 'org/repo#main', title: 'Add player movement' },
          ],
          areas: ['src'],
          reviewActivityCount: 0,
          impactScore: 0.9,
          workflowScore: 0.72,
          qualityScore: 0.82,
          collaborationScore: 0,
          warnings: [],
          confidence: 0.8,
        },
        grade: {
          contributorId: 'student-1',
          rawScore: 0.82,
          cohortRelativeScore: 1,
          absolutePercent: 91,
          letterGrade: 'A',
        },
      },
    ],
  }
}
