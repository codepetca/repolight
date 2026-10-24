import { handleApi } from '@/lib/api'
import { requireApiUser } from '@/lib/auth/api-key'
import { serializeRepocatResultsCsv } from '@/lib/integrations/results'
import { getRunResults } from '@/lib/runs/service'

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const routeParams = await context.params
  return handleApi(async () => {
    const user = await requireApiUser(request)
    const csv = serializeRepocatResultsCsv(await getRunResults(user.id, routeParams.id))
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="repolight-${routeParams.id}.csv"`,
      },
    })
  })
}
