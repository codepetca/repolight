import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '@/db'
import { users } from '@/db/schema'
import { handleApi, jsonError } from '@/lib/api'
import { hashPassword } from '@/lib/auth/passwords'
import { setSessionUser } from '@/lib/auth/session'

const registerSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
})

export async function POST(request: Request) {
  return handleApi(async () => {
    const body = registerSchema.parse(await request.json())
    const database = getDb()
    const existing = await database.select().from(users).where(eq(users.email, body.email.toLowerCase())).limit(1)
    if (existing.length > 0) return jsonError('An account with this email already exists.', 409)

    const [user] = await database.insert(users).values({
      email: body.email.toLowerCase(),
      passwordHash: await hashPassword(body.password),
    }).returning()
    if (!user) throw new Error('Failed to create account.')
    await setSessionUser({ id: user.id, email: user.email })
    return { user: { id: user.id, email: user.email } }
  })
}
