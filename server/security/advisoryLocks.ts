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
  fn: () => Promise<void>,
  options: { critical?: boolean } = {}
): Promise<boolean> {
  const { critical = false } = options;
  const client = await pool.connect();
  let lockAcquired = false;
  try {
    const result = await client.query(
      `SELECT pg_try_advisory_lock($1) AS acquired`,
      [lockId]
    );
    lockAcquired = result.rows[0]?.acquired === true;

    if (!lockAcquired) {
      console.log(`[LOCK] Skipping "${jobName}" — advisory lock ${lockId} held by another instance`);
      return false;
    }

    await fn();
    return true;
  } catch (error: any) {
    console.error(`[LOCK] Error in "${jobName}" (lock ${lockId}):`, error.message);
    if (critical) {
      throw error;
    }
    return false;
  } finally {
    if (lockAcquired) {
      try {
        await client.query(`SELECT pg_advisory_unlock($1)`, [lockId]);
      } catch {
      }
    }
    client.release();
  }
}
