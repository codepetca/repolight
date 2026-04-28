import { handleApi } from '@/lib/api'
import { requireUser } from '@/lib/auth/session'
import { provisionAssignmentRepositories } from '@/lib/classroom/service'

export async function POST(
  _request: Request,
  { params }: { params: { id: string; assignmentId: string } },
) {
  return handleApi(async () => {
    const user = await requireUser()
    return await provisionAssignmentRepositories(user.id, params.id, params.assignmentId)
  })
}
