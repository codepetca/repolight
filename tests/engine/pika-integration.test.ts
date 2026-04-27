import { describe, expect, it } from 'vitest'
import { createEmptySemanticBreakdown } from '@/lib/engine/categorize'
import {
  buildPikaCreateRunInput,
  pikaCreateRunSchema,
  serializePikaResultsCsv,
  toPikaResults,
} from '@/lib/integrations/pika'
import type { RunResults } from '@/lib/runs/service'

describe('pika integration mapping', () => {
  it('builds a parsed run input from a Pika assignment payload', () => {
    const payload = pikaCreateRunSchema.parse({
      external_assignment_id: 'assignment-1',
      external_classroom_id: 'class-1',
      assignment_title: 'Dodge It Solo',
      start_at: '2026-04-01T00:00:00-04:00',
      end_at: '2026-04-27T23:59:59-04:00',
      timezone: 'America/Toronto',
      students: [
        {
          external_student_id: 'student-1',
          name: 'Alex Lee',
          github_login: '@alex',
          repo_url: 'https://github.com/yrdsb-peths/dodge-it-solo-alex',
        },
        {
          external_student_id: 'student-1',
          name: 'Alex Lee',
          commit_emails: 'alex@example.com; alex@users.noreply.github.com',
          repo_url: 'https://github.com/yrdsb-peths/dodge-it-solo-extra',
          default_branch: 'master',
        },
      ],
    })

    const input = buildPikaCreateRunInput(payload)

    expect(input.name).toBe('Dodge It Solo')
    expect(input.externalSystem).toBe('pika')
    expect(input.externalAssignmentId).toBe('assignment-1')
    expect(input.externalClassroomId).toBe('class-1')
    expect(input.externalRunKey).toContain('assignment-1')
    expect(input.parsed.repositories).toHaveLength(2)
    expect(input.parsed.contributors).toHaveLength(1)
    expect(input.parsed.contributors[0]).toMatchObject({
      contributorId: 'student-1',
      name: 'Alex Lee',
      githubLogin: 'alex',
      repositoryKeys: [
        'yrdsb-peths/dodge-it-solo-alex#main',
        'yrdsb-peths/dodge-it-solo-extra#master',
      ],
    })
    expect(input.parsed.contributors[0]?.commitEmails).toContain('alex@example.com')
  })

  it('maps Repocat metrics to Pika-friendly scores, feedback, and CSV', () => {
    const results: RunResults = {
      run: {
        id: 'run-1',
        name: 'Run',
        status: 'completed',
        externalSystem: 'pika',
        externalRunKey: 'key',
        externalAssignmentId: 'assignment-1',
        externalClassroomId: 'class-1',
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
      },
      contributors: [
        {
          metrics: {
            contributorId: 'student-1',
            name: 'Alex, Lee',
            githubLogin: 'alex',
            commitCount: 7,
            activeDays: 4,
            sessionCount: 4,
            burstRatio: 0.1,
            weightedContribution: 9,
            relativeContributionShare: 1,
            spreadScore: 0.6,
            iterationScore: 0.8,
            semanticBreakdown: createEmptySemanticBreakdown(),
            timeline: [],
            evidence: [
              { type: 'commit', id: 'abc', repositoryKey: 'github:org/repo', title: 'Add player movement' },
            ],
            areas: ['src'],
            reviewActivityCount: 0,
            impactScore: 0.9,
            workflowScore: 0.7,
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

    const mapped = toPikaResults(results)
    expect(mapped.results[0]).toMatchObject({
      external_student_id: 'student-1',
      score_completion: 90,
      score_thinking: 82,
      score_workflow: 70,
      percent: 91,
      letter: 'A',
      achievement: 'Iteration Pro',
      evidence_summary: 'Add player movement',
    })
    expect(mapped.results[0]?.feedback).toContain('7 matching commit')

    const csv = serializePikaResultsCsv(results)
    expect(csv).toContain('score_completion')
    expect(csv).toContain('"Alex, Lee"')
    expect(csv).toContain(',90,82,70,91,A,')
  })
})
