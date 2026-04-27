import type { AnalysisEvent, AnalysisWindow, RepositoryTarget } from '@/lib/engine/types'

export function buildFixtureRepositoryEvents(target: RepositoryTarget, window: AnalysisWindow): AnalysisEvent[] {
  const start = new Date(window.startAt).getTime()
  const day = 24 * 60 * 60 * 1000
  const at = (offset: number) => new Date(start + offset * day + 14 * 60 * 60 * 1000).toISOString()

  return [
    {
      type: 'commit',
      externalId: `${target.key}:fixture-a1`,
      repositoryKey: target.key,
      title: 'implement contribution dashboard',
      authoredAt: at(1),
      githubLogin: 'alex',
      authorEmail: 'alex@example.com',
      category: 'feature',
      summary: 'feature | +64 -12',
      files: [{ filename: 'src/app/dashboard.tsx', status: 'modified', additions: 64, deletions: 12 }],
      additions: 64,
      deletions: 12,
      areas: ['src/app'],
    },
    {
      type: 'commit',
      externalId: `${target.key}:fixture-a2`,
      repositoryKey: target.key,
      title: 'add dashboard tests',
      authoredAt: at(3),
      githubLogin: 'alex',
      authorEmail: 'alex@example.com',
      category: 'test',
      summary: 'test | +24 -0',
      files: [{ filename: 'tests/dashboard.test.ts', status: 'added', additions: 24, deletions: 0 }],
      additions: 24,
      deletions: 0,
      areas: ['tests/dashboard.test.ts'],
    },
    {
      type: 'commit',
      externalId: `${target.key}:fixture-s1`,
      repositoryKey: target.key,
      title: 'fix CSV validation edge case',
      authoredAt: at(4),
      githubLogin: 'sam',
      authorEmail: 'sam@example.com',
      category: 'bugfix',
      summary: 'bugfix | +22 -6',
      files: [{ filename: 'src/lib/csv.ts', status: 'modified', additions: 22, deletions: 6 }],
      additions: 22,
      deletions: 6,
      areas: ['src/lib'],
    },
    {
      type: 'review',
      externalId: `${target.key}:fixture-r1`,
      repositoryKey: target.key,
      title: 'APPROVED on PR #7',
      authoredAt: at(5),
      githubLogin: 'alex',
      summary: 'Review activity',
    },
  ]
}
