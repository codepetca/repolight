import { describe, expect, it } from 'vitest'
import { parseClassroomAssignmentCsv } from '@/lib/classroom/csv'

describe('parseClassroomAssignmentCsv', () => {
  it('builds one student repository mapping per row', () => {
    const parsed = parseClassroomAssignmentCsv(`student_id,student_name,email,github_login,repo_url,default_branch,group
student-1,Alex Lee,alex@example.com,@alex,https://github.com/yrdsb-peths/dodge-it-solo-alex,main,Period 2
student-2,Sam Cruz,sam@example.com,sam,https://github.com/yrdsb-peths/dodge-it-solo-sam,master,Period 2`)

    expect(parsed.rows).toHaveLength(2)
    expect(parsed.contributors).toHaveLength(2)
    expect(parsed.repositories).toHaveLength(2)
    expect(parsed.rows[0]).toMatchObject({
      contributorId: 'student-1',
      name: 'Alex Lee',
      email: 'alex@example.com',
      githubLogin: 'alex',
      repository: {
        key: 'yrdsb-peths/dodge-it-solo-alex#main',
      },
    })
  })

  it('accepts contributor_name headers from analysis CSVs', () => {
    const parsed = parseClassroomAssignmentCsv(`contributor_name,github_login,repo_url
Alex Lee,alex,https://github.com/org/repo`)

    expect(parsed.contributors[0]).toMatchObject({
      contributorId: 'alex',
      name: 'Alex Lee',
      githubLogin: 'alex',
      repositoryKeys: ['org/repo#main'],
    })
  })

  it('keeps classroom assignments to one repo per student in v1', () => {
    expect(() => parseClassroomAssignmentCsv(`student_name,github_login,repo_url
Alex Lee,alex,https://github.com/org/repo-a
Alex Lee,alex,https://github.com/org/repo-b`)).toThrow('one repository per student')
  })

  it('rejects duplicate repository mappings across students', () => {
    expect(() => parseClassroomAssignmentCsv(`student_name,github_login,repo_url
Alex Lee,alex,https://github.com/org/shared-repo
Sam Cruz,sam,https://github.com/org/shared-repo`)).toThrow('same repository')
  })

  it('matches identity by commit emails when GitHub login is missing', () => {
    const parsed = parseClassroomAssignmentCsv(`student_name,commit_emails,repo_url
Alex Lee,alex@example.com; alex@users.noreply.github.com,https://github.com/org/repo`)

    expect(parsed.contributors[0]).toMatchObject({
      contributorId: 'alex-example-com',
      githubLogin: null,
      commitEmails: ['alex@example.com', 'alex@users.noreply.github.com'],
    })
  })

  it('warns and skips rows with missing identity or invalid repos', () => {
    const parsed = parseClassroomAssignmentCsv(`student_name,github_login,repo_url
Alex Lee,,https://github.com/org/valid
Sam Cruz,sam,not-a-github-repo
Rina Shah,rina,https://github.com/org/rina`)

    expect(parsed.rows).toHaveLength(1)
    expect(parsed.warnings.map((warning) => warning.code)).toEqual([
      'classroom-csv-missing-identity',
      'classroom-csv-invalid-repo',
    ])
  })
})
