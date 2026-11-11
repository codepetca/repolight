import { afterEach, describe, expect, it, vi } from 'vitest'
import { GitHubClient } from '@/lib/engine/github'
import { analyzePublicRepository } from '@/lib/report/analyze'
import { buildPublicRepositoryBundle } from '@/lib/report/bundle-build'
import type { RepositoryTarget } from '@/lib/engine/types'

const target: RepositoryTarget = { key: 'acme/app#main', provider: 'github', owner: 'acme', name: 'app', branch: 'main', repoUrl: 'https://github.com/acme/app' }
const sha = (n: number) => n.toString(16).padStart(40, '0')
function commit(n: number, extra = {}) {
  return { sha: sha(n), commit: { author: { email: 'a@example.com', date: '2026-10-01T12:00:00Z' }, message: 'build feature' }, parents: [{ sha: sha(n + 1) }], author: { login: 'alice' }, ...extra }
}
const file = (n: number) => ({ filename: `src/file-${n}.ts`, additions: 2, deletions: 1, status: 'modified' })
function json(value: unknown, next = false) {
  return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json', ...(next ? { link: '<https://api.github.com/ignored>; rel="next"' } : {}) } })
}
function fixture(handle?: (url: URL, init?: RequestInit) => Response | Promise<Response | undefined> | undefined, opts = {}) {
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    const custom = await handle?.(url, init)
    if (custom) return custom
    if (url.pathname === '/repos/acme/app') return json({ private: false, default_branch: 'main' })
    if (url.pathname === '/repos/acme/app/branches/main') return json({ commit: { sha: sha(1) } })
    if (url.pathname === '/repos/acme/app/commits') return json([commit(1)])
    const id = url.pathname.split('/').at(-1)!
    return json({ ...commit(parseInt(id, 16)), files: [file(1)] })
  }) as unknown as typeof fetch
  return { client: new GitHubClient({ fetchImpl, ...opts }), fetchImpl: vi.mocked(fetchImpl) }
}

afterEach(() => vi.useRealTimers())

