import { handleApi } from '@/lib/api'
import { requireUser } from '@/lib/auth/session'
import { getRunDetail } from '@/lib/runs/service'

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const routeParams = await context.params
  return handleApi(async () => {
    const user = await requireUser()
    return { run: await getRunDetail(user.id, routeParams.id) }
  })
}
