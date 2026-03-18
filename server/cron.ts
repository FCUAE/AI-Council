import { db, pool } from "./db";
import { users, creditTransactions } from "@shared/schema";
import { sql } from "drizzle-orm";
import { sendCreditExpiryWarning, sendCreditExpiryFinalWarning, sendCreditExpiredNotice } from "./email";

const EXPIRY_DAYS = 60;
const WARNING_DAYS = 30;
const FINAL_WARNING_HOURS = 48;
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

async function checkCreditExpiration() {
  console.log("[cron] Running credit expiration check...");

  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(42)");

    const warningThreshold = new Date();
    warningThreshold.setDate(warningThreshold.getDate() - WARNING_DAYS);

    const expiryThreshold = new Date();
    expiryThreshold.setDate(expiryThreshold.getDate() - EXPIRY_DAYS);

    const usersToWarn = await db.select().from(users).where(
      sql`credits_purchased_at IS NOT NULL 
          AND debate_credits > 0 
          AND credits_expiry_warned = false 
          AND credits_purchased_at <= ${warningThreshold}
          AND credits_purchased_at > ${expiryThreshold}`
    );

    let warnedCount = 0;
    for (const user of usersToWarn) {
      if (!user.email) continue;

      const daysLeft = Math.max(1, Math.ceil(
        (EXPIRY_DAYS - (Date.now() - new Date(user.creditsPurchasedAt!).getTime()) / (1000 * 60 * 60 * 24))
      ));

      const sent = await sendCreditExpiryWarning(
        user.email,
        user.firstName,
        user.debateCredits,
        daysLeft
      );

      if (sent) {
        const result = await db.update(users)
          .set({ creditsExpiryWarned: true })
          .where(sql`id = ${user.id} AND credits_expiry_warned = false`);
        warnedCount++;
      }
    }

    if (warnedCount > 0) {
      console.log(`[cron] Sent ${warnedCount} expiry warning(s)`);
    }

    const finalWarningThreshold = new Date();
    finalWarningThreshold.setTime(finalWarningThreshold.getTime() - (EXPIRY_DAYS * 24 - FINAL_WARNING_HOURS) * 60 * 60 * 1000);

    const usersToFinalWarn = await db.select().from(users).where(
      sql`credits_purchased_at IS NOT NULL 
          AND debate_credits > 0 
          AND credits_expiry_final_warned = false 
          AND credits_purchased_at <= ${finalWarningThreshold}
          AND credits_purchased_at > ${expiryThreshold}`
    );

    let finalWarnedCount = 0;
    for (const user of usersToFinalWarn) {
      if (!user.email) continue;

      const sent = await sendCreditExpiryFinalWarning(
        user.email,
        user.firstName,
        user.debateCredits
      );

      if (sent) {
        await db.update(users)
          .set({ creditsExpiryFinalWarned: true })
          .where(sql`id = ${user.id} AND credits_expiry_final_warned = false`);
        finalWarnedCount++;
      }
    }

    if (finalWarnedCount > 0) {
      console.log(`[cron] Sent ${finalWarnedCount} final expiry warning(s)`);
    }

    const usersToExpire = await db.select().from(users).where(
      sql`credits_purchased_at IS NOT NULL 
          AND debate_credits > 0 
          AND credits_purchased_at <= ${expiryThreshold}`
    );

    let expiredCount = 0;
    for (const user of usersToExpire) {
      const expireResult = await client.query(
        `UPDATE users 
         SET debate_credits = 0, credits_purchased_at = NULL, credits_expiry_warned = false, credits_expiry_final_warned = false, updated_at = NOW()
         WHERE id = $1 AND debate_credits > 0 AND credits_purchased_at <= $2
         RETURNING debate_credits`,
        [user.id, expiryThreshold]
      );

      if (expireResult.rowCount === 0) continue;

      const expiredCredits = user.debateCredits;

      await db.insert(creditTransactions).values({
        userId: user.id,
        email: user.email,
        type: "deduction",
        amount: -expiredCredits,
        balanceAfter: 0,
        description: `${expiredCredits} credits expired after ${EXPIRY_DAYS} days of inactivity`,
      });

      if (user.email) {
        await sendCreditExpiredNotice(user.email, user.firstName, expiredCredits);
      }

      expiredCount++;
      console.log(`[cron] Expired ${expiredCredits} credits for user ${user.id}`);
    }

    if (expiredCount > 0) {
      console.log(`[cron] Expired credits for ${expiredCount} user(s)`);
    }

    if (warnedCount === 0 && finalWarnedCount === 0 && expiredCount === 0) {
      console.log("[cron] No credits to warn or expire");
    }
  } catch (error) {
    console.error("[cron] Credit expiration check failed:", error);
  } finally {
    await client.query("SELECT pg_advisory_unlock(42)").catch(() => {});
    client.release();
  }
}

export function startCreditExpirationCron() {
  console.log(`[cron] Credit expiration cron started (checks every 24h, warns at ${WARNING_DAYS}d, final warn at ${FINAL_WARNING_HOURS}h, expires at ${EXPIRY_DAYS}d)`);

  setTimeout(() => {
    checkCreditExpiration();
  }, 30000);

  setInterval(checkCreditExpiration, CHECK_INTERVAL_MS);
}
