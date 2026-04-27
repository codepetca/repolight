import { handleApi } from '@/lib/api'
import { requireApiUser } from '@/lib/auth/api-key'
import { buildPikaCreateRunInput, pikaCreateRunSchema } from '@/lib/integrations/pika'
import { createRunFromParsed } from '@/lib/runs/service'

export async function POST(request: Request) {
  return handleApi(async () => {
    const user = await requireApiUser(request)
    const payload = pikaCreateRunSchema.parse(await request.json())
    const run = await createRunFromParsed(user.id, buildPikaCreateRunInput(payload))

    return {
      run,
      links: linksFor(request, run.id),
    }
  })
}

function linksFor(request: Request, runId: string) {
  const base = new URL(request.url)
  const runUrl = new URL(`/api/v1/runs/${runId}`, base)
  return {
    status: runUrl.toString(),
    process: new URL(`/api/v1/runs/${runId}/process`, base).toString(),
    results: new URL(`/api/v1/runs/${runId}/results`, base).toString(),
    exportCsv: new URL(`/api/v1/runs/${runId}/export.csv`, base).toString(),
  }
}
