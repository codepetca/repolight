import { categorizeChange, inferAreaFromPath } from '@/lib/engine/categorize'
import { makeRepositoryKey } from '@/lib/engine/repo'
import type { AnalysisEvent, AnalysisWindow, CommitFile, RepositoryTarget } from '@/lib/engine/types'

const GITHUB_API_BASE = 'https://api.github.com'
const MAX_COMMITS = 250
const MAX_PAGES = 5
const MAX_PULLS = 100

type FetchLike = typeof fetch

export interface GitHubClientOptions {
  token?: string | null
  fetchImpl?: FetchLike
}

type GitHubRepoResponse = {
  private?: boolean
  default_branch?: string
  html_url?: string
}

type GitHubCommitSummary = {
  sha: string
  html_url?: string
  commit: {
    author: {
      email?: string | null
      date?: string | null
      name?: string | null
    }
    message?: string | null
  }
  author?: {
    login?: string | null
    type?: string | null
  } | null
  parents?: Array<{ sha: string }>
}

type GitHubCommitDetail = GitHubCommitSummary & {
  files?: Array<{
    filename?: string
    status?: string
    additions?: number
    deletions?: number
  }>
}

type GitHubPullSummary = {
  number: number
  html_url?: string | null
  title?: string | null
  created_at?: string | null
  updated_at?: string | null
  merged_at?: string | null
  user?: { login?: string | null } | null
}

type GitHubReview = {
  id: number
  html_url?: string | null
  submitted_at?: string | null
  body?: string | null
  user?: { login?: string | null } | null
  state?: string | null
}

export class GitHubClient {
  private readonly token: string | null
  private readonly fetchImpl: FetchLike

  constructor(opts: GitHubClientOptions = {}) {
    this.token = opts.token?.trim() || null
    this.fetchImpl = opts.fetchImpl || fetch
  }

  async validatePublicRepository(target: RepositoryTarget): Promise<RepositoryTarget> {
    const repo = await this.request<GitHubRepoResponse>(`/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.name)}`, {
      allowNotFoundMessage: true,
    })
    if (repo.private) {
      throw new Error(`${target.owner}/${target.name} is private. V1 only supports public GitHub repositories.`)
    }
    return {
      ...target,
      repoUrl: repo.html_url || target.repoUrl,
      branch: target.branch || repo.default_branch || 'main',
    }
  }

