import { pgTable, text, serial, integer, timestamp, jsonb, varchar, numeric, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export * from "./models/auth";

export const platformAnalytics = pgTable("platform_analytics", {
  id: serial("id").primaryKey(),
  date: date("date").unique().notNull(),
  totalApiCostDollars: numeric("total_api_cost_dollars").default("0").notNull(),
  totalPromptTokens: integer("total_prompt_tokens").default(0).notNull(),
  totalCompletionTokens: integer("total_completion_tokens").default(0).notNull(),
  totalCreditsCharged: integer("total_credits_charged").default(0).notNull(),
  totalRevenueDollars: numeric("total_revenue_dollars").default("0").notNull(),
  totalDebates: integer("total_debates").default(0).notNull(),
  activeUsers: integer("active_users").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export type PlatformAnalytics = typeof platformAnalytics.$inferSelect;

export const analyticsEvents = pgTable("analytics_events", {
  id: serial("id").primaryKey(),
  event: varchar("event", { length: 60 }).notNull(),
  userId: varchar("user_id"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type AnalyticsEvent = typeof analyticsEvents.$inferSelect;
export type InsertAnalyticsEvent = typeof analyticsEvents.$inferInsert;

// === TABLE DEFINITIONS ===

// A conversation thread (replaces queries)
export const conversations = pgTable("conversations", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id"),
  title: text("title").notNull(),
  status: text("status").notNull().default("processing"),
  models: text("models").array(),
  chairmanModel: text("chairman_model"),
  reservedCredits: integer("reserved_credits").default(0).notNull(),
  estimatedCredits: integer("estimated_credits").default(0).notNull(),
  settled: integer("settled").default(0).notNull(),
  actualApiCost: numeric("actual_api_cost"),
  promptTokens: integer("prompt_tokens").default(0),
  completionTokens: integer("completion_tokens").default(0),
  contextSummary: text("context_summary"),
  verdictLedger: text("verdict_ledger"),
  errorReason: text("error_reason"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Individual messages in a conversation (user prompts + council responses)
export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull(),
  role: text("role").notNull(), // 'user' or 'chairman'
  content: text("content").notNull(),
  attachments: jsonb("attachments").$type<Array<{ name: string; url: string; type: string; size: number }>>(), // file attachments
  status: text("status").notNull().default("processing"), // processing, complete, cancelled
  createdAt: timestamp("created_at").defaultNow(),
});

// Council member responses for each user message
export const councilResponses = pgTable("council_responses", {
  id: serial("id").primaryKey(),
  messageId: integer("message_id").notNull(),
  model: text("model").notNull(),
  content: text("content").notNull(),
  stage: text("stage").notNull(), // 'initial', 'review', 'final'
  error: text("error"),
  substitutedFor: text("substituted_for"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Keep old tables for backward compatibility
export const queries = pgTable("queries", {
  id: serial("id").primaryKey(),
  prompt: text("prompt").notNull(),
  status: text("status").notNull().default("processing"),
  parentQueryId: integer("parent_query_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const responses = pgTable("responses", {
  id: serial("id").primaryKey(),
  queryId: integer("query_id").notNull(),
  model: text("model").notNull(),
  content: text("content").notNull(),
  stage: text("stage").notNull(),
  rank: integer("rank"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const supportMessages = pgTable("support_messages", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  email: text("email").notNull(),
  message: text("message").notNull(),
  imageUrls: jsonb("image_urls").$type<string[]>().default([]),
  createdAt: timestamp("created_at").defaultNow(),
});

// === SCHEMAS ===
export const insertConversationSchema = createInsertSchema(conversations).omit({ id: true, createdAt: true, status: true });
export const insertMessageSchema = createInsertSchema(messages).omit({ id: true, createdAt: true });
export const insertCouncilResponseSchema = createInsertSchema(councilResponses).omit({ id: true, createdAt: true });

export const insertSupportMessageSchema = createInsertSchema(supportMessages).omit({ id: true, createdAt: true });

// Legacy schemas
export const insertQuerySchema = createInsertSchema(queries).omit({ id: true, createdAt: true, status: true }).extend({
  parentQueryId: z.number().optional()
});
export const insertResponseSchema = createInsertSchema(responses).omit({ id: true, createdAt: true });

// === TYPES ===
export type Conversation = typeof conversations.$inferSelect;
export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type Message = typeof messages.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type CouncilResponse = typeof councilResponses.$inferSelect;
export type InsertCouncilResponse = z.infer<typeof insertCouncilResponseSchema>;

export type SupportMessage = typeof supportMessages.$inferSelect;
export type InsertSupportMessage = z.infer<typeof insertSupportMessageSchema>;

// Legacy types
export type Query = typeof queries.$inferSelect;
export type InsertQuery = z.infer<typeof insertQuerySchema>;
export type Response = typeof responses.$inferSelect;
export type InsertResponse = z.infer<typeof insertResponseSchema>;

export type QueryWithResponses = Query & {
  responses: Response[];
};

// New compound types
export type MessageWithResponses = Message & {
  councilResponses: CouncilResponse[];
};

export type ConversationWithMessages = Conversation & {
  messages: MessageWithResponses[];
};
