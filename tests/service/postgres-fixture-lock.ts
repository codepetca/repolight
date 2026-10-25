import type { Pool } from 'pg'

/** Held on a dedicated session for the whole suite; migration locks use another connection. */
export async function acquireServiceFixtureLock(pool: Pool): Promise<() => Promise<void>> {
  const connection = await pool.connect()
  try {
    await connection.query("SET statement_timeout='20s'")
    await connection.query('SELECT pg_advisory_lock(7839014523::bigint)')
    await connection.query('RESET statement_timeout')
  } catch (error) { connection.release(true); throw error }
  return async () => {
    let unlocked = false
    try { await connection.query('SELECT pg_advisory_unlock(7839014523::bigint)'); unlocked = true }
    finally { connection.release(!unlocked) }
  }
}
