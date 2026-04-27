import { z } from 'zod'
import { handleApi } from '@/lib/api'
import { requireUser } from '@/lib/auth/session'
import { processNextRepository } from '@/lib/runs/service'

const processSchema = z.object({
  retryFailed: z.boolean().optional(),
}).default({})

export async function POST(request: Request, context: { params: { id: string } }) {
  return handleApi(async () => {
    const user = await requireUser()
    const bodyText = await request.text()
    const body = bodyText ? processSchema.parse(JSON.parse(bodyText)) : {}
    return processNextRepository(user.id, context.params.id, body)
  })
}
