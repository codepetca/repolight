import { handleApi } from '@/lib/api'
import { requireUser } from '@/lib/auth/session'
import { getRunResults } from '@/lib/runs/service'

export async function GET(_: Request, context: { params: { id: string } }) {
  return handleApi(async () => {
    const user = await requireUser()
    return getRunResults(user.id, context.params.id)
  })
}
