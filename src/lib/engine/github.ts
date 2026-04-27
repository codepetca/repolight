import { categorizeChange, inferAreaFromPath } from '@/lib/engine/categorize'
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
    const res = await this.fetchImpl(`${GITHUB_API_BASE}${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      cache: 'no-store',
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      if (opts.allowNotFoundMessage && (res.status === 404 || res.status === 403)) {
        throw new Error('Repo could not be accessed. Check that it exists and is public.')
      }
      if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
        throw new Error('GitHub rate limit reached. Set GITHUB_TOKEN or retry after the limit resets.')
      }
      throw new Error(`GitHub request failed (${res.status}): ${text || res.statusText}`)
    }

    return res.json() as Promise<T>
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
