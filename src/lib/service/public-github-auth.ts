import { createGitHubAppJwt } from '@/lib/classroom/github-app'
import { getGitHubToken, GitHubCollectionError } from '@/lib/engine/github'

/** Obtain a fresh installation token per attempt; never fall back to anonymous on a misconfigured App. */
export async function publicGitHubToken(signal?: AbortSignal, env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const appId = env.REPOLIGHT_GITHUB_APP_ID?.trim()
  const installationId = env.REPOLIGHT_GITHUB_APP_INSTALLATION_ID?.trim()
  const privateKey = env.REPOLIGHT_GITHUB_APP_PRIVATE_KEY?.trim().replace(/\\n/g, '\n')
  if (!appId && !installationId && !privateKey) return getGitHubToken()
  if (!appId || !installationId || !privateKey || !/^\d+$/.test(appId) || !/^\d+$/.test(installationId)) {
    throw new GitHubCollectionError('upstream_unavailable', false, 'GitHub App authentication is not configured correctly.')
  }
  let jwt: string
  try {
    jwt = createGitHubAppJwt({ appId, installationId, privateKey, apiBaseUrl: 'https://api.github.com' })
  } catch {
    throw new GitHubCollectionError('upstream_unavailable', false, 'GitHub App authentication is not configured correctly.')
  }
  try {
    const response = await fetchImpl(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
      method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(15_000)]),
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${jwt}`, 'X-GitHub-Api-Version': '2022-11-28' },
    })
    if (!response.ok) {
      if (response.status === 429 || (response.status === 403 && (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after')))) throw new GitHubCollectionError('upstream_rate_limited', true, 'GitHub rate limit reached.')
      throw new GitHubCollectionError('upstream_unavailable', response.status >= 500, 'GitHub App authentication failed.')
    }
    const reader = response.body?.getReader()
    if (!reader) throw new Error('Missing token response')
    const chunks: Uint8Array[] = []
    let bytes = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        bytes += value.byteLength
        if (bytes > 16_384) throw new Error('Token response too large')
        chunks.push(value)
      }
    } finally { await reader.cancel().catch(() => {}) }
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || !('token' in parsed) || typeof parsed.token !== 'string' || !parsed.token || !('expires_at' in parsed) || typeof parsed.expires_at !== 'string' || Date.parse(parsed.expires_at) < Date.now() + 180_000 || !Number.isFinite(Date.parse(parsed.expires_at))) throw new Error('Invalid token response')
    return parsed.token
  } catch (error) {
    if (error instanceof GitHubCollectionError) throw error
    throw new GitHubCollectionError('upstream_unavailable', true, 'GitHub App authentication could not be completed.')
  }
}
