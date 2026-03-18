ALTER TABLE "users" ALTER COLUMN "debate_credits" SET DEFAULT 15;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "actual_api_cost" numeric;