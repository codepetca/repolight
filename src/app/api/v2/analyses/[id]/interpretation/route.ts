import { interpretationApi } from '@/lib/interpretation/runtime'
import { serviceHandle } from '@/lib/service/http'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return serviceHandle(async () => (await interpretationApi()).get(request, (await context.params).id))
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return serviceHandle(async () => (await interpretationApi()).post(request, (await context.params).id))
}
