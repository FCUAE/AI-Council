import { storage } from "./storage";
import { users, creditTransactions } from "@shared/schema";
import { db } from "./db";
import { sql, eq } from "drizzle-orm";
import {
  sendCreditExpiryWarning,
  sendCreditExpiryFinalWarning,
  sendCreditExpiredNotice,
  sendEngagementNudge,
  sendPostExpiryReengagement,
  sendFreeExpiredConversion,
} from "./email";
import { withAdvisoryLock, LOCK_IDS } from "./security/advisoryLocks";

const FINAL_WARNING_HOURS = 48;
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const POST_EXPIRY_DAYS = 7;

const TIER_WARNING_DAYS: Record<string, number> = {
  explorer: 14,
  strategist: 21,
  mastermind: 30,
  free: 7,
};

function getWarningDays(packTier: string): number {
  return TIER_WARNING_DAYS[packTier] || 14;
}

type EmailPriority = 'final_warning' | 'warning' | 'engagement_nudge' | 'post_expiry' | 'free_expired';
const PRIORITY_ORDER: EmailPriority[] = ['final_warning', 'warning', 'post_expiry', 'engagement_nudge', 'free_expired'];

interface PendingEmail {
  userId: string;
  email: string;
  userName: string | null;
  priority: EmailPriority;
  batchId: number;
  credits: number;
  daysLeft: number;
  packTier: string;
  isUnsubscribed: boolean;
}

