import { neon } from '@neondatabase/serverless'
import { configureNeonTransport } from '@/db/neon-transport'

/** Both Neon HTTP and the explicit disposable-Postgres test adapter execute this SQL. */
export interface SqlExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(text: string, parameters?: unknown[]): Promise<Row[]>;
}
export function createNeonSqlExecutor(databaseUrl: string): SqlExecutor {
  if (!databaseUrl) throw new Error('Service database is not configured.')
  configureNeonTransport(databaseUrl)
  const client = neon(databaseUrl)
  return { async query<Row extends Record<string, unknown>>(text: string, parameters: unknown[] = []) {
    return await client.query(text, parameters) as Row[]
  } }
}
