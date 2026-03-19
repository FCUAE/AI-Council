/**
 * Standalone script: Correct double-refund credits for a specific user.
 *
 * This was originally a startup job but has been extracted as a one-off script
 * that must be intentionally invoked. It subtracts 7 extra credits that were
 * granted due to a double-refund bug.
 *
 * Usage:
 *   npx tsx scripts/fix-double-refund-credit-correction.ts
 *
 * Prerequisites:
 *   - DATABASE_URL environment variable must be set
 *
 * Safety:
 *   - Fully idempotent: uses SELECT FOR UPDATE + existence check within a
 *     single transaction to prevent TOCTOU races under concurrent execution
 *   - Logs all actions to stdout
 */

import pg from "pg";
const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

async function correctDoubleRefundCredits() {
  const affectedUserId = "user_3AqlXjlXEI1i84EvcXa2v43EzgT";
  const correctionDescription = "Correction: subtract extra 7 credits from double-refund bug";
  const correctionAmount = 7;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const userResult = await client.query(
      `SELECT debate_credits FROM users WHERE id = $1 FOR UPDATE`,
      [affectedUserId]
    );
    if (userResult.rows.length === 0) {
      await client.query("COMMIT");
      console.log("[CORRECTION] User not found — skipping.");
      return;
    }

    const existingResult = await client.query(
      `SELECT id FROM credit_transactions WHERE user_id = $1 AND description = $2 LIMIT 1`,
      [affectedUserId, correctionDescription]
    );
    if (existingResult.rows.length > 0) {
      await client.query("COMMIT");
      console.log("[CORRECTION] Already applied — skipping.");
      return;
    }

    const currentCredits = userResult.rows[0].debate_credits;
    const newBalance = Math.max(0, currentCredits - correctionAmount);

    await client.query(
      `UPDATE users SET debate_credits = $1, updated_at = NOW() WHERE id = $2`,
      [newBalance, affectedUserId]
    );
    await client.query(
      `INSERT INTO credit_transactions (user_id, type, amount, balance_after, description, conversation_id)
       VALUES ($1, 'correction', $2, $3, $4, NULL)`,
      [affectedUserId, -correctionAmount, newBalance, correctionDescription]
    );
    await client.query("COMMIT");

    console.log(
      `[CORRECTION] Subtracted ${correctionAmount} credits from user ${affectedUserId} (${currentCredits} -> ${newBalance})`
    );
  } catch (error: any) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(`[CORRECTION] Failed:`, error.message);
    throw error;
  } finally {
    client.release();
  }
}

correctDoubleRefundCredits()
  .then(async () => {
    console.log("[CORRECTION] Done.");
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("[CORRECTION] Unexpected error:", err);
    await pool.end().catch(() => {});
    process.exit(1);
  });
