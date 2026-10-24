import { neon } from '@neondatabase/serverless'
import { drizzle, type NeonHttpDatabase } from 'drizzle-orm/neon-http'
import { configureNeonTransport } from '@/db/neon-transport'
import * as schema from '@/db/schema'

let cachedDb: NeonHttpDatabase<typeof schema> | null = null

export function getDb(): NeonHttpDatabase<typeof schema> {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error('DATABASE_URL is required. Copy .env.example to .env.local and set your Neon connection string.')
  }

  configureNeonTransport(url)
  if (cachedDb) return cachedDb

  cachedDb = drizzle(neon(url), { schema })
  return cachedDb
}
