import { pool } from '../db';

export const LOCK_IDS = {
  APP_MIGRATIONS: 100,
  STRIPE_INIT: 101,
  STALE_RECOVERY: 102,
  ANALYTICS_BACKFILL: 103,
  CREDIT_EXPIRATION_CRON: 42,
  CRITICAL_STARTUP: 200,
} as const;

const BLOCKING_LOCK_TIMEOUT_MS = 120_000;

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

export async function withBlockingAdvisoryLock(
  lockId: number,
  jobName: string,
  fn: () => Promise<void>,
  options: { timeoutMs?: number } = {}
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? BLOCKING_LOCK_TIMEOUT_MS;
  const client = await pool.connect();
  let lockAcquired = false;
  const startWait = Date.now();

  const wallClockTimer = setTimeout(() => {
    console.error(`[LOCK] FATAL: Wall-clock timeout for "${jobName}" (${timeoutMs}ms) — force-destroying connection and aborting`);
    try { client.release(true); } catch {}
    process.exit(1);
  }, timeoutMs);
  wallClockTimer.unref();

  try {
    await client.query(`SET statement_timeout = ${timeoutMs}`);

    console.log(`[LOCK] Attempting blocking lock for "${jobName}" (lock ${lockId})...`);

    const probeResult = await client.query(
      `SELECT pg_try_advisory_lock($1) AS acquired`,
      [lockId]
    );
    const gotImmediately = probeResult.rows[0]?.acquired === true;

    if (gotImmediately) {
      lockAcquired = true;
      const elapsed = Date.now() - startWait;
      console.log(`[LOCK] Acquired "${jobName}" immediately (${elapsed}ms)`);
    } else {
      console.log(`[LOCK] Lock ${lockId} held by another instance — waiting for "${jobName}" (timeout: ${timeoutMs}ms)...`);
      await client.query(`SELECT pg_advisory_lock($1)`, [lockId]);
      lockAcquired = true;
      const waited = Date.now() - startWait;
      console.log(`[LOCK] Acquired "${jobName}" after waiting ${waited}ms`);
    }

    await fn();

    const totalMs = Date.now() - startWait;
    console.log(`[LOCK] "${jobName}" completed in ${totalMs}ms`);
  } catch (error: any) {
    if (error.message?.includes('statement timeout') || error.code === '57014') {
      console.error(`[LOCK] FATAL: Timed out waiting for "${jobName}" lock ${lockId} after ${timeoutMs}ms — aborting startup`);
      throw new Error(`Startup lock timeout: "${jobName}" did not complete within ${timeoutMs}ms`);
    }
    console.error(`[LOCK] FATAL: Error in "${jobName}" (lock ${lockId}):`, error.message);
    throw error;
  } finally {
    clearTimeout(wallClockTimer);
    if (lockAcquired) {
      try {
        await client.query(`SELECT pg_advisory_unlock($1)`, [lockId]);
      } catch (unlockErr) {
        console.error(`[LOCK] Failed to unlock "${jobName}" (lock ${lockId}) — destroying connection to prevent pooled-session lock retention`);
        try { client.release(true); } catch {}
        return;
      }
    }
    try {
      await client.query(`SET statement_timeout = 0`);
    } catch {
    }
    client.release();
  }
}
