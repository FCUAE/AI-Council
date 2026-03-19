import { pool } from '../db';

export const LOCK_IDS = {
  APP_MIGRATIONS: 100,
  STRIPE_INIT: 101,
  STALE_RECOVERY: 102,
  ANALYTICS_BACKFILL: 103,
  CREDIT_EXPIRATION_CRON: 42,
} as const;

export async function withAdvisoryLock(
  lockId: number,
  jobName: string,
  fn: () => Promise<void>
): Promise<boolean> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT pg_try_advisory_lock($1) AS acquired`,
      [lockId]
    );
    const acquired = result.rows[0]?.acquired === true;

    if (!acquired) {
      console.log(`[LOCK] Skipping "${jobName}" — advisory lock ${lockId} held by another instance`);
      return false;
    }

    try {
      await fn();
      return true;
    } finally {
      await client.query(`SELECT pg_advisory_unlock($1)`, [lockId]);
    }
  } catch (error: any) {
    console.error(`[LOCK] Error in "${jobName}" (lock ${lockId}):`, error.message);
    try {
      await client.query(`SELECT pg_advisory_unlock($1)`, [lockId]);
    } catch {
    }
    return false;
  } finally {
    client.release();
  }
}
