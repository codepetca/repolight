import { describe, expect, it, vi } from 'vitest'
import { GitHubClient, GitHubCollectionError } from '@/lib/engine/github'
import { makeRepositoryTarget } from '@/lib/engine/repo'
const sha = 'a'.repeat(40), other = 'b'.repeat(40)
const target = makeRepositoryTarget('https://github.com/synthetic/app', 'main')!
function provider() {
  const calls: string[] = []
  const fetchImpl = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input)); calls.push(url.pathname)
    const value = url.pathname.endsWith('/app') ? { private: false, default_branch: 'main' }
      : url.pathname.includes('/branches/') ? { commit: { sha } }
        : url.pathname.endsWith('/commits') ? [{ sha, parents: [{ sha: other }], author: { login: 'synthetic', type: 'User' }, commit: { author: { date: '2026-10-01T12:00:00Z' }, message: 'Checkpoint' } }]
          : { sha, files: [] }
    return Response.json(value)
  })
  return { calls, fetchImpl, client: new GitHubClient({ fetchImpl }) }
}
describe('durable public collection boundaries', () => {
  it('awaits successful snapshot persistence before requesting any history', async () => {
    const { client, calls } = provider()
    let release!: () => void
    const onSnapshot = vi.fn(() => new Promise<void>(resolve => { release = resolve }))
    const pending = client.collectPublicReportEvidence(target, { onSnapshot })
    await vi.waitFor(() => expect(onSnapshot).toHaveBeenCalledOnce())
    expect(calls).toHaveLength(2)
    expect(calls.some(path => path.endsWith('/commits'))).toBe(false)
    release()
    expect((await pending).snapshot.sha).toBe(sha)
  })
  it('verifies visibility on retry and skips current branch head resolution', async () => {
    const { client, calls } = provider()
    const pinnedSnapshot = { repositoryUrl: target.repoUrl, branch: 'old-branch', sha, capturedAt: '2026-10-01T00:00:00Z', kind: 'analysis_time' as const }
    const result = await client.collectPublicReportEvidence(target, { pinnedSnapshot })
    expect(calls[0]).toBe('/repos/synthetic/app')
    expect(calls.some(path => path.includes('/branches/'))).toBe(false)
    expect(result.target.branch).toBe('old-branch')
    expect(result.snapshot.capturedAt).toBe(pinnedSnapshot.capturedAt)
  })
  it('stops before history if snapshot persistence fails', async () => {
    const { client, calls } = provider()
    await expect(client.collectPublicReportEvidence(target, { onSnapshot: async () => { throw new Error('lease lost') } })).rejects.toThrow('lease lost')
    expect(calls).toHaveLength(2)
  })
  it('bounds declared and streamed JSON sizes without leaking response bodies', async () => {
    const declared = new GitHubClient({ fetchImpl: vi.fn(async () => new Response('secret', { headers: { 'content-length': '9000000' } })) })
    await expect(declared.collectPublicReportEvidence(target)).rejects.toMatchObject({ code: 'collection_limit', retryable: false })
    const streamed = new GitHubClient({ fetchImpl: vi.fn(async () => new Response('secret-secret-secret')) })
    await expect(streamed.collectPublicReportEvidence(target, { maxResponseBytes: 4 })).rejects.toMatchObject({ code: 'collection_limit' })
    const total = provider()
    await expect(total.client.collectPublicReportEvidence(target, { maxTotalBytes: 45 })).rejects.toMatchObject({ code: 'collection_limit' })
  })
  it('propagates cancellation and classifies upstream errors without string guessing', async () => {
    const controller = new AbortController(); controller.abort()
    const { client, calls } = provider()
    await expect(client.collectPublicReportEvidence(target, { signal: controller.signal })).rejects.toBeInstanceOf(GitHubCollectionError)
    expect(calls).toHaveLength(0)
    for (const [status, code, retryable] of [[429, 'upstream_rate_limited', true], [503, 'upstream_unavailable', true], [404, 'repository_unavailable', false]] as const) {
      const failing = new GitHubClient({ fetchImpl: vi.fn(async () => new Response('secret token text', { status })) })
      await expect(failing.collectPublicReportEvidence(target)).rejects.toMatchObject({ code, retryable })
    }
  })
})
