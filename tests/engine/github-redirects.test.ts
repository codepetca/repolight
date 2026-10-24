import { describe, expect, it, vi } from 'vitest'
import { GitHubClient } from '@/lib/engine/github'
import { makeRepositoryTarget } from '@/lib/engine/repo'

const target = makeRepositoryTarget('https://github.com/old-owner/app', 'main')!

describe('legacy GitHub redirects', () => {
  it('follows a GitHub repository rename without leaking the token to another origin', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: 'https://api.github.com/repositories/123' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ private: false, html_url: 'https://github.com/new-owner/app' })))
    const result = await new GitHubClient({ token: 'test-token', fetchImpl }).validatePublicRepository(target)
    expect(result.repoUrl).toBe('https://github.com/new-owner/app')
    expect(fetchImpl.mock.calls.map(call => call[0])).toEqual(['https://api.github.com/repos/old-owner/app', 'https://api.github.com/repositories/123'])
    for (const [, init] of fetchImpl.mock.calls) {
      expect(init.redirect).toBe('manual')
      expect(init.headers.Authorization).toBe('Bearer test-token')
    }
  })

  it.each(['https://example.test/repo', 'http://api.github.com/repos/app', 'https://api.github.com@evil.test/repo', 'https://user:password@api.github.com/repos/app'])(
    'rejects unsafe redirect %s before sending another request', async location => {
      const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location } }))
      await expect(new GitHubClient({ token: 'test-token', fetchImpl }).validatePublicRepository(target)).rejects.toThrow('Unsafe GitHub redirect')
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    },
  )

  it('bounds redirect loops', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => new Response(null, { status: 301, headers: { location: '/repositories/123' } }))
    await expect(new GitHubClient({ fetchImpl }).validatePublicRepository(target)).rejects.toThrow('redirect limit')
    expect(fetchImpl).toHaveBeenCalledTimes(6)
  })
})