  /** Collect ancestry at one immutable head; reporting applies author-time windows later. */
  async collectPublicReportEvidence(target: RepositoryTarget): Promise<{
    target: RepositoryTarget
    snapshot: { sha: string; capturedAt: string; kind: 'analysis_time' }
    events: AnalysisEvent[]
    accountTypes?: Record<string, 'user' | 'bot' | 'unknown'>
    coverage: { history: 'complete' | 'partial' | 'unavailable'; files: 'complete' | 'partial' | 'unavailable'; notes: string[] }
  }> {
    const deadline = Date.now() + 120_000
    let requestCount = 0
    const requestPage = <T>(path: string, opts: { allowNotFoundMessage?: boolean } = {}) => {
      if (++requestCount > 600 || Date.now() >= deadline) throw new Error('Report collection request or two-minute time budget reached. Retry collection or narrow the repository history.')
      return this.requestPage<T>(path, opts)
    }
    const base = `/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.name)}`
    const repo = (await requestPage<GitHubRepoResponse>(base, { allowNotFoundMessage: true })).data
    // Require an affirmative public response even when an optional token can see private repos.
    if (repo.private !== false) throw new Error('Report collection requires a verified public GitHub repository.')
    const branch = target.branch || repo.default_branch
    if (!branch) throw new Error('GitHub did not return a default branch. Select a branch explicitly.')
    const resolvedTarget = { ...target, branch, key: makeRepositoryKey(target.owner, target.name, branch) }
    const head = (await requestPage<{ commit?: { sha?: string } }>(`${base}/branches/${encodeURIComponent(branch)}`)).data
    const sha = head.commit?.sha
    if (!isFullSha(sha)) throw new Error('GitHub returned an invalid branch head SHA.')
    const snapshot = { sha, capturedAt: new Date().toISOString(), kind: 'analysis_time' as const }
    const notes = new Set<string>()
    let history: 'complete' | 'partial' = 'complete'
    let filesCoverage: 'complete' | 'partial' = 'complete'
    const summaries: GitHubCommitSummary[] = []
    const seen = new Set<string>()
    let scanned = 0
    let omittedMerges = 0
    for (let page = 1; page <= 3; page += 1) {
      const result: { data: GitHubCommitSummary[]; headers: Headers } = await requestPage<GitHubCommitSummary[]>(`${base}/commits?sha=${sha}&per_page=100&page=${page}`)
      if (!Array.isArray(result.data)) throw new Error('GitHub returned an invalid commit history response.')
      if (page === 1 && result.data[0]?.sha !== sha) throw new Error('GitHub commit history does not match the pinned snapshot SHA.')
      const remaining = MAX_COMMITS - scanned
      const selected = result.data.slice(0, remaining)
      for (const commit of selected) {
        scanned += 1
        if (!isFullSha(commit.sha) || !commit.commit || !commit.commit.author) throw new Error('GitHub returned an invalid commit summary.')
        if (seen.has(commit.sha)) {
          history = 'partial'
          notes.add('Repeated commits in history pagination; history may be incomplete.')
          continue
        }
        seen.add(commit.sha)
        if (!Array.isArray(commit.parents)) {
          history = 'partial'
          notes.add('Some commit parent metadata is missing; merge identification may be incomplete.')
        }
        if ((commit.parents?.length || 0) > 1) { omittedMerges += 1; continue }
        if (!isValidDate(commit.commit.author.date)) {
          history = 'partial'
          notes.add('Some commits have missing or invalid author dates; their time-window membership is unknown.')
        }
        summaries.push(commit)
      }
      const hasNext = hasNextPage(result.headers)
      if (result.data.length > remaining || (scanned === MAX_COMMITS && (hasNext || result.data.length === 100))) {
        history = 'partial'
        notes.add('History collection reached the 250 scanned-commit limit (including merges).')
        break
      }
      if (page === 3 && hasNext) {
        history = 'partial'
        notes.add('History collection reached the three-page scan limit.')
      }
      if (!hasNext && result.data.length < 100) break
    }
    if (omittedMerges) notes.add(`${omittedMerges} merge commit(s) omitted from scanned history by collection policy; merge-resolution-only changes are not assessed; complete coverage refers to this non-merge scope.`)
    const accountTypes: Record<string, 'user' | 'bot' | 'unknown'> = Object.fromEntries(summaries.map(summary => [summary.sha, summary.author?.type === 'Bot' ? 'bot' : summary.author?.type === 'User' ? 'user' : 'unknown']))
    const events = new Array<AnalysisEvent>(summaries.length)
    let cursor = 0
    const worker = async () => {
      while (cursor < summaries.length) {
        const index = cursor++
        const summary = summaries[index]
        const files: CommitFile[] = []
        let usableFiles = true
        let complete = true
        const fileNames = new Set<string>()
        try {
          for (let page = 1; page <= 30; page += 1) {
            const detail = await requestPage<GitHubCommitDetail>(`${base}/commits/${summary.sha}?per_page=100&page=${page}`)
            if (detail.data.sha !== summary.sha) throw new Error('Commit detail SHA does not match the requested commit.')
            if (!Array.isArray(detail.data.files)) throw new Error('GitHub did not return a commit file list.')
            for (const file of detail.data.files) {
              if (!file.filename || typeof file.additions !== 'number' || !Number.isFinite(file.additions) || file.additions < 0 || typeof file.deletions !== 'number' || !Number.isFinite(file.deletions) || file.deletions < 0) {
                complete = false
                continue
              }
              if (fileNames.has(file.filename)) {
                complete = false
                continue
              }
              fileNames.add(file.filename)
              files.push({ filename: file.filename, status: file.status || 'modified', additions: file.additions, deletions: file.deletions })
            }
            if (files.length >= 3000 || page === 30) {
              complete = false
              notes.add(`Commit ${summary.sha} reached GitHub's 3000-file or 30-page collection limit; file coverage is partial.`)
              break
            }
            if (!hasNextPage(detail.headers)) {
              // A full page without a next link cannot prove the file list is exhaustive.
              if (detail.data.files.length >= 100) {
                complete = false
                notes.add(`Commit ${summary.sha} returned a full file page without pagination metadata; file coverage is uncertain.`)
              }
              break
            }
            if (detail.data.files.length === 0) {
              complete = false
              break
            }
          }
        } catch (error) {
          usableFiles = false
          complete = false
          notes.add(`Commit ${summary.sha}: ${error instanceof Error ? error.message : 'Commit details unavailable.'}`)
        }
        if (!complete) {
          filesCoverage = 'partial'
          notes.add('Some commit file evidence is missing or incomplete; aggregate churn is a lower bound.')
        }
        const normalizedFiles = usableFiles ? files.slice(0, 3000) : undefined
        const category = normalizedFiles ? categorizeChange(summary.commit.message || '', normalizedFiles).category : undefined
        events[index] = {
          type: 'commit', externalId: summary.sha, repositoryKey: resolvedTarget.key,
          title: summary.commit.message?.split('\n')[0] || summary.sha.slice(0, 7),
          authoredAt: isValidDate(summary.commit.author.date) ? summary.commit.author.date! : undefined,
          url: `https://github.com/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.name)}/commit/${summary.sha}`,
          githubLogin: summary.author?.login || null, authorEmail: summary.commit.author.email || null,
          files: normalizedFiles, category,
          additions: normalizedFiles?.reduce((sum, file) => sum + file.additions, 0),
          deletions: normalizedFiles?.reduce((sum, file) => sum + file.deletions, 0),
          areas: normalizedFiles ? [...new Set(normalizedFiles.map((file) => inferAreaFromPath(file.filename)).filter(Boolean))] : undefined,
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(6, summaries.length) }, worker))
    return { target: resolvedTarget, snapshot, events, accountTypes, coverage: { history, files: filesCoverage, notes: [...notes].sort() } }
  }

