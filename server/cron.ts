import { storage } from "./storage";
import { users, creditTransactions, creditBatches, analyticsEvents } from "@shared/schema";
import { db } from "./db";
import { sql, eq } from "drizzle-orm";
import { sendCreditExpiryWarning, sendCreditExpiryFinalWarning, sendCreditExpiredNotice } from "./email";
import { withAdvisoryLock, LOCK_IDS } from "./security/advisoryLocks";

const WARNING_DAYS = 7;
const FINAL_WARNING_HOURS = 24;
const DORMANCY_DAYS = 30;
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

async function checkCreditExpiration() {
  console.log("[cron] Running batch credit expiration check...");

  const acquired = await withAdvisoryLock(
    LOCK_IDS.CREDIT_EXPIRATION_CRON,
    "credit-expiration-cron",
    async () => {
      let warnedCount = 0;
      const batchesToWarn = await storage.getExpiringBatches(WARNING_DAYS);
      for (const batch of batchesToWarn) {
        const [user] = await db.select().from(users).where(eq(users.id, batch.userId));
        if (!user?.email) continue;

        const daysLeft = Math.max(1, Math.ceil(
          (new Date(batch.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
        ));

        const sent = await sendCreditExpiryWarning(
          user.email,
          user.firstName,
          batch.creditsRemaining,
          daysLeft
        );

        if (sent) {
          await storage.markBatchWarningSent(batch.id, 'warning_sent');
          storage.trackEvent("credits_expiring_notification_sent", batch.userId, { batchId: batch.id, creditsRemaining: batch.creditsRemaining, daysLeft, type: "warning" });
          warnedCount++;
        }
      }
      if (warnedCount > 0) console.log(`[cron] Sent ${warnedCount} batch expiry warning(s)`);

      let finalWarnedCount = 0;
      const batchesToFinalWarn = await storage.getFinalWarningBatches(FINAL_WARNING_HOURS);
      for (const batch of batchesToFinalWarn) {
        const [user] = await db.select().from(users).where(eq(users.id, batch.userId));
        if (!user?.email) continue;

        const sent = await sendCreditExpiryFinalWarning(
          user.email,
          user.firstName,
          batch.creditsRemaining
        );

        if (sent) {
          await storage.markBatchWarningSent(batch.id, 'final_warning_sent');
          storage.trackEvent("credits_expiring_notification_sent", batch.userId, { batchId: batch.id, creditsRemaining: batch.creditsRemaining, type: "final_warning" });
          finalWarnedCount++;
        }
      }
      if (finalWarnedCount > 0) console.log(`[cron] Sent ${finalWarnedCount} batch final expiry warning(s)`);

      let dormantCount = 0;
      const expiredBatches = await storage.getExpiredBatches();
      for (const batch of expiredBatches) {
        const expiredCredits = batch.creditsRemaining;
        await storage.updateBatchStatus(batch.id, "dormant");

        if (expiredCredits > 0) {
          await db.insert(creditTransactions).values({
            userId: batch.userId,
            type: "deduction",
            amount: -expiredCredits,
            balanceAfter: 0,
            description: `${expiredCredits} credits expired (batch #${batch.id}, ${batch.packTier} pack)`,
          });

          await storage.syncUserCreditsFromBatches(batch.userId);

          const [user] = await db.select().from(users).where(eq(users.id, batch.userId));
          if (user?.email) {
            await sendCreditExpiredNotice(user.email, user.firstName, expiredCredits);
          }
        }

        storage.trackEvent("credits_expired", batch.userId, { batchId: batch.id, creditsExpired: expiredCredits, packTier: batch.packTier });
        dormantCount++;
        console.log(`[cron] Batch #${batch.id} → dormant (${expiredCredits} credits, user ${batch.userId})`);
      }
      if (dormantCount > 0) console.log(`[cron] Set ${dormantCount} batch(es) to dormant`);

      let removedCount = 0;
      const dormantBatches = await storage.getDormantBatchesForRemoval(DORMANCY_DAYS);
      for (const batch of dormantBatches) {
        await storage.updateBatchStatus(batch.id, "expired");
        removedCount++;
        console.log(`[cron] Batch #${batch.id} → expired (permanently removed after ${DORMANCY_DAYS}d dormancy)`);
      }
      if (removedCount > 0) console.log(`[cron] Permanently expired ${removedCount} dormant batch(es)`);

      if (warnedCount === 0 && finalWarnedCount === 0 && dormantCount === 0 && removedCount === 0) {
        console.log("[cron] No batches to warn or expire");
      }
    }
  );

  if (!acquired) {
    console.log("[cron] Credit expiration check skipped — another instance holds the lock");
  }
}

export function startCreditExpirationCron() {
  console.log(`[cron] Batch credit expiration cron started (checks every 24h, warns at ${WARNING_DAYS}d, final warn at ${FINAL_WARNING_HOURS}h, dormancy ${DORMANCY_DAYS}d)`);

  setTimeout(() => {
    checkCreditExpiration();
  }, 30000);

  setInterval(checkCreditExpiration, CHECK_INTERVAL_MS);
}
