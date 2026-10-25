import { createServiceApi } from './api'

/** Resolve credentials and database configuration only while handling a request. */
export async function serviceApi() {
  const [{ createServiceStore }, { getOptionalUser }] = await Promise.all([import('./store'), import('@/lib/auth/session')])
  return createServiceApi(createServiceStore(), getOptionalUser)
}
