import { handleApi } from '@/lib/api'
import { requireUser } from '@/lib/auth/session'
import { getClassroomAssignmentDetail } from '@/lib/classroom/service'

export async function GET(
  _request: Request,
  { params }: { params: { id: string; assignmentId: string } },
) {
  return handleApi(async () => {
    const user = await requireUser()
    return {
      assignment: await getClassroomAssignmentDetail(user.id, params.id, params.assignmentId),
    }
  })
}
