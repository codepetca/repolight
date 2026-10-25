// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  getIronSession: vi.fn(),
  redirect: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ cookies: mocks.cookies }))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('iron-session', () => ({ getIronSession: mocks.getIronSession }))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.stubEnv('SESSION_SECRET', '')
  mocks.cookies.mockResolvedValue({ name: 'cookie-store' })
  mocks.getIronSession.mockResolvedValue({})
})
afterEach(() => vi.unstubAllEnvs())

describe('session configuration', () => {
  it.each([undefined, '', 'too-short', ' '.repeat(40)])('fails closed at production session access for invalid secret %s', async secret => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('SESSION_SECRET', secret)
    // Import remains safe for build-time route discovery without runtime secrets.
    const { getSession } = await import('@/lib/auth/session')
    await expect(getSession()).rejects.toThrow('SESSION_SECRET must contain at least 32')
    expect(mocks.getIronSession).not.toHaveBeenCalled()
    expect(mocks.cookies).toHaveBeenCalledOnce()
  })

  it('preserves Next prerender deferral before resolving production-only secrets', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const dynamicDeferral = new Error('Next dynamic request access')
    mocks.cookies.mockRejectedValueOnce(dynamicDeferral)
    const { getOptionalUser } = await import('@/lib/auth/session')
    await expect(getOptionalUser()).rejects.toBe(dynamicDeferral)
    expect(mocks.getIronSession).not.toHaveBeenCalled()
  })

  it('uses configured production secret and awaits the request cookie store', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const secret = 'configured-production-secret-32-characters'
    vi.stubEnv('SESSION_SECRET', secret)
    const { getSession } = await import('@/lib/auth/session')
    await getSession()
    expect(mocks.getIronSession).toHaveBeenCalledWith({ name: 'cookie-store' }, {
      password: secret,
      cookieName: 'repocat_session',
      cookieOptions: { httpOnly: true, sameSite: 'lax', secure: true, path: '/' },
    })
  })

  it('rechecks configuration at runtime rather than capturing a stale import-time value', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('SESSION_SECRET', 'valid-configuration-secret-with-32-characters')
    const { getSession } = await import('@/lib/auth/session')
    await getSession()
    vi.stubEnv('SESSION_SECRET', '')
    await expect(getSession()).rejects.toThrow('SESSION_SECRET')
    expect(mocks.getIronSession).toHaveBeenCalledTimes(1)
  })

  it('generates a stable local process secret that changes in a fresh isolated module', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const firstModule = await import('@/lib/auth/session')
    await firstModule.getSession()
    await firstModule.getSession()
    const firstOptions = mocks.getIronSession.mock.calls[0][1]
    expect(firstOptions.password).toHaveLength(64)
    expect(firstOptions.cookieOptions.secure).toBe(false)
    expect(mocks.getIronSession.mock.calls[1][1].password).toBe(firstOptions.password)
    vi.resetModules()
    const nextModule = await import('@/lib/auth/session')
    await nextModule.getSession()
    expect(mocks.getIronSession.mock.calls[2][1].password).not.toBe(firstOptions.password)
  })

  it('uses a valid explicit secret during development', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const secret = 'explicit-local-session-secret-at-least-32-chars'
    vi.stubEnv('SESSION_SECRET', secret)
    const { getSession } = await import('@/lib/auth/session')
    await getSession()
    expect(mocks.getIronSession.mock.calls[0][1].password).toBe(secret)
  })

  it('keeps session helpers and the existing user payload compatible', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const session = { user: undefined as { id: string; email: string } | undefined, save: vi.fn(), destroy: vi.fn() }
    mocks.getIronSession.mockResolvedValue(session)
    const helpers = await import('@/lib/auth/session')
    expect(await helpers.getOptionalUser()).toBeNull()
    const user = { id: 'user-1', email: 'teacher@example.test' }
    await helpers.setSessionUser(user)
    expect(session.save).toHaveBeenCalledOnce()
    expect(await helpers.requireUser()).toEqual(user)
    await helpers.clearSession()
    expect(session.destroy).toHaveBeenCalledOnce()
  })
})
