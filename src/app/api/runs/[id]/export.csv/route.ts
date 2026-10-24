import { requireUser } from '@/lib/auth/session'
import { exportRunResultsCsv } from '@/lib/runs/service'

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const routeParams = await context.params
  const user = await requireUser()
  const csv = await exportRunResultsCsv(user.id, routeParams.id)
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="repolight-${routeParams.id}.csv"`,
    },
  })
}
