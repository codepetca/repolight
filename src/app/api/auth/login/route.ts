import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '@/db'
import { users } from '@/db/schema'
import { handleApi, jsonError } from '@/lib/api'
import { verifyPassword } from '@/lib/auth/passwords'
import { setSessionUser } from '@/lib/auth/session'

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1, 'Password is required.'),
})

export async function POST(request: Request) {
  return handleApi(async () => {
    const body = loginSchema.parse(await request.json())
    const [user] = await getDb()
      .select()
      .from(users)
      .where(eq(users.email, body.email.toLowerCase()))
      .limit(1)

    if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
      return jsonError('Invalid email or password.', 401)
    }

    await setSessionUser({ id: user.id, email: user.email })
    return { user: { id: user.id, email: user.email } }
  })
}
