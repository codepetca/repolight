import 'server-only'

import { randomBytes } from 'node:crypto'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getIronSession, type SessionOptions } from 'iron-session'

export interface SessionUser {
  id: string
  email: string
}

export interface RepocatSession {
  user?: SessionUser
}

let developmentPassword: string | undefined

function getSessionPassword(): string {
  const secret = process.env.SESSION_SECRET
  if (secret && secret.trim().length >= 32) return secret
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET must contain at least 32 non-padding characters in production.')
  }
  // Ephemeral per process: local development works without a shared fallback key.
  developmentPassword ??= randomBytes(48).toString('base64url')
  return developmentPassword
}

function getSessionOptions(): SessionOptions {
  return {
    cookieName: 'repocat_session',
    password: getSessionPassword(),
    cookieOptions: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    },
  }
}

export async function getSession() {
  // Read request state first so Next can defer authenticated pages during prerendering.
  // Real requests still validate production configuration before creating any session.
  const cookieStore = await cookies()
  return getIronSession<RepocatSession>(cookieStore, getSessionOptions())
}

export async function getOptionalUser(): Promise<SessionUser | null> {
  const session = await getSession()
  return session.user ?? null
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getOptionalUser()
  if (!user) redirect('/login')
  return user
}

export async function setSessionUser(user: SessionUser): Promise<void> {
  const session = await getSession()
  session.user = user
  await session.save()
}

export async function clearSession(): Promise<void> {
  const session = await getSession()
  session.destroy()
}
