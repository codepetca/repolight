import { createHash } from 'node:crypto'
import { z } from 'zod'
import { normalizeGitHubLogin } from '@/lib/engine/repo'
import type { AnalysisEvent, RepositoryTarget } from '@/lib/engine/types'
import { METRICS_VERSION, reportBuildInputSchema, type RepositoryReport, type ReportBuildInput } from '@/lib/report/contract'
import { calculateScopeFacts, prepareReportCommits } from '@/lib/report/calculations'
import { buildScopeRuleFeedback } from '@/lib/report/rules'
import { publicRepositoryBundleSchema, publicRepositoryRequestSchema, type ContributorDescriptor, type PublicRepositoryBundle, type PublicRepositoryRequest, type ReportContext, type ScopeAnalysis } from '@/lib/report/bundle-contract'

export interface PublicRepositoryBuildInput {
  bundleRef: string;
  settings: PublicRepositoryRequest;
  evidence: {
    target: RepositoryTarget;
    snapshot: RepositoryReport['snapshot'];
    events: AnalysisEvent[];
    coverage: RepositoryReport['coverage'];
    accountTypes?: Record<string, 'user' | 'bot' | 'unknown'>;
  };
}
const evidenceInputSchema = reportBuildInputSchema.omit({ identity: true, reportRef: true, studentRef: true })
const usernamePattern = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/
const opaqueId = (repository: string, kind: string, shas: string[]) => `${kind}-${createHash('sha256').update(JSON.stringify(['repolight-contributor-v1', repository.toLowerCase(), kind, [...shas].sort()])).digest('hex')}`

/** One validated evidence set, one eligibility filter, then a disjoint partition. Emails stay internal. */
export function buildPublicRepositoryBundle(raw: PublicRepositoryBuildInput): PublicRepositoryBundle {
  const settings = publicRepositoryRequestSchema.parse(raw.settings)
  const evidence = raw.evidence
  const input = evidenceInputSchema.parse({ repositoryUrl: evidence.target.repoUrl, branch: evidence.target.branch, snapshot: evidence.snapshot, events: evidence.events, coverage: evidence.coverage, period: settings.period, scheduledProjectDates: settings.scheduledProjectDates, exclusions: settings.exclusions,
    baseline: settings.baselineReviewed ? { status: 'applied', reference: 'teacher-reviewed-exclusions' } : { status: 'not_supplied', reference: null },
  })
  const context: ReportContext = { metricsVersion: METRICS_VERSION, repository: { url: input.repositoryUrl, branch: input.branch, visibility: 'public' }, snapshot: input.snapshot, period: input.period,
    scheduledProjectDates: input.scheduledProjectDates === null ? null : [...new Set(input.scheduledProjectDates)].sort(), baseline: input.baseline, exclusions: input.exclusions }
  const bucketKey = (event: Pick<AnalysisEvent, 'githubLogin' | 'authorEmail'>) => {
    const login = normalizeGitHubLogin(event.githubLogin)
    if (login) return `github:${login}`
    const email = event.authorEmail?.trim().toLowerCase()
    return email ? `email:${email}` : 'unknown'
  }
  // Assign IDs from collected ancestry before the selected period/exclusions, not from private email hashes.
  const allBuckets = new Map<string, string[]>()
  const eventBySha = new Map<string, ReportBuildInput['events'][number]>()
  for (const event of input.events) if (event.type === 'commit') {
    const key = bucketKey(event)
    allBuckets.set(key, [...new Set([...(allBuckets.get(key) || []), event.externalId])])
    eventBySha.set(event.externalId, event)
  }
  const included = prepareReportCommits(input).commits
  const partition = new Map<string, typeof included>()
  for (const commit of included) {
    const key = bucketKey(eventBySha.get(commit.sha)!)
    partition.set(key, [...(partition.get(key) || []), commit])
  }
  const analyze = (scope: ScopeAnalysis['scope'], commits: typeof included): ScopeAnalysis => {
    const facts = calculateScopeFacts(input, commits)
    return { scope, facts, ruleFeedback: buildScopeRuleFeedback(context, facts, scope) }
  }
  const descriptors = [...partition.entries()].map(([key, commits]) => {
    const kind: ContributorDescriptor['kind'] = key.startsWith('github:') ? 'github_account' : key.startsWith('email:') ? 'unlinked_email' : 'unknown_author'
    const login = kind === 'github_account' ? key.slice(7) : null
    const id = login ? `github-${login}` : opaqueId(input.repositoryUrl, kind, kind === 'unknown_author' ? [] : allBuckets.get(key)!)
    const types = new Set((allBuckets.get(key) || []).map(sha => evidence.accountTypes?.[sha]).filter((type): type is 'user' | 'bot' => type === 'user' || type === 'bot'))
    const accountType: ContributorDescriptor['accountType'] = login && types.size === 1 ? [...types][0] : 'unknown'
    return { contributor: { id, kind, githubLogin: login, label: login ? `@${login}` : kind === 'unknown_author' ? 'Unknown authors' : '', accountType }, commits }
  }).sort((a, b) => a.contributor.id.localeCompare(b.contributor.id))
  let unlinked = 0
  const contributors = descriptors.map(({ contributor, commits }) => {
    if (contributor.kind === 'unlinked_email') contributor.label = `Unlinked author ${++unlinked}`
    return { contributor, analysis: analyze({ kind: 'contributor', contributorId: contributor.id }, commits) }
  })
  const requested = settings.githubUsername?.trim() || null
  const login = normalizeGitHubLogin(requested)
  const valid = login !== null && usernamePattern.test(login.replace(/\[bot\]$/, '')) && !login.includes('--')
  const matched = valid ? contributors.find(entry => entry.contributor.githubLogin === login) : undefined
  const selection: PublicRepositoryBundle['selection'] = !requested
    ? { requestedGithubLogin: null, status: 'not_requested', contributorId: null, notice: 'No username supplied. Showing the repository overview and all contributors.' }
    : !valid
      ? { requestedGithubLogin: requested, status: 'invalid', contributorId: null, notice: 'The supplied username is not a valid GitHub login. Showing the repository overview and all contributors.' }
      : matched
        ? { requestedGithubLogin: login, status: 'matched', contributorId: matched.contributor.id, notice: null }
        : { requestedGithubLogin: login, status: 'not_found', contributorId: null, notice: `No included commits matched @${login} in the collected period. Showing the repository overview and all contributors; incomplete collection may omit matching evidence.` }
  return publicRepositoryBundleSchema.parse({ schemaVersion: '1.0', bundleRef: z.string().min(1).max(128).parse(raw.bundleRef), context, collectionCoverage: input.coverage, selection, overview: analyze({ kind: 'repository' }, included), contributors })
}
