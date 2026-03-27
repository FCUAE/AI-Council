import { sql } from "drizzle-orm";
import { boolean, integer, numeric, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  deliberationCount: integer("deliberation_count").default(0).notNull(),
  debateCredits: integer("debate_credits").default(10).notNull(),
  subscriptionStatus: varchar("subscription_status").default("free").notNull(),
  stripeCustomerId: varchar("stripe_customer_id"),
  stripeSubscriptionId: varchar("stripe_subscription_id"),
  monthlyDebatesUsed: integer("monthly_debates_used").default(0).notNull(),
  monthlyResetAt: timestamp("monthly_reset_at"),
  creditsPurchasedAt: timestamp("credits_purchased_at"),
  creditsExpiryWarned: boolean("credits_expiry_warned").default(false).notNull(),
  creditsExpiryFinalWarned: boolean("credits_expiry_final_warned").default(false).notNull(),
  totalApiCost: numeric("total_api_cost").default("0").notNull(),
  totalRevenue: numeric("total_revenue").default("0").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const creditTransactions = pgTable("credit_transactions", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  email: varchar("email"),
  type: varchar("type", { length: 20 }).notNull(),
  amount: integer("amount").notNull(),
  balanceAfter: integer("balance_after").notNull(),
  description: text("description"),
  stripeSessionId: varchar("stripe_session_id"),
  conversationId: integer("conversation_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const creditBatches = pgTable("credit_batches", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  creditsRemaining: integer("credits_remaining").notNull(),
  creditsOriginal: integer("credits_original").notNull(),
  purchasedAt: timestamp("purchased_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  packTier: varchar("pack_tier", { length: 20 }).notNull(),
  status: varchar("status", { length: 20 }).default("active").notNull(),
  stripeSessionId: varchar("stripe_session_id"),
  warningSent: boolean("warning_sent").default(false).notNull(),
  finalWarningSent: boolean("final_warning_sent").default(false).notNull(),
});

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;
export type InsertCreditTransaction = typeof creditTransactions.$inferInsert;
export type CreditTransaction = typeof creditTransactions.$inferSelect;
export type CreditBatch = typeof creditBatches.$inferSelect;
export type InsertCreditBatch = typeof creditBatches.$inferInsert;
