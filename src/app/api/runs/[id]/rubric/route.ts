import { handleApi } from '@/lib/api'
import { requireUser } from '@/lib/auth/session'
import { updateRunRubric } from '@/lib/runs/service'

export async function PATCH(request: Request, context: { params: { id: string } }) {
  return handleApi(async () => {
    const user = await requireUser()
    const body = await request.json()
    return { run: await updateRunRubric(user.id, context.params.id, body.rubric ?? body) }
  })
}
