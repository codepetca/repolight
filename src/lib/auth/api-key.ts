import 'server-only'

import { timingSafeEqual } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { getDb } from '@/db'
import { users } from '@/db/schema'
import { ApiError } from '@/lib/api'
import type { SessionUser } from '@/lib/auth/session'

const FALLBACK_API_EMAIL = 'api@repocat.local'

export async function requireApiUser(request: Request): Promise<SessionUser> {
  const token = bearerTokenFor(request)
  if (!token) throw new ApiError('Missing bearer token.', 401)

  const acceptedKeys = configuredApiKeys()
  if (acceptedKeys.length === 0) {
    throw new ApiError('REPOCAT_API_KEY is not configured.', 503)
  }
  if (!isAcceptedApiKey(token, acceptedKeys)) {
    throw new ApiError('Invalid API key.', 401)
  }

  return ensureApiUser()
}

export function isAcceptedApiKey(token: string, acceptedKeys: string[]): boolean {
  return acceptedKeys.some((key) => constantTimeEqual(token, key))
}

function bearerTokenFor(request: Request): string | null {
  const authorization = request.headers.get('authorization') || ''
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim())
  return match?.[1]?.trim() || null
}

function configuredApiKeys(): string[] {
  return [
    ...splitKeys(process.env.REPOCAT_API_KEYS),
    ...splitKeys(process.env.REPOCAT_API_KEY),
  ]
}

function splitKeys(value: string | undefined): string[] {
  return (value || '')
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  if (leftBuffer.length !== rightBuffer.length) return false
  return timingSafeEqual(leftBuffer, rightBuffer)
}

async function ensureApiUser(): Promise<SessionUser> {
  const email = (process.env.REPOCAT_API_USER_EMAIL || FALLBACK_API_EMAIL).trim().toLowerCase()
  const database = getDb()
  const [existing] = await database.select().from(users).where(eq(users.email, email)).limit(1)
  if (existing) return { id: existing.id, email: existing.email }

  const [created] = await database
    .insert(users)
    .values({
      email,
      passwordHash: 'api-key-auth-user',
    })
    .onConflictDoNothing()
    .returning()

  if (created) return { id: created.id, email: created.email }

  const [raceWinner] = await database.select().from(users).where(eq(users.email, email)).limit(1)
  if (!raceWinner) throw new ApiError('Failed to initialize API user.', 500)
  return { id: raceWinner.id, email: raceWinner.email }
}
