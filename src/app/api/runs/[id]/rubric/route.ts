import { handleApi } from '@/lib/api'
import { requireUser } from '@/lib/auth/session'
import { updateRunRubric } from '@/lib/runs/service'

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const routeParams = await context.params
  return handleApi(async () => {
    const user = await requireUser()
    const body = await request.json()
    return { run: await updateRunRubric(user.id, routeParams.id, body.rubric ?? body) }
  })
}
