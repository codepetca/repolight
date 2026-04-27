import 'server-only'

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

function getSessionPassword(): string {
  const secret = process.env.SESSION_SECRET
  if (secret && secret.length >= 32) return secret
  return 'repocat-development-session-secret-at-least-32-chars'
}

export const sessionOptions: SessionOptions = {
  cookieName: 'repocat_session',
  password: getSessionPassword(),
  cookieOptions: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  },
}

export async function getSession() {
  return getIronSession<RepocatSession>(cookies(), sessionOptions)
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
