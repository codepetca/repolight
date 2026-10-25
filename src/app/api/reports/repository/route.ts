import { analyzePublicRepositoryBundle } from '@/lib/report/bundle-analyze'
import { handleLocalReportRequest } from '@/lib/report/local-route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  return handleLocalReportRequest(request, analyzePublicRepositoryBundle)
}