  async fetchRepositoryEvents(target: RepositoryTarget, window: AnalysisWindow, includeReviews = true): Promise<AnalysisEvent[]> {
    const [commitEvents, reviewEvents] = await Promise.all([
      this.fetchCommitEvents(target, window),
      includeReviews ? this.fetchReviewEvents(target, window) : Promise.resolve([]),
    ])
    return [...commitEvents, ...reviewEvents]
  }

  private async fetchCommitEvents(target: RepositoryTarget, window: AnalysisWindow): Promise<AnalysisEvent[]> {
    const summaries = await this.listCommits(target, window)
    const nonMergeSummaries = summaries.filter((commit) => !isMergeCommit(commit))
    const details = await this.fetchCommitDetails(target, nonMergeSummaries)
    return details.map((commit) => {
      const files = (commit.files || []).map((file) => ({
        filename: file.filename || '',
        status: file.status || 'modified',
        additions: Number(file.additions || 0),
        deletions: Number(file.deletions || 0),
      }))
      const category = categorizeChange(commit.commit.message || '', files).category
      const additions = files.reduce((sum, file) => sum + file.additions, 0)
      const deletions = files.reduce((sum, file) => sum + file.deletions, 0)
      return {
        type: 'commit',
        externalId: commit.sha,
        repositoryKey: target.key,
        title: commit.commit.message?.split('\n')[0] || commit.sha.slice(0, 7),
        authoredAt: commit.commit.author.date || undefined,
        url: commit.html_url,
        githubLogin: commit.author?.login || null,
        authorEmail: commit.commit.author.email || null,
        summary: `${category} | +${additions} -${deletions}`,
        category,
        files,
        additions,
        deletions,
        areas: [...new Set(files.map((file) => inferAreaFromPath(file.filename)).filter(Boolean))],
      } satisfies AnalysisEvent
    })
  }

