import { db } from '../db';
import { sql } from 'drizzle-orm';

export async function checkPerUserLimit(
  userId: string,
  maxPerWindow: number,
  windowMs: number = 60_000,
  route: string = "global"
): Promise<boolean> {
  const windowSeconds = Math.ceil(windowMs / 1000);

  const result = await db.execute(sql`
    INSERT INTO rate_limit_buckets (route_key, user_id, count, reset_at)
    VALUES (${route}, ${userId}, 1, NOW() + (${windowSeconds.toString()} || ' seconds')::interval)
    ON CONFLICT (route_key, user_id) DO UPDATE SET
      count = CASE
        WHEN rate_limit_buckets.reset_at <= NOW() THEN 1
        ELSE rate_limit_buckets.count + 1
      END,
      reset_at = CASE
        WHEN rate_limit_buckets.reset_at <= NOW() THEN NOW() + (${windowSeconds.toString()} || ' seconds')::interval
        ELSE rate_limit_buckets.reset_at
      END
    RETURNING count
  `);

  const count = (result.rows[0] as any)?.count ?? 1;
  return count <= maxPerWindow;
}

let cleanupInterval: ReturnType<typeof setInterval> | null = null;

export function startRateLimitCleanup() {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(async () => {
    try {
      const result = await db.execute(sql`
        DELETE FROM rate_limit_buckets WHERE reset_at < NOW()
      `);
      if (result.rowCount && result.rowCount > 0) {
        console.log(`[RATE LIMIT] Cleaned up ${result.rowCount} expired bucket(s)`);
      }
    } catch (error: any) {
      console.error('[RATE LIMIT] Cleanup error:', error.message);
    }
  }, 15 * 60_000);
  cleanupInterval.unref();
}
