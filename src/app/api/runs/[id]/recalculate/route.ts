import { handleApi } from '@/lib/api'
import { requireUser } from '@/lib/auth/session'
import { recalculateRunResults } from '@/lib/runs/service'

export async function POST(_: Request, context: { params: { id: string } }) {
  return handleApi(async () => {
    const user = await requireUser()
    return recalculateRunResults(user.id, context.params.id)
  })
}
