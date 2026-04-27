import { describe, expect, it } from 'vitest'
import { serializeResultsCsv } from '@/lib/engine/export'
import { createEmptySemanticBreakdown } from '@/lib/engine/categorize'

describe('serializeResultsCsv', () => {
  it('escapes CSV cells and includes grade fields', () => {
    const csv = serializeResultsCsv([
      {
        metrics: {
          contributorId: 'alex',
          name: 'Alex, Lee',
          githubLogin: 'alex',
          commitCount: 2,
          activeDays: 2,
          sessionCount: 2,
          burstRatio: 0,
          weightedContribution: 3,
          relativeContributionShare: 1,
          spreadScore: 0.5,
          iterationScore: 0.5,
          semanticBreakdown: createEmptySemanticBreakdown(),
          timeline: [],
          evidence: [],
          areas: ['src/app'],
          reviewActivityCount: 0,
          impactScore: 1,
          workflowScore: 0.5,
          qualityScore: 0.5,
          collaborationScore: 0,
          warnings: [],
          confidence: 0.9,
        },
        grade: {
          contributorId: 'alex',
          rawScore: 0.7,
          cohortRelativeScore: 0.8,
          absolutePercent: 85,
          letterGrade: 'B',
        },
      },
    ])

    expect(csv).toContain('letter_grade')
    expect(csv).toContain('"Alex, Lee"')
    expect(csv).toContain(',B,85,')
  })
})
