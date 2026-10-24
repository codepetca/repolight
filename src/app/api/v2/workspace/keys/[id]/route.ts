import { serviceApi } from '@/lib/service/runtime'
import { serviceHandle } from '@/lib/service/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return serviceHandle(async () => (await serviceApi()).revokeKey(request, (await context.params).id))
}
