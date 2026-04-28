import { describe, expect, it } from 'vitest'
import { buildAssignmentRunParsedInput } from '@/lib/classroom/analysis'

describe('buildAssignmentRunParsedInput', () => {
  it('turns assignment repositories into engine contributors and repositories', () => {
    const parsed = buildAssignmentRunParsedInput({
      repositories: [
        {
          repositoryKey: 'yrdsb-peths/dodge-it-solo-alex#main',
          repoUrl: 'https://github.com/yrdsb-peths/dodge-it-solo-alex',
          owner: 'yrdsb-peths',
          name: 'dodge-it-solo-alex',
          branch: 'main',
          student: {
            id: 'internal-student-uuid',
            externalStudentId: 'student-1',
            name: 'Alex Lee',
            email: 'alex@example.com',
            githubLogin: 'alex',
            commitEmails: ['alex@example.com'],
            groupName: 'Period 2',
            notes: 'Submitted',
          },
        },
      ],
    })

    expect(parsed.contributors).toEqual([
      {
        contributorId: 'student-1',
        name: 'Alex Lee',
        githubLogin: 'alex',
        commitEmails: ['alex@example.com'],
        repositoryKeys: ['yrdsb-peths/dodge-it-solo-alex#main'],
        groupName: 'Period 2',
        notes: 'Submitted',
      },
    ])
    expect(parsed.repositories).toEqual([
      {
        key: 'yrdsb-peths/dodge-it-solo-alex#main',
        provider: 'github',
        repoUrl: 'https://github.com/yrdsb-peths/dodge-it-solo-alex',
        owner: 'yrdsb-peths',
        name: 'dodge-it-solo-alex',
        branch: 'main',
      },
    ])
  })

  it('falls back to stable public identity fields before internal ids', () => {
    const parsed = buildAssignmentRunParsedInput({
      repositories: [
        {
          repositoryKey: 'org/repo#main',
          repoUrl: 'https://github.com/org/repo',
          owner: 'org',
          name: 'repo',
          branch: 'main',
          student: {
            id: 'internal-student-uuid',
            externalStudentId: null,
            name: 'Sam Cruz',
            email: 'sam@example.com',
            githubLogin: 'sam',
            commitEmails: [],
            groupName: null,
            notes: null,
          },
        },
      ],
    })

    expect(parsed.contributors[0]?.contributorId).toBe('sam')
  })

  it('uses email as a stable fallback when no roster id or GitHub login exists', () => {
    const parsed = buildAssignmentRunParsedInput({
      repositories: [
        {
          repositoryKey: 'org/repo#main',
          repoUrl: 'https://github.com/org/repo',
          owner: 'org',
          name: 'repo',
          branch: 'main',
          student: {
            id: 'internal-student-uuid',
            externalStudentId: null,
            name: 'No Login',
            email: 'nologin@example.com',
            githubLogin: null,
            commitEmails: ['nologin@example.com'],
            groupName: null,
            notes: null,
          },
        },
      ],
    })

    expect(parsed.contributors[0]?.contributorId).toBe('nologin@example.com')
  })
})
