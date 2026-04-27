import { handleApi } from '@/lib/api'
import { requireApiUser } from '@/lib/auth/api-key'
import { toPikaResults } from '@/lib/integrations/pika'
import { getRunResults } from '@/lib/runs/service'

export async function GET(request: Request, context: { params: { id: string } }) {
  return handleApi(async () => {
    const user = await requireApiUser(request)
    return toPikaResults(await getRunResults(user.id, context.params.id))
  })
}
