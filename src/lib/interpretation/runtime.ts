import { createServiceStore } from '@/lib/service/store'
import { createInterpretationStore } from './store'
import { createInterpretationApi } from './api'
export async function interpretationApi() {
  const { getOptionalUser } = await import('@/lib/auth/session')
  return createInterpretationApi(createServiceStore(), createInterpretationStore(), getOptionalUser)
}
