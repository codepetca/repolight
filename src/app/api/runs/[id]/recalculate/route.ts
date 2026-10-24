import { handleApi } from '@/lib/api'
import { requireUser } from '@/lib/auth/session'
import { recalculateRunResults } from '@/lib/runs/service'

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const routeParams = await context.params
  return handleApi(async () => {
    const user = await requireUser()
    return recalculateRunResults(user.id, routeParams.id)
  })
}
