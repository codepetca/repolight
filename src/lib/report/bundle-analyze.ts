import { GitHubClient, getGitHubToken } from '@/lib/engine/github'
import { makeRepositoryTarget } from '@/lib/engine/repo'
import { buildPublicRepositoryBundle } from '@/lib/report/bundle-build'
import { publicRepositoryRequestSchema, type PublicRepositoryBundle } from '@/lib/report/bundle-contract'

export async function analyzePublicRepositoryBundle(raw: unknown, client = new GitHubClient({ token: getGitHubToken() })): Promise<PublicRepositoryBundle> {
  const settings = publicRepositoryRequestSchema.parse(raw)
  const target = makeRepositoryTarget(settings.repositoryUrl, settings.branch)!
  if (!settings.branch) target.branch = ''
  const evidence = await client.collectPublicReportEvidence(target)
  return buildPublicRepositoryBundle({ bundleRef: `public-${evidence.snapshot.sha.slice(0, 12)}-${Date.now()}`, settings, evidence })
}
