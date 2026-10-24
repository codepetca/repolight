import { serviceApi } from '@/lib/service/runtime'
import { serviceHandle } from '@/lib/service/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return serviceHandle(async () => (await serviceApi()).edits(request, (await context.params).id))
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  return serviceHandle(async () => (await serviceApi()).saveEdit(request, (await context.params).id))
}
