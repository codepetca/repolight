import { handleApi } from '@/lib/api'
import { requireApiUser } from '@/lib/auth/api-key'
import { getRunDetail } from '@/lib/runs/service'

export async function GET(request: Request, context: { params: { id: string } }) {
  return handleApi(async () => {
    const user = await requireApiUser(request)
    return { run: await getRunDetail(user.id, context.params.id) }
  })
}
