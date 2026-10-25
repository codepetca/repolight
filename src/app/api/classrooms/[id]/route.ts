import { handleApi } from '@/lib/api'
import { requireUser } from '@/lib/auth/session'
import { getClassroomDetail } from '@/lib/classroom/service'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const routeParams = await params
  return handleApi(async () => {
    const user = await requireUser()
    return { classroom: await getClassroomDetail(user.id, routeParams.id) }
  })
}
