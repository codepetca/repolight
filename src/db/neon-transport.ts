import { neonConfig } from '@neondatabase/serverless'

const defaultEndpoint = neonConfig.fetchEndpoint
let localEndpointInstalled = false

/** Explicit, disposable local development only. Normal Neon transport is unchanged. */
export function configureNeonTransport(databaseUrl: string): void {
  const endpoint = process.env.REPOLIGHT_LOCAL_NEON_HTTP_URL
  if (!endpoint) {
    if (localEndpointInstalled) neonConfig.fetchEndpoint = defaultEndpoint
    localEndpointInstalled = false
    return
  }
  if (!['development', 'test'].includes(process.env.NODE_ENV ?? '')) {
    throw new Error('Local Neon HTTP transport is permitted only in development or tests.')
  }
  let target: URL
  let database: URL
  try {
    target = new URL(endpoint)
    database = new URL(databaseUrl)
  } catch {
    throw new Error('Invalid local Neon transport configuration.')
  }
  if (!['http:', 'https:'].includes(target.protocol) || !['127.0.0.1', '[::1]'].includes(target.hostname)
    || target.pathname !== '/sql' || target.username || target.password || target.search || target.hash) {
    throw new Error('Local Neon endpoint must be a literal loopback HTTP(S) URL with exact /sql path and no credentials, query or fragment.')
  }
  if (!['postgres:', 'postgresql:'].includes(database.protocol) || database.hostname !== '127.0.0.1'
    || database.port !== '55487' || database.pathname !== '/repolight_service'
    || !database.username || !database.password || database.search || database.hash) {
    throw new Error('Local Neon transport requires the explicit disposable database target.')
  }
  neonConfig.fetchEndpoint = target.href
  localEndpointInstalled = true
}