  private async listCommits(target: RepositoryTarget, window: AnalysisWindow): Promise<GitHubCommitSummary[]> {
    const commits: GitHubCommitSummary[] = []
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const result = await this.request<GitHubCommitSummary[]>(
        `/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.name)}/commits?sha=${encodeURIComponent(target.branch)}&since=${encodeURIComponent(window.startAt)}&until=${encodeURIComponent(window.endAt)}&per_page=100&page=${page}`,
      )
      if (!result.length) break
      commits.push(...result)
      if (commits.length >= MAX_COMMITS) return commits.slice(0, MAX_COMMITS)
      if (result.length < 100) break
    }
    return commits
  }

  private async fetchCommitDetails(target: RepositoryTarget, summaries: GitHubCommitSummary[]): Promise<GitHubCommitDetail[]> {
    const details: GitHubCommitDetail[] = []
    const queue = [...summaries]
    const concurrency = Math.min(6, queue.length)

    async function worker(client: GitHubClient) {
      while (queue.length > 0) {
        const commit = queue.shift()
        if (!commit) break
        const detail = await client.request<GitHubCommitDetail>(
          `/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.name)}/commits/${commit.sha}`,
        )
        details.push(detail)
      }
    }

    await Promise.all(Array.from({ length: concurrency }, () => worker(this)))
    return details
  }

  private async fetchReviewEvents(target: RepositoryTarget, window: AnalysisWindow): Promise<AnalysisEvent[]> {
    const pulls = await this.listPulls(target, window)
    const events: AnalysisEvent[] = []
    for (const pull of pulls) {
      const relevantAt = pull.merged_at || pull.updated_at || pull.created_at || undefined
      const title = pull.title || `Pull request #${pull.number}`
      events.push({
        type: 'pull_request',
        externalId: String(pull.number),
        repositoryKey: target.key,
        title,
        authoredAt: relevantAt,
        url: pull.html_url || undefined,
        githubLogin: pull.user?.login || null,
        summary: 'Pull request activity',
      })

      const reviews = await this.request<GitHubReview[]>(
        `/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.name)}/pulls/${pull.number}/reviews?per_page=100`,
      )
      for (const review of reviews) {
        if (!review.submitted_at || !isWithinWindow(review.submitted_at, window)) continue
        events.push({
          type: 'review',
          externalId: String(review.id),
          repositoryKey: target.key,
          title: `${review.state || 'Review'} on PR #${pull.number}`,
          authoredAt: review.submitted_at,
          url: review.html_url || undefined,
          githubLogin: review.user?.login || null,
          summary: review.body?.trim() ? review.body.trim().slice(0, 180) : 'Review activity',
        })
      }
    }
    return events
  }

  private async listPulls(target: RepositoryTarget, window: AnalysisWindow): Promise<GitHubPullSummary[]> {
    const pulls = await this.request<GitHubPullSummary[]>(
      `/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.name)}/pulls?state=all&sort=updated&direction=desc&per_page=${MAX_PULLS}`,
    )
    return pulls.filter((pull) => {
      const relevantAt = pull.merged_at || pull.updated_at || pull.created_at
      return !!relevantAt && isWithinWindow(relevantAt, window)
    })
  }

  private async request<T>(path: string, opts: { allowNotFoundMessage?: boolean } = {}): Promise<T> {
    return (await this.requestPage<T>(path, { ...opts, followRedirects: true })).data
  }

  private async requestPage<T>(path: string, opts: { allowNotFoundMessage?: boolean; followRedirects?: boolean } = {}): Promise<{ data: T; headers: Headers }> {
    if (!path.startsWith('/repos/') || path.startsWith('//') || path.includes('\\')) throw new Error('Unsafe GitHub API path.')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15_000)
    try {
      let url = `${GITHUB_API_BASE}${path}`
      let res: Response
      for (let redirects = 0; ; redirects++) {
        res = await this.fetchImpl(url, {
          headers: {
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
          },
          cache: 'no-store', redirect: opts.followRedirects ? 'manual' : 'error', signal: controller.signal,
        })
        if (!opts.followRedirects || ![301, 302, 303, 307, 308].includes(res.status)) break
        if (redirects >= 5) throw new SafeGitHubRequestError('GitHub redirect limit reached. Use the current repository URL.')
        const location = res.headers.get('location')
        if (!location) throw new SafeGitHubRequestError('GitHub redirect did not include a destination.')
        const destination = new URL(location, url)
        if (destination.origin !== GITHUB_API_BASE || destination.username || destination.password) {
          throw new SafeGitHubRequestError('Unsafe GitHub redirect destination rejected.')
        }
        await res.body?.cancel()
        url = destination.href
      }
      if (!res.ok) {
        if (res.status === 429 || (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0')) {
          throw new SafeGitHubRequestError('GitHub rate limit reached. Retry after the limit resets or configure a public-read GITHUB_TOKEN.')
        }
        if (opts.allowNotFoundMessage && (res.status === 404 || res.status === 403)) {
          throw new SafeGitHubRequestError('Repo could not be accessed. Check that it exists and is public.')
        }
        throw new SafeGitHubRequestError(`GitHub request failed (HTTP ${res.status}). Check repository access and retry.`)
      }
      return { data: await res.json() as T, headers: res.headers }
    } catch (error) {
      if (controller.signal.aborted) throw new Error('GitHub request timed out after 15 seconds. Retry collection.')
      // Only expose errors constructed here, never network or upstream response text.
      if (error instanceof SafeGitHubRequestError) throw error
      throw new Error('GitHub request could not be completed. Check the connection; redirects are not followed.')
    } finally {
      clearTimeout(timer)
    }
  }
}

export function getGitHubToken(): string | null {
  return process.env.GITHUB_TOKEN?.trim() || process.env.GITHUB_PAT?.trim() || process.env.GITHUB_FEEDBACK_TOKEN?.trim() || null
}

export function isMergeCommit(commit: GitHubCommitSummary): boolean {
  return (commit.parents?.length || 0) > 1 || /^merge\b/i.test(commit.commit.message || '')
}

function isWithinWindow(iso: string, window: AnalysisWindow): boolean {
  const ms = new Date(iso).getTime()
  return ms >= new Date(window.startAt).getTime() && ms <= new Date(window.endAt).getTime()
}

function hasNextPage(headers: Headers): boolean {
  return /;\s*rel=["']?next["']?(?:\s|,|$)/i.test(headers.get('link') || '')
}

function isFullSha(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{40}$/i.test(value)
}

function isValidDate(value: string | null | undefined): boolean {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

class SafeGitHubRequestError extends Error {}
