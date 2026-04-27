import { handleApi } from '@/lib/api'
import { requireApiUser } from '@/lib/auth/api-key'
import { serializePikaResultsCsv } from '@/lib/integrations/pika'
import { getRunResults } from '@/lib/runs/service'

export async function GET(request: Request, context: { params: { id: string } }) {
  return handleApi(async () => {
    const user = await requireApiUser(request)
    const csv = serializePikaResultsCsv(await getRunResults(user.id, context.params.id))
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="repocat-pika-${context.params.id}.csv"`,
      },
    })
  })
}
