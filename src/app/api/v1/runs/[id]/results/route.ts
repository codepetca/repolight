import { handleApi } from '@/lib/api'
import { requireApiUser } from '@/lib/auth/api-key'
import { toRepocatResults } from '@/lib/integrations/results'
import { getRunResults } from '@/lib/runs/service'

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const routeParams = await context.params
  return handleApi(async () => {
    const user = await requireApiUser(request)
    return toRepocatResults(await getRunResults(user.id, routeParams.id))
  })
}
