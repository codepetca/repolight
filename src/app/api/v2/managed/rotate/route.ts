import { createManagedProvisionApi } from '@/lib/service/managed'
import { createServiceStore } from '@/lib/service/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  return createManagedProvisionApi(createServiceStore(), 'rotate')(request)
}
