import { z } from 'zod'
import { handleApi } from '@/lib/api'
import { requireUser } from '@/lib/auth/session'
import { createRun, listRunsForUser } from '@/lib/runs/service'

const createRunSchema = z.object({
  name: z.string().trim().optional(),
  csvText: z.string().min(1, 'CSV text is required.'),
  startAt: z.string().min(1, 'startAt is required.'),
  endAt: z.string().min(1, 'endAt is required.'),
  timezone: z.string().trim().min(1).default('America/Toronto'),
  rubric: z.any().optional(),
})

export async function GET() {
  return handleApi(async () => {
    const user = await requireUser()
    return { runs: await listRunsForUser(user.id) }
  })
}

export async function POST(request: Request) {
  return handleApi(async () => {
    const user = await requireUser()
    const body = createRunSchema.parse(await request.json())
    return { run: await createRun(user.id, body) }
  })
}