async function checkCreditExpiration() {
  console.log("[cron] Running batch credit expiration check...");

  const acquired = await withAdvisoryLock(
    LOCK_IDS.CREDIT_EXPIRATION_CRON,
    "credit-expiration-cron",
    async () => {
      const emailedUsersToday = new Set<string>();
      const pendingEmails = new Map<string, PendingEmail[]>();

      function addPending(p: PendingEmail) {
        const existing = pendingEmails.get(p.userId) || [];
        existing.push(p);
        pendingEmails.set(p.userId, existing);
      }

      const allTiers = Object.keys(TIER_WARNING_DAYS);
      let warnedCount = 0;
      for (const tier of allTiers) {
        const warningDays = getWarningDays(tier);
        const batchesToWarn = await storage.getExpiringBatches(warningDays);
        const tierBatches = batchesToWarn.filter(b => b.packTier === tier);

        for (const batch of tierBatches) {
          const [user] = await db.select().from(users).where(eq(users.id, batch.userId));
          if (!user?.email) continue;

          const daysLeft = Math.max(1, Math.ceil(
            (new Date(batch.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
          ));

          addPending({
            userId: batch.userId,
            email: user.email,
            userName: user.firstName,
            priority: 'warning',
            batchId: batch.id,
            credits: batch.creditsRemaining,
            daysLeft,
            packTier: batch.packTier,
            isUnsubscribed: user.emailUnsubscribed,
          });
        }
      }

      let finalWarnedCount = 0;
      const batchesToFinalWarn = await storage.getFinalWarningBatches(FINAL_WARNING_HOURS);
      for (const batch of batchesToFinalWarn) {
        const [user] = await db.select().from(users).where(eq(users.id, batch.userId));
        if (!user?.email) continue;

        addPending({
          userId: batch.userId,
          email: user.email,
          userName: user.firstName,
          priority: 'final_warning',
          batchId: batch.id,
          credits: batch.creditsRemaining,
          daysLeft: 0,
          packTier: batch.packTier,
          isUnsubscribed: user.emailUnsubscribed,
        });
      }

      const midLifeBatches = await storage.getMidLifeBatches();
      for (const batch of midLifeBatches) {
        const [user] = await db.select().from(users).where(eq(users.id, batch.userId));
        if (!user?.email) continue;

        const usagePercent = await storage.getCreditUsagePercent(batch.userId);
        if (usagePercent >= 50) {
          await storage.markBatchEmailSent(batch.id, 'engagement_nudge_sent');
          continue;
        }

        const daysLeft = Math.max(1, Math.ceil(
          (new Date(batch.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
        ));

        addPending({
          userId: batch.userId,
          email: user.email,
          userName: user.firstName,
          priority: 'engagement_nudge',
          batchId: batch.id,
          credits: batch.creditsRemaining,
          daysLeft,
          packTier: batch.packTier,
          isUnsubscribed: user.emailUnsubscribed,
        });
      }

      const postExpiryBatches = await storage.getPostExpiryBatches(POST_EXPIRY_DAYS);
      for (const batch of postExpiryBatches) {
        const [user] = await db.select().from(users).where(eq(users.id, batch.userId));
        if (!user?.email) continue;

        addPending({
          userId: batch.userId,
          email: user.email,
          userName: user.firstName,
          priority: 'post_expiry',
          batchId: batch.id,
          credits: batch.creditsRemaining,
          daysLeft: 0,
          packTier: batch.packTier,
          isUnsubscribed: user.emailUnsubscribed,
        });
      }

      const freeExpiredBatches = await storage.getFreeTierExpiredBatches();
      for (const batch of freeExpiredBatches) {
        const [user] = await db.select().from(users).where(eq(users.id, batch.userId));
        if (!user?.email) continue;

        addPending({
          userId: batch.userId,
          email: user.email,
          userName: user.firstName,
          priority: 'free_expired',
          batchId: batch.id,
          credits: batch.creditsRemaining,
          daysLeft: 0,
          packTier: 'free',
          isUnsubscribed: user.emailUnsubscribed,
        });
      }

      let sentCount = 0;
      const userIds = Array.from(pendingEmails.keys());
      for (const userId of userIds) {
        const userEmails = pendingEmails.get(userId)!;
        const alreadyEmailed = await storage.wasUserEmailedToday(userId);
        if (alreadyEmailed) {
          console.log(`[cron] Skipping user ${userId} — already emailed today`);
          for (const pe of userEmails) {
            if (['warning', 'final_warning'].includes(pe.priority)) {
              // don't mark as sent so we retry tomorrow
            }
          }
          continue;
        }

        userEmails.sort((a: PendingEmail, b: PendingEmail) => PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority));
        const primary = userEmails[0];

        const isTransactional = ['warning', 'final_warning'].includes(primary.priority);
        if (!isTransactional && primary.isUnsubscribed) {
          console.log(`[cron] Skipping promotional email for unsubscribed user ${userId}`);
          for (const pe of userEmails) {
            if (pe.priority === 'engagement_nudge') {
              await storage.markBatchEmailSent(pe.batchId, 'engagement_nudge_sent');
            } else if (pe.priority === 'post_expiry' || pe.priority === 'free_expired') {
              await storage.markBatchEmailSent(pe.batchId, 'post_expiry_sent');
            }
          }
          continue;
        }

        let sent = false;

        if (primary.priority === 'final_warning') {
          const usagePercent = await storage.getCreditUsagePercent(userId);
          sent = await sendCreditExpiryFinalWarning(primary.email, primary.userName, primary.credits, primary.packTier, userId, usagePercent);
          if (sent) {
            await storage.markBatchWarningSent(primary.batchId, 'final_warning_sent');
            storage.trackEvent("credits_expiring_notification_sent", userId, { batchId: primary.batchId, creditsRemaining: primary.credits, type: "final_warning" });
            for (const pe of userEmails.slice(1)) {
              if (pe.priority === 'final_warning') {
                await storage.markBatchWarningSent(pe.batchId, 'final_warning_sent');
              }
            }
          }
        } else if (primary.priority === 'warning') {
          sent = await sendCreditExpiryWarning(primary.email, primary.userName, primary.credits, primary.daysLeft, primary.packTier, userId);
          if (sent) {
            await storage.markBatchWarningSent(primary.batchId, 'warning_sent');
            storage.trackEvent("credits_expiring_notification_sent", userId, { batchId: primary.batchId, creditsRemaining: primary.credits, daysLeft: primary.daysLeft, type: "warning" });
            for (const pe of userEmails.slice(1).filter((e: PendingEmail) => e.priority === 'warning')) {
              await storage.markBatchWarningSent(pe.batchId, 'warning_sent');
            }
          }
        } else if (primary.priority === 'engagement_nudge') {
          sent = await sendEngagementNudge(primary.email, primary.userName, primary.credits, primary.daysLeft, primary.packTier, userId);
          if (sent) {
            await storage.markBatchEmailSent(primary.batchId, 'engagement_nudge_sent');
            storage.trackEvent("engagement_nudge_sent", userId, { batchId: primary.batchId });
          }
        } else if (primary.priority === 'post_expiry') {
          sent = await sendPostExpiryReengagement(primary.email, primary.userName, primary.credits, primary.packTier, userId);
          if (sent) {
            await storage.markBatchEmailSent(primary.batchId, 'post_expiry_sent');
            storage.trackEvent("post_expiry_reengagement_sent", userId, { batchId: primary.batchId });
          }
        } else if (primary.priority === 'free_expired') {
          sent = await sendFreeExpiredConversion(primary.email, primary.userName, userId);
          if (sent) {
            await storage.markBatchEmailSent(primary.batchId, 'post_expiry_sent');
            storage.trackEvent("free_expired_conversion_sent", userId, { batchId: primary.batchId });
          }
        }

        if (sent) {
          await storage.markUserEmailed(userId);
          sentCount++;
        }
      }

      if (sentCount > 0) console.log(`[cron] Sent ${sentCount} consolidated email(s)`);

      let expiredCount = 0;
      const expiredBatches = await storage.getExpiredBatches();
      for (const batch of expiredBatches) {
        const expiredCredits = batch.creditsRemaining;
        await storage.updateBatchStatus(batch.id, "expired");

        if (expiredCredits > 0) {
          await db.insert(creditTransactions).values({
            userId: batch.userId,
            type: "deduction",
            amount: -expiredCredits,
            balanceAfter: 0,
            description: `${expiredCredits} credits expired (batch #${batch.id})`,
          });

          await storage.syncUserCreditsFromBatches(batch.userId);

          const [user] = await db.select().from(users).where(eq(users.id, batch.userId));
          if (user?.email) {
            const alreadyEmailed = await storage.wasUserEmailedToday(batch.userId);
            if (!alreadyEmailed) {
              await sendCreditExpiredNotice(user.email, user.firstName, expiredCredits, batch.packTier);
              await storage.markUserEmailed(batch.userId);
            }
          }
        }

        storage.trackEvent("credits_expired", batch.userId, { batchId: batch.id, creditsExpired: expiredCredits, packTier: batch.packTier });
        expiredCount++;
        console.log(`[cron] Batch #${batch.id} → expired (${expiredCredits} credits, user ${batch.userId})`);
      }
      if (expiredCount > 0) console.log(`[cron] Expired ${expiredCount} batch(es)`);

      if (sentCount === 0 && expiredCount === 0) {
        console.log("[cron] No batches to warn or expire");
      }
    }
  );

  if (!acquired) {
    console.log("[cron] Credit expiration check skipped — another instance holds the lock");
  }
}

export function startCreditExpirationCron() {
  console.log(`[cron] Batch credit expiration cron started (checks every 24h, tier-aware warnings, 48h final)`);

  setTimeout(() => {
    checkCreditExpiration();
  }, 30000);

  setInterval(checkCreditExpiration, CHECK_INTERVAL_MS);
}
