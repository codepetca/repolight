import { generateKeyPairSync } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { publicGitHubToken } from '@/lib/service/public-github-auth'

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } })
const configured = { REPOLIGHT_GITHUB_APP_ID: '123', REPOLIGHT_GITHUB_APP_INSTALLATION_ID: '456', REPOLIGHT_GITHUB_APP_PRIVATE_KEY: privateKey }
afterEach(() => vi.unstubAllEnvs())

describe('public collector App authentication', () => {
  it('uses the existing static token if no App is configured', async () => {
    vi.stubEnv('GITHUB_TOKEN', 'existing-test-token')
    expect(await publicGitHubToken(undefined, {})).toBe('existing-test-token')
  })
  it('fails closed for partial configuration', async () => {
    const fetchImpl = vi.fn()
    await expect(publicGitHubToken(undefined, { REPOLIGHT_GITHUB_APP_ID: '123' }, fetchImpl)).rejects.toMatchObject({ code: 'upstream_unavailable', retryable: false })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it('obtains a short-lived installation token from GitHub without exposing secrets', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ token: 'installation-test-token', expires_at: new Date(Date.now() + 3_600_000).toISOString() }))
    expect(await publicGitHubToken(undefined, configured, fetchImpl)).toBe('installation-test-token')
    expect(fetchImpl).toHaveBeenCalledOnce()
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.github.com/app/installations/456/access_tokens')
    expect(init.redirect).toBe('error')
    expect(init.method).toBe('POST')
    expect(new Headers(init.headers).get('Authorization')).toMatch(/^Bearer [^.]+\.[^.]+\.[^.]+$/)
  })
  it('does not expose upstream bodies and identifies rate limits', async () => {
    const fetchImpl = vi.fn(async () => new Response('secret upstream response', { status: 403, headers: { 'x-ratelimit-remaining': '0' } }))
    const error = await publicGitHubToken(undefined, configured, fetchImpl).catch(e => e)
    expect(error).toMatchObject({ code: 'upstream_rate_limited', retryable: true })
    expect(error.message).not.toContain('secret')
  })
  it('bounds token responses and redacts network and signing errors', async () => {
    const oversized = vi.fn(async () => new Response('x'.repeat(20_000)))
    await expect(publicGitHubToken(undefined, configured, oversized)).rejects.toMatchObject({ code: 'upstream_unavailable' })
    const networkFailure = vi.fn(async () => { throw new Error('sensitive network details') })
    const error = await publicGitHubToken(undefined, configured, networkFailure).catch(e => e)
    expect(error.message).not.toContain('sensitive')
    await expect(publicGitHubToken(undefined, { ...configured, REPOLIGHT_GITHUB_APP_PRIVATE_KEY: 'not a private key' }, networkFailure)).rejects.toMatchObject({ code: 'upstream_unavailable', retryable: false })
  })
  it('rejects an expired or malformed installation token', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ token: 'token', expires_at: 'invalid' }))
    await expect(publicGitHubToken(undefined, configured, fetchImpl)).rejects.toMatchObject({ code: 'upstream_unavailable' })
  })
})
