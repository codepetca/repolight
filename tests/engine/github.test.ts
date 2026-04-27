import { describe, expect, it, vi } from 'vitest'
import { GitHubClient } from '@/lib/engine/github'
import type { RepositoryTarget } from '@/lib/engine/types'

describe('GitHubClient', () => {
  const target: RepositoryTarget = {
    key: 'acme/app#main',
    provider: 'github',
    repoUrl: 'https://github.com/acme/app',
    owner: 'acme',
    name: 'app',
    branch: 'main',
  }

  it('normalizes commit details into analysis events and skips merge commits', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/repos/acme/app')) {
        return json({ private: false, default_branch: 'main', html_url: 'https://github.com/acme/app' })
      }
      if (url.includes('/commits?')) {
        return json([
          {
            sha: 'commit1',
            html_url: 'https://github.com/acme/app/commit/commit1',
            commit: {
              author: { email: 'alex@example.com', date: '2026-03-01T12:00:00.000Z' },
              message: 'fix login bug',
            },
            author: { login: 'alex' },
            parents: [{ sha: 'p1' }],
          },
          {
            sha: 'merge1',
            commit: {
              author: { email: 'alex@example.com', date: '2026-03-02T12:00:00.000Z' },
              message: 'Merge branch main',
            },
            author: { login: 'alex' },
            parents: [{ sha: 'p1' }, { sha: 'p2' }],
          },
        ])
      }
      if (url.includes('/commits/commit1')) {
        return json({
          sha: 'commit1',
          html_url: 'https://github.com/acme/app/commit/commit1',
          commit: {
            author: { email: 'alex@example.com', date: '2026-03-01T12:00:00.000Z' },
            message: 'fix login bug',
          },
          author: { login: 'alex' },
          parents: [{ sha: 'p1' }],
          files: [{ filename: 'src/login.ts', status: 'modified', additions: 20, deletions: 5 }],
        })
      }
      if (url.includes('/pulls?')) return json([])
      throw new Error(`Unexpected URL: ${url}`)
    }) as typeof fetch

    const client = new GitHubClient({ fetchImpl })
    const validated = await client.validatePublicRepository(target)
    const events = await client.fetchRepositoryEvents(validated, {
      startAt: '2026-03-01T00:00:00.000Z',
      endAt: '2026-03-10T00:00:00.000Z',
      timezone: 'America/Toronto',
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'commit',
      externalId: 'commit1',
      githubLogin: 'alex',
      category: 'bugfix',
    })
  })

  it('turns inaccessible repos into a readable error', async () => {
    const fetchImpl = vi.fn(async () => new Response('not found', { status: 404 })) as typeof fetch
    const client = new GitHubClient({ fetchImpl })
    await expect(client.validatePublicRepository(target)).rejects.toThrow('exists and is public')
  })
})

function json(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } })
}
