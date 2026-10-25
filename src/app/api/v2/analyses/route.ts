import { serviceApi } from '@/lib/service/runtime'
import { serviceHandle } from '@/lib/service/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  return serviceHandle(async () => (await serviceApi()).list(request))
}

export async function POST(request: Request) {
  return serviceHandle(async () => (await serviceApi()).create(request))
}
