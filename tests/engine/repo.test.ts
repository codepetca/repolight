import { describe, expect, it } from 'vitest'
import { categorizeChange } from '@/lib/engine/categorize'
import { makeRepositoryTarget, normalizeCommitEmails, parseGitHubRepoReference } from '@/lib/engine/repo'

describe('repo utilities', () => {
  it('parses GitHub URLs, SSH URLs, and owner/name shorthand', () => {
    expect(parseGitHubRepoReference('https://github.com/openai/openai-node')).toMatchObject({
      owner: 'openai',
      name: 'openai-node',
      normalizedUrl: 'https://github.com/openai/openai-node',
    })
    expect(parseGitHubRepoReference('git@github.com:openai/openai-node.git')).toMatchObject({
      owner: 'openai',
      name: 'openai-node',
    })
    expect(parseGitHubRepoReference('openai/openai-node')).toMatchObject({
      owner: 'openai',
      name: 'openai-node',
    })
    expect(parseGitHubRepoReference('not a repo')).toBeNull()
  })

  it('creates stable repository keys with branch names', () => {
    expect(makeRepositoryTarget('https://github.com/acme/app', 'develop')).toMatchObject({
      key: 'acme/app#develop',
      branch: 'develop',
    })
  })

  it('normalizes commit emails', () => {
    expect(normalizeCommitEmails([' A@Example.com ', 'a@example.com', 'b@example.com'])).toEqual([
      'a@example.com',
      'b@example.com',
    ])
  })

  it('categorizes obvious test and bugfix changes', () => {
    expect(categorizeChange('add regression test for login', [
      { filename: 'tests/api/login.test.ts', status: 'modified', additions: 12, deletions: 0 },
    ])).toEqual({ category: 'test', ambiguous: false })

    expect(categorizeChange('fix classroom roster bug', [
      { filename: 'src/app/api/teacher/classrooms/route.ts', status: 'modified', additions: 12, deletions: 4 },
    ])).toEqual({ category: 'bugfix', ambiguous: false })
  })
})
