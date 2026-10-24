import { handleApi } from '@/lib/api'
import { requireUser } from '@/lib/auth/session'
import { getClassroomAssignmentDetail } from '@/lib/classroom/service'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; assignmentId: string }> },
) {
  const routeParams = await params
  return handleApi(async () => {
    const user = await requireUser()
    return {
      assignment: await getClassroomAssignmentDetail(user.id, routeParams.id, routeParams.assignmentId),
    }
  })
}
