import { z } from 'zod'
import { handleApi } from '@/lib/api'
import { requireApiUser } from '@/lib/auth/api-key'
import { processNextRepository } from '@/lib/runs/service'

const processSchema = z.object({
  retryFailed: z.boolean().optional(),
}).default({})

export async function POST(request: Request, context: { params: { id: string } }) {
  return handleApi(async () => {
    const user = await requireApiUser(request)
    const bodyText = await request.text()
    const body = bodyText ? processSchema.parse(JSON.parse(bodyText)) : {}
    return processNextRepository(user.id, context.params.id, body)
  })
}
