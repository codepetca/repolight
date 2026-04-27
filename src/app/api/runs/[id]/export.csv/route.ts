import { requireUser } from '@/lib/auth/session'
import { exportRunResultsCsv } from '@/lib/runs/service'

export async function GET(_: Request, context: { params: { id: string } }) {
  const user = await requireUser()
  const csv = await exportRunResultsCsv(user.id, context.params.id)
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="repocat-${context.params.id}.csv"`,
    },
  })
}
