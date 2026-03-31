ALTER TABLE "users" ALTER COLUMN "debate_credits" SET DEFAULT 21;--> statement-breakpoint
UPDATE users SET debate_credits = 21
WHERE debate_credits = 10
  AND subscription_status = 'free'
  AND NOT EXISTS (
    SELECT 1 FROM credit_batches cb WHERE cb.user_id = users.id AND cb.pack_tier NOT IN ('free', 'migrated')
  );--> statement-breakpoint
UPDATE credit_batches SET credits_remaining = 21, credits_original = 21
WHERE pack_tier IN ('free', 'migrated')
  AND credits_original = 10
  AND credits_remaining = 10
  AND user_id IN (
    SELECT id FROM users WHERE subscription_status = 'free'
  );
