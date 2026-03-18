CREATE TABLE "conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar,
	"title" text NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL,
	"models" text[],
	"chairman_model" text,
	"reserved_credits" integer DEFAULT 0 NOT NULL,
	"estimated_credits" integer DEFAULT 0 NOT NULL,
	"settled" integer DEFAULT 0 NOT NULL,
	"context_summary" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "council_responses" (
	"id" serial PRIMARY KEY NOT NULL,
	"message_id" integer NOT NULL,
	"model" text NOT NULL,
	"content" text NOT NULL,
	"stage" text NOT NULL,
	"error" text,
	"substituted_for" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"attachments" jsonb,
	"status" text DEFAULT 'processing' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "queries" (
	"id" serial PRIMARY KEY NOT NULL,
	"prompt" text NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL,
	"parent_query_id" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "responses" (
	"id" serial PRIMARY KEY NOT NULL,
	"query_id" integer NOT NULL,
	"model" text NOT NULL,
	"content" text NOT NULL,
	"stage" text NOT NULL,
	"rank" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "credit_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"email" varchar,
	"type" varchar(20) NOT NULL,
	"amount" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"description" text,
	"stripe_session_id" varchar,
	"conversation_id" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar,
	"first_name" varchar,
	"last_name" varchar,
	"profile_image_url" varchar,
	"deliberation_count" integer DEFAULT 0 NOT NULL,
	"debate_credits" integer DEFAULT 15 NOT NULL,
	"subscription_status" varchar DEFAULT 'free' NOT NULL,
	"stripe_customer_id" varchar,
	"stripe_subscription_id" varchar,
	"monthly_debates_used" integer DEFAULT 0 NOT NULL,
	"monthly_reset_at" timestamp,
	"credits_purchased_at" timestamp,
	"credits_expiry_warned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