describe('public report evidence collector', () => {
  it('retains explicit account types separately without adding identity data to events', async () => {
    const { client } = fixture(url => url.pathname.endsWith('/commits') ? json([commit(1, { author: { login: 'build-bot', type: 'Bot' } })]) : undefined)
    const report = await client.collectPublicReportEvidence(target)
    expect(report.accountTypes).toEqual({ [sha(1)]: 'bot' })
    expect(report.events[0]).not.toHaveProperty('authorType')
    expect(report.events[0]).not.toHaveProperty('authorName')
  })

  it('pins the branch head once and paginates history without timestamp filters or early stops', async () => {
    const first = Array.from({ length: 100 }, (_, n) => commit(n + 1))
    first[0].commit.author.date = '2001-01-01T00:00:00Z'
    const { client, fetchImpl } = fixture((url) => {
      if (url.pathname.endsWith('/commits')) return url.searchParams.get('page') === '1' ? json(first, true) : json([commit(101)])
    })
    const report = await client.collectPublicReportEvidence({ ...target, branch: '' })
    expect(report.target.branch).toBe('main')
    expect(report.target.key).toBe('acme/app#main')
    expect(report.snapshot).toMatchObject({ sha: sha(1), kind: 'analysis_time' })
    expect(Number.isFinite(Date.parse(report.snapshot.capturedAt))).toBe(true)
    expect(report.events).toHaveLength(101)
    expect(report.coverage).toMatchObject({ history: 'complete', files: 'complete' })
    const calls = fetchImpl.mock.calls.map(([input]) => new URL(String(input)))
    expect(calls.filter((url) => url.pathname.includes('/branches/'))).toHaveLength(1)
    for (const url of calls.filter((url) => url.pathname.endsWith('/commits'))) {
      expect(url.searchParams.get('sha')).toBe(sha(1))
      expect(url.searchParams.has('since')).toBe(false)
      expect(url.searchParams.has('until')).toBe(false)
    }
  })

  it('recomputes repository identity after resolving a different default branch', async () => {
    const { client } = fixture((url) => {
      if (url.pathname === '/repos/acme/app') return json({ private: false, default_branch: 'trunk' })
      if (url.pathname === '/repos/acme/app/branches/trunk') return json({ commit: { sha: sha(1) } })
    })
    const report = await client.collectPublicReportEvidence({ ...target, branch: '' })
    expect(report.target.key).toBe('acme/app#trunk')
    expect(report.events[0].repositoryKey).toBe('acme/app#trunk')
  })

  it('uses parent count, retaining a nonmerge with a Merge-prefixed message', async () => {
    const { client, fetchImpl } = fixture((url) => url.pathname.endsWith('/commits') ? json([
      commit(1, { commit: { author: { date: '2026-10-01T00:00:00Z' }, message: 'Merge puzzle implementation' } }),
      commit(2, { parents: [{ sha: sha(3) }, { sha: sha(4) }] }),
    ]) : undefined)
    const report = await client.collectPublicReportEvidence(target)
    expect(report.events.map((event) => event.title)).toEqual(['Merge puzzle implementation'])
    expect(fetchImpl.mock.calls.some(([url]) => String(url).includes(`/commits/${sha(2)}`))).toBe(false)
  })

  it('preserves the omitted merge count and merge-resolution limitation in the final report', async () => {
    const { client } = fixture(url => url.pathname.endsWith('/commits') ? json([commit(1, {parents:[{sha:sha(2)},{sha:sha(3)}]})]) : undefined)
    const result = await analyzePublicRepository({repositoryUrl:target.repoUrl,branch:'main',githubLogins:['alice'],baselineReviewed:true,period:{startAt:'2026-10-01T00:00:00Z',endAt:'2026-10-02T00:00:00Z',timezone:'UTC'},scheduledProjectDates:['2026-10-01'],exclusions:{commitShas:[],pathPrefixes:[],botLogins:[]}},client)
    expect(result.report.metrics.studentCommits.value).toBe(0)
    expect(result.report.coverage.notes.join(' ')).toContain('1 merge commit(s) omitted')
    expect(result.report.coverage.notes.join(' ')).toContain('merge-resolution-only changes are not assessed')
    expect(result.report.coverage.notes.join(' ')).toContain('complete coverage refers to this non-merge scope')
  })

  it('collects file pages from the commit SHA and normalizes all file evidence', async () => {
    const { client } = fixture((url) => {
      if (url.pathname.endsWith(`/commits/${sha(1)}`)) return json({ ...commit(1), files: url.searchParams.get('page') === '1' ? [file(1)] : [file(2)] }, url.searchParams.get('page') === '1')
    })
    const report = await client.collectPublicReportEvidence(target)
    expect(report.events[0]).toMatchObject({ additions: 4, deletions: 2, authorEmail: 'a@example.com', githubLogin: 'alice' })
    expect(report.events[0].files).toHaveLength(2)
    expect(report.coverage.files).toBe('complete')
  })

  it('collects more than 250 commits and preserves contributor identities across pages', async () => {
    const { client, fetchImpl } = fixture((url) => {
      if (url.pathname.endsWith('/commits')) {
        const page = Number(url.searchParams.get('page'))
        const count = page === 5 ? 1 : 100
        return json(Array.from({ length: count }, (_, n) => commit((page - 1) * 100 + n + 1, { author: { login: page === 5 ? 'bob' : 'alice', type: 'User' } })), page < 5)
      }
    })
    const report = await client.collectPublicReportEvidence(target)
    expect(report.events).toHaveLength(401)
    expect(report.events[400].githubLogin).toBe('bob')
    expect(report.accountTypes?.[sha(401)]).toBe('user')
    const bundle = buildPublicRepositoryBundle({ bundleRef: 'test', evidence: report, settings: { repositoryUrl: target.repoUrl, branch: 'main', baselineReviewed: true, period: { startAt: '2026-10-01T00:00:00Z', endAt: '2026-10-02T00:00:00Z', timezone: 'UTC' }, scheduledProjectDates: ['2026-10-01'], exclusions: { commitShas: [], pathPrefixes: [], botLogins: [] } } })
    expect(bundle.overview.facts.commits).toHaveLength(401)
    expect(bundle.contributors.find(item => item.contributor.githubLogin === 'bob')?.analysis.facts.commits).toHaveLength(1)
    expect(Buffer.byteLength(JSON.stringify(bundle))).toBeLessThan(8_000_000)
    expect(report.coverage).toMatchObject({ history: 'complete', files: 'complete' })
    expect(fetchImpl).toHaveBeenCalledTimes(408)
  })

  it('caps total scanned commits including merges at 500 and reports partial history', async () => {
    const { client, fetchImpl } = fixture((url) => {
      if (url.pathname.endsWith('/commits')) {
        const page = Number(url.searchParams.get('page'))
        return json(Array.from({ length: 100 }, (_, n) => commit((page - 1) * 100 + n + 1, { parents: [{ sha: sha(500) }, { sha: sha(501) }] })), true)
      }
    })
    const report = await client.collectPublicReportEvidence(target)
    expect(report.events).toHaveLength(0)
    expect(report.coverage.history).toBe('partial')
    expect(report.coverage.notes.join(' ')).toContain('500')
    expect(fetchImpl).toHaveBeenCalledTimes(7)
  })

  it.each([true, false])('classifies a full terminal 500th entry with pagination metadata %s', async (metadata) => {
    const { client, fetchImpl } = fixture(url => {
      if (url.pathname.endsWith('/commits')) {
        const page = Number(url.searchParams.get('page'))
        const entries = Array.from({ length: 100 }, (_, n) => commit((page - 1) * 100 + n + 1, { parents: [{ sha: sha(501) }, { sha: sha(502) }] }))
        if (page < 5) return json(entries, true)
        return new Response(JSON.stringify(entries), { headers: metadata ? { link: '<https://api.github.com/previous>; rel="prev", <https://api.github.com/first>; rel="first"' } : {} })
      }
    })
    const report = await client.collectPublicReportEvidence(target)
    expect(report.coverage.history).toBe(metadata ? 'complete' : 'partial')
    expect(fetchImpl).toHaveBeenCalledTimes(7)
  })

  it('reports partial history when five short pages still advertise more', async () => {
    const { client, fetchImpl } = fixture(url => url.pathname.endsWith('/commits')
      ? json([commit(Number(url.searchParams.get('page')))], true) : undefined)
    const report = await client.collectPublicReportEvidence(target)
    expect(report.events).toHaveLength(5)
    expect(report.coverage.history).toBe('partial')
    expect(report.coverage.notes.join(' ')).toContain('five-page')
    expect(fetchImpl).toHaveBeenCalledTimes(12)
  })

  it.each(['missing', 'failed', 'wrong-sha'])('retains commits with undefined files when details are %s', async (mode) => {
    const { client } = fixture((url) => {
      if (url.pathname.includes('/commits/')) {
        if (mode === 'failed') return new Response('upstream secret text', { status: 500 })
        if (mode === 'wrong-sha') return json({ ...commit(2), files: [file(1)] })
        return json(commit(1))
      }
    })
    const report = await client.collectPublicReportEvidence(target)
    expect(report.events).toHaveLength(1)
    expect(report.events[0].externalId).toBe(sha(1))
    expect(report.events[0].files).toBeUndefined()
    expect(report.events[0].additions).toBeUndefined()
    expect(report.coverage.files).toBe('partial')
    expect(report.coverage.notes.join(' ')).not.toContain('upstream secret text')
  })

  it('discards partial accumulated pages after a later detail failure', async () => {
    const { client } = fixture((url) => {
      if (url.pathname.includes('/commits/')) return url.searchParams.get('page') === '1' ? json({ ...commit(1), files: [file(1)] }, true) : new Response('', { status: 502 })
    })
    const report = await client.collectPublicReportEvidence(target)
    expect(report.events[0].files).toBeUndefined()
    expect(report.coverage.files).toBe('partial')
  })

  it('records missing author dates and parents without dropping commits', async () => {
    const { client } = fixture((url) => url.pathname.endsWith('/commits') ? json([commit(1, { parents: undefined, commit: { author: { date: null }, message: 'fix' } })]) : undefined)
    const report = await client.collectPublicReportEvidence(target)
    expect(report.events).toHaveLength(1)
    expect(report.events[0].authoredAt).toBeUndefined()
    expect(report.coverage.history).toBe('partial')
    expect(report.coverage.notes.join(' ')).toContain('author dates')
    expect(report.coverage.notes.join(' ')).toContain('parent metadata')
  })

  it('marks a full file page without next metadata as uncertain', async () => {
    const { client } = fixture((url) => url.pathname.includes('/commits/') ? json({ ...commit(1), files: Array.from({ length: 100 }, (_, n) => file(n)) }) : undefined)
    const report = await client.collectPublicReportEvidence(target)
    expect(report.events[0].files).toHaveLength(100)
    expect(report.coverage.files).toBe('partial')
  })

  it('caps commit file pagination at 3000 files and marks it partial', async () => {
    const { client, fetchImpl } = fixture((url) => {
      if (url.pathname.includes('/commits/')) return json({ ...commit(1), files: Array.from({ length: 100 }, (_, n) => file((Number(url.searchParams.get('page')) - 1) * 100 + n)) }, true)
    })
    const report = await client.collectPublicReportEvidence(target)
    expect(report.events[0].files).toHaveLength(3000)
    expect(report.coverage.files).toBe('partial')
    expect(fetchImpl).toHaveBeenCalledTimes(33)
  })

  it('limits simultaneous commit detail requests to six', async () => {
    let active = 0
    let maximum = 0
    const { client } = fixture(async (url) => {
      if (url.pathname.endsWith('/commits')) return json(Array.from({ length: 12 }, (_, n) => commit(n + 1)))
      if (url.pathname.includes('/commits/')) {
        maximum = Math.max(maximum, ++active)
        await new Promise((resolve) => setTimeout(resolve, 1))
        active -= 1
        return json({ ...commit(parseInt(url.pathname.split('/').at(-1)!, 16)), files: [file(1)] })
      }
    })
    const report = await client.collectPublicReportEvidence(target)
    expect(maximum).toBe(6)
    expect(report.events.map((event) => event.externalId)).toEqual(Array.from({ length: 12 }, (_, n) => sha(n + 1)))
  })

  it.each([true, undefined])('rejects repository privacy %s even with a token', async (privacy) => {
    const { client, fetchImpl } = fixture((url) => url.pathname === '/repos/acme/app' ? json({ private: privacy, default_branch: 'main' }) : undefined, { token: 'private-access-secret' })
    await expect(client.collectPublicReportEvidence(target)).rejects.toThrow('verified public')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('rejects history returned from a different snapshot', async () => {
    const { client } = fixture((url) => url.pathname.endsWith('/commits') ? json([commit(2)]) : undefined)
    await expect(client.collectPublicReportEvidence(target)).rejects.toThrow('pinned snapshot')
  })

  it('does not follow or forward the token to arbitrary pagination URLs', async () => {
    const { client, fetchImpl } = fixture((url, init) => {
      expect(init?.redirect).toBe('error')
      if (url.pathname.includes('/commits/')) {
        const response = json({ ...commit(1), files: [file(Number(url.searchParams.get('page')))] })
        if (url.searchParams.get('page') === '1') response.headers.set('link', '<https://evil.example/token>; rel="next"')
        return response
      }
    }, { token: 'secret' })
    await client.collectPublicReportEvidence(target)
    expect(fetchImpl.mock.calls.every(([input]) => new URL(String(input)).origin === 'https://api.github.com')).toBe(true)
  })

  it('sanitizes redirect/network errors and upstream bodies', async () => {
    const { client } = fixture(() => { throw new Error('GitHub request failed secret-token https://evil.example') })
    await expect(client.collectPublicReportEvidence(target)).rejects.toThrow('redirects are not followed')
    const denied = fixture(() => new Response('secret-token', { status: 301 }))
    await expect(denied.client.collectPublicReportEvidence(target)).rejects.toThrow('HTTP 301')
  })

  it.each([403, 429])('gives actionable rate-limit errors for HTTP %s', async (status) => {
    const { client } = fixture(() => new Response('secret-token', { status, headers: { 'x-ratelimit-remaining': '0' } }))
    await expect(client.collectPublicReportEvidence(target)).rejects.toThrow('rate limit reached')
  })

  it('bounds total requests and retains remaining commit identities with partial files', async () => {
    const { client, fetchImpl } = fixture((url) => {
      if (url.pathname.endsWith('/commits')) {
        const page = Number(url.searchParams.get('page'))
        const count = page === 3 ? 50 : 100
        return json(Array.from({ length: count }, (_, n) => commit((page - 1) * 100 + n + 1)), page < 3)
      }
      if (url.pathname.includes('/commits/')) {
        return json({ ...commit(parseInt(url.pathname.split('/').at(-1)!, 16)), files: [file(Number(url.searchParams.get('page')))] }, true)
      }
    })
    const report = await client.collectPublicReportEvidence(target, { failOnTransientError: true })
    expect(fetchImpl).toHaveBeenCalledTimes(600)
    expect(report.events).toHaveLength(250)
    expect(report.coverage.history).toBe('complete')
    expect(report.coverage.files).toBe('partial')
    expect(report.coverage.notes.join(' ')).toContain('budget reached')
    expect(report.events.some((event) => event.files === undefined)).toBe(true)
  })

  it('bounds repeated detail-budget notes in a 500-contributor service-sized bundle', async () => {
    const { client, fetchImpl } = fixture(url => {
      if (url.pathname.endsWith('/commits')) {
        const page = Number(url.searchParams.get('page'))
        const entries = Array.from({ length: 100 }, (_, n) => {
          const id = (page - 1) * 100 + n + 1
          return commit(id, { author: { login: `user${id}`, type: 'User' } })
        })
        return page < 5 ? json(entries, true) : new Response(JSON.stringify(entries), { headers: { link: '<https://api.github.com/prev>; rel="prev"' } })
      }
      if (url.pathname.includes('/commits/')) return json({ ...commit(parseInt(url.pathname.split('/').at(-1)!, 16)), files: [file(Number(url.searchParams.get('page')))] }, true)
    })
    const evidence = await client.collectPublicReportEvidence(target, { failOnTransientError: true })
    const bundle = buildPublicRepositoryBundle({ bundleRef: 'test', evidence, settings: { repositoryUrl: target.repoUrl, branch: 'main', baselineReviewed: true, period: { startAt: '2026-10-01T00:00:00Z', endAt: '2026-10-02T00:00:00Z', timezone: 'UTC' }, scheduledProjectDates: ['2026-10-01'], exclusions: { commitShas: [], pathPrefixes: [], botLogins: [] } } })
    expect(fetchImpl).toHaveBeenCalledTimes(600)
    expect(evidence.coverage).toMatchObject({ history: 'complete', files: 'partial' })
    expect(evidence.coverage.notes.filter(note => note.includes('budget reached'))).toHaveLength(1)
    expect(bundle.contributors).toHaveLength(500)
    expect(Buffer.byteLength(JSON.stringify(bundle))).toBeLessThan(8_000_000)
  })

  it('stops starting requests after the two-minute operation budget', async () => {
    vi.useFakeTimers()
    const { client, fetchImpl } = fixture((url) => {
      if (url.pathname.endsWith('/commits')) {
        vi.setSystemTime(Date.now() + 120_001)
        return json([commit(1)])
      }
    })
    const report = await client.collectPublicReportEvidence(target)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(report.events[0].files).toBeUndefined()
    expect(report.coverage.files).toBe('partial')
  })

  it('aborts timed-out requests', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi.fn((_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('secret error')))
    })) as typeof fetch
    const pending = new GitHubClient({ fetchImpl }).collectPublicReportEvidence(target)
    const check = expect(pending).rejects.toThrow('timed out after 15 seconds')
    await vi.advanceTimersByTimeAsync(15_000)
    await check
  })
})
