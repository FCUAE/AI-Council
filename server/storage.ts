import { db } from "./db";
import { 
  queries, responses, conversations, messages, councilResponses, users, creditTransactions, supportMessages, platformAnalytics,
  type InsertQuery, type InsertResponse, type QueryWithResponses,
  type InsertConversation, type InsertMessage, type InsertCouncilResponse,
  type ConversationWithMessages, type MessageWithResponses, type User,
  type InsertCreditTransaction, type InsertSupportMessage
} from "@shared/schema";
import { eq, desc, sql, inArray } from "drizzle-orm";

export interface IStorage {
  createConversation(title: string, models?: string[], chairmanModel?: string, userId?: string): Promise<typeof conversations.$inferSelect>;
  getConversation(id: number): Promise<ConversationWithMessages | undefined>;
  getConversations(userId?: string): Promise<(typeof conversations.$inferSelect)[]>;
  updateConversationStatus(id: number, status: string, errorReason?: string): Promise<void>;
  renameConversation(id: number, title: string): Promise<void>;
  deleteConversation(id: number): Promise<void>;
  
  createMessage(message: InsertMessage): Promise<typeof messages.$inferSelect>;
  updateMessageStatus(id: number, status: string): Promise<void>;
  
  createCouncilResponse(response: InsertCouncilResponse): Promise<typeof councilResponses.$inferSelect>;
  clearCouncilResponses(messageId: number): Promise<void>;
  
  incrementDeliberationCount(userId: string): Promise<void>;
  decrementDebateCredits(userId: string, amount?: number): Promise<void>;
  addDebateCredits(userId: string, count: number): Promise<void>;
  getUserById(userId: string): Promise<User | undefined>;
  logCreditTransaction(tx: Omit<InsertCreditTransaction, "id" | "createdAt">): Promise<boolean>;
  isStripeSessionProcessed(stripeSessionId: string): Promise<boolean>;
  updateUserSubscription(userId: string, status: string, stripeCustomerId?: string, stripeSubscriptionId?: string): Promise<void>;
  resetMonthlyDebates(userId: string): Promise<void>;
  incrementMonthlyDebates(userId: string): Promise<void>;
  refundDebateCredits(userId: string, amount: number, reason: string, conversationId?: number): Promise<boolean>;
  getTotalCreditsPurchased(userId: string): Promise<number>;
  updateConversationReservedCredits(id: number, credits: number): Promise<void>;
  updateConversationEstimatedCredits(id: number, credits: number): Promise<void>;
  settleConversation(id: number, actualCost: number): Promise<void>;
  updateConversationApiCost(id: number, apiCost: number): Promise<void>;
  updateConversationTokens(id: number, promptTokens: number, completionTokens: number): Promise<void>;
  updateConversationSummary(id: number, summary: string): Promise<void>;
  recoverStuckConversations(): Promise<number>;
  recoverStaleConversations(staleMinutes: number): Promise<number>;
  markProcessingConversationsAsError(): Promise<void>;
  
  createSupportMessage(data: InsertSupportMessage): Promise<typeof supportMessages.$inferSelect>;
  getSupportMessages(): Promise<(typeof supportMessages.$inferSelect)[]>;

  incrementUserApiCost(userId: string, apiCostDollars: number): Promise<void>;
  incrementUserRevenue(userId: string, revenueDollars: number): Promise<void>;
  backfillAnalytics(): Promise<void>;
  getPlatformAnalytics(): Promise<{
    totals: { totalApiCost: number; totalRevenue: number; totalDebates: number; activeUsers: number; totalCreditsCharged: number; totalPromptTokens: number; totalCompletionTokens: number };
    users: { id: string; email: string | null; totalApiCost: string; totalRevenue: string; debateCredits: number; deliberationCount: number }[];
  }>;

  // Legacy methods
  createQuery(query: InsertQuery): Promise<typeof queries.$inferSelect>;
  getQuery(id: number): Promise<QueryWithResponses | undefined>;
  getQueries(): Promise<(typeof queries.$inferSelect)[]>;
  updateQueryStatus(id: number, status: string): Promise<void>;
  createResponse(response: InsertResponse): Promise<typeof responses.$inferSelect>;
  getResponses(queryId: number): Promise<(typeof responses.$inferSelect)[]>;
}

export class DatabaseStorage implements IStorage {
  async createConversation(title: string, models?: string[], chairmanModel?: string, userId?: string): Promise<typeof conversations.$inferSelect> {
    const [newConv] = await db.insert(conversations).values({ 
      title, 
      models: models || null,
      chairmanModel: chairmanModel || null,
      userId: userId || null,
    }).returning();
    return newConv;
  }

  async getConversation(id: number): Promise<ConversationWithMessages | undefined> {
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, id));
    if (!conv) return undefined;

    const msgs = await db.select().from(messages).where(eq(messages.conversationId, id)).orderBy(messages.createdAt);
    
    const messagesWithResponses: MessageWithResponses[] = await Promise.all(
      msgs.map(async (msg) => {
        const responses = await db.select().from(councilResponses).where(eq(councilResponses.messageId, msg.id));
        return { ...msg, councilResponses: responses };
      })
    );

    return { ...conv, messages: messagesWithResponses };
  }

  async getConversations(userId?: string): Promise<(typeof conversations.$inferSelect)[]> {
    if (userId) {
      return db.select().from(conversations).where(eq(conversations.userId, userId)).orderBy(desc(conversations.createdAt));
    }
    return db.select().from(conversations).orderBy(desc(conversations.createdAt));
  }
  
  async incrementDeliberationCount(userId: string): Promise<void> {
    await db.update(users).set({ 
      deliberationCount: sql`${users.deliberationCount} + 1`,
      updatedAt: new Date()
    }).where(eq(users.id, userId));
  }
  
  async decrementDebateCredits(userId: string, amount: number = 1): Promise<void> {
    await db.update(users).set({ 
      debateCredits: sql`GREATEST(0, ${users.debateCredits} - ${amount})`,
      updatedAt: new Date()
    }).where(eq(users.id, userId));
  }
  
  async addDebateCredits(userId: string, count: number): Promise<void> {
    await db.update(users).set({ 
      debateCredits: sql`${users.debateCredits} + ${count}`,
      updatedAt: new Date()
    }).where(eq(users.id, userId));
  }

  async refundDebateCredits(userId: string, amount: number, reason: string, conversationId?: number): Promise<boolean> {
    if (conversationId) {
      return await db.transaction(async (tx) => {
        const result = await tx.update(conversations)
          .set({ settled: 1 })
          .where(sql`${conversations.id} = ${conversationId} AND ${conversations.settled} = 0`)
          .returning({ id: conversations.id });
        if (result.length === 0) {
          console.log(`[REFUND] Skipped duplicate refund for debate #${conversationId} (already settled)`);
          return false;
        }
        await tx.insert(creditTransactions).values({
          userId,
          type: "refund",
          amount: amount,
          balanceAfter: 0,
          description: reason,
          conversationId: conversationId,
          stripeSessionId: null,
        });
        console.log(`[REFUND] Refunded ${atomicAmount} credit(s) to user ${userId}: ${reason}`);
        return true;
      });
    }
    await this.logCreditTransaction({
      userId,
      type: "refund",
      amount: amount,
      balanceAfter: 0,
      description: reason,
      conversationId: null,
      stripeSessionId: null,
    });
    console.log(`[REFUND] Refunded ${amount} credit(s) to user ${userId}: ${reason}`);
    return true;
  }

  async logCreditTransaction(tx: Omit<InsertCreditTransaction, "id" | "createdAt">): Promise<boolean> {
    try {
      await db.insert(creditTransactions).values(tx);
      return true;
    } catch (error: any) {
      if (error?.code === '23505') {
        return false;
      }
      throw error;
    }
  }

  async isStripeSessionProcessed(stripeSessionId: string): Promise<boolean> {
    const [row] = await db.select({ id: creditTransactions.id })
      .from(creditTransactions)
      .where(eq(creditTransactions.stripeSessionId, stripeSessionId))
      .limit(1);
    return !!row;
  }
  
  async getUserById(userId: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    return user;
  }
  
  async updateUserSubscription(userId: string, status: string, stripeCustomerId?: string, stripeSubscriptionId?: string): Promise<void> {
    const updateData: any = { subscriptionStatus: status, updatedAt: new Date() };
    if (stripeCustomerId) updateData.stripeCustomerId = stripeCustomerId;
    if (stripeSubscriptionId) updateData.stripeSubscriptionId = stripeSubscriptionId;
    if (status === "active") {
      updateData.monthlyDebatesUsed = 0;
      updateData.monthlyResetAt = new Date();
    }
    await db.update(users).set(updateData).where(eq(users.id, userId));
  }
  
  async resetMonthlyDebates(userId: string): Promise<void> {
    await db.update(users).set({ 
      monthlyDebatesUsed: 0, 
      monthlyResetAt: new Date(),
      updatedAt: new Date()
    }).where(eq(users.id, userId));
  }
  
  async incrementMonthlyDebates(userId: string): Promise<void> {
    await db.update(users).set({ 
      monthlyDebatesUsed: sql`${users.monthlyDebatesUsed} + 1`,
      updatedAt: new Date()
    }).where(eq(users.id, userId));
  }

  async updateConversationStatus(id: number, status: string, errorReason?: string): Promise<void> {
    const updates: any = { status };
    if (errorReason !== undefined) {
      updates.errorReason = errorReason;
    } else if (status !== 'error') {
      updates.errorReason = null;
    }
    await db.update(conversations).set(updates).where(eq(conversations.id, id));
  }

  async renameConversation(id: number, title: string): Promise<void> {
    await db.update(conversations).set({ title }).where(eq(conversations.id, id));
  }

  async deleteConversation(id: number): Promise<void> {
    await db.transaction(async (tx) => {
      const msgs = await tx.select({ id: messages.id }).from(messages).where(eq(messages.conversationId, id));
      if (msgs.length > 0) {
        const msgIds = msgs.map(m => m.id);
        await tx.delete(councilResponses).where(inArray(councilResponses.messageId, msgIds));
      }
      await tx.delete(messages).where(eq(messages.conversationId, id));
      await tx.delete(conversations).where(eq(conversations.id, id));
    });
  }

  async createMessage(message: InsertMessage): Promise<typeof messages.$inferSelect> {
    const [newMsg] = await db.insert(messages).values(message).returning();
    return newMsg;
  }

  async updateMessageStatus(id: number, status: string): Promise<void> {
    await db.update(messages).set({ status }).where(eq(messages.id, id));
  }

  async createCouncilResponse(response: InsertCouncilResponse): Promise<typeof councilResponses.$inferSelect> {
    const [newResp] = await db.insert(councilResponses).values(response).returning();
    return newResp;
  }

  async clearCouncilResponses(messageId: number): Promise<void> {
    await db.delete(councilResponses).where(eq(councilResponses.messageId, messageId));
  }

  async getTotalCreditsPurchased(userId: string): Promise<number> {
    const result = await db.select({
      total: sql<number>`COALESCE(SUM(${creditTransactions.amount}), 0)`
    }).from(creditTransactions).where(
      sql`${creditTransactions.userId} = ${userId} AND ${creditTransactions.type} IN ('purchase', 'bonus', 'subscription', 'recovery')`
    );
    return result[0]?.total || 0;
  }

  async updateConversationReservedCredits(id: number, credits: number): Promise<void> {
    await db.update(conversations).set({ reservedCredits: credits }).where(eq(conversations.id, id));
  }

  async updateConversationEstimatedCredits(id: number, credits: number): Promise<void> {
    await db.update(conversations).set({ estimatedCredits: credits }).where(eq(conversations.id, id));
  }

  async settleConversation(id: number, actualCost: number): Promise<void> {
    await db.update(conversations).set({ settled: 1, reservedCredits: actualCost }).where(eq(conversations.id, id));
  }

  async updateConversationApiCost(id: number, apiCost: number): Promise<void> {
    await db.update(conversations).set({ actualApiCost: String(apiCost) }).where(eq(conversations.id, id));
  }

  async updateConversationTokens(id: number, promptTokens: number, completionTokens: number): Promise<void> {
    await db.update(conversations).set({ promptTokens, completionTokens }).where(eq(conversations.id, id));
  }

  async updateConversationSummary(id: number, summary: string): Promise<void> {
    await db.update(conversations).set({ contextSummary: summary }).where(eq(conversations.id, id));
  }

  async recoverStuckConversations(): Promise<number> {
    const stuckConversations = await db.select().from(conversations)
      .where(sql`${conversations.status} = 'processing'`);

    if (stuckConversations.length === 0) return 0;

    for (const conv of stuckConversations) {
      if (conv.userId && conv.reservedCredits > 0 && conv.settled === 0) {
        try {
          await this.refundDebateCredits(
            conv.userId,
            conv.reservedCredits,
            `Recovered after deployment interruption (debate #${conv.id})`,
            conv.id
          );
        } catch (err: any) {
          console.error(`[RECOVERY] Failed to refund debate #${conv.id}:`, err.message);
        }
      }

      await db.update(conversations)
        .set({ status: "error" })
        .where(eq(conversations.id, conv.id));
      await db.update(messages)
        .set({ status: "error" })
        .where(sql`${messages.conversationId} = ${conv.id} AND ${messages.status} = 'processing'`);
    }

    return stuckConversations.length;
  }

  async recoverStaleConversations(staleMinutes: number): Promise<number> {
    const cutoff = new Date(Date.now() - staleMinutes * 60 * 1000);

    const staleMessages = await db.select({
      conversationId: messages.conversationId,
      messageId: messages.id,
    }).from(messages)
      .where(sql`${messages.status} = 'processing' AND ${messages.createdAt} < ${cutoff}`);

    if (staleMessages.length === 0) return 0;

    const conversationIds = Array.from(new Set(staleMessages.map(m => m.conversationId)));
    let recovered = 0;

    for (const convId of conversationIds) {
      const [conv] = await db.select().from(conversations)
        .where(sql`${conversations.id} = ${convId} AND ${conversations.status} = 'processing'`);
      if (!conv) continue;

      if (conv.userId && conv.reservedCredits > 0 && conv.settled === 0) {
        try {
          await this.refundDebateCredits(
            conv.userId,
            conv.reservedCredits,
            `Recovered stale conversation (stuck >${staleMinutes}min) (debate #${conv.id})`,
            conv.id
          );
        } catch (err: any) {
          console.error(`[STALE RECOVERY] Failed to refund debate #${conv.id}:`, err.message);
        }
      }

      await db.update(conversations)
        .set({ status: "error", errorReason: "Processing stalled — conversation recovered automatically" })
        .where(sql`${conversations.id} = ${convId} AND ${conversations.status} = 'processing'`);
      await db.update(messages)
        .set({ status: "error" })
        .where(sql`${messages.conversationId} = ${convId} AND ${messages.status} = 'processing'`);
      recovered++;
    }

    return recovered;
  }

  async markProcessingConversationsAsError(): Promise<void> {
    const stuckConvs = await db.select().from(conversations)
      .where(sql`${conversations.status} = 'processing'`);
    
    for (const conv of stuckConvs) {
      await db.update(conversations)
        .set({ status: "error" })
        .where(eq(conversations.id, conv.id));
      await db.update(messages)
        .set({ status: "error" })
        .where(sql`${messages.conversationId} = ${conv.id} AND ${messages.status} = 'processing'`);
      if (conv.userId && conv.reservedCredits > 0 && conv.settled === 0) {
        try {
          await this.refundDebateCredits(
            conv.userId,
            conv.reservedCredits,
            `Shutdown interrupted debate #${conv.id}`,
            conv.id
          );
        } catch (err: any) {
          console.error(`[SHUTDOWN] Failed to refund debate #${conv.id}:`, err.message);
        }
      }
    }
  }

  // Legacy methods
  async createQuery(query: InsertQuery): Promise<typeof queries.$inferSelect> {
    const [newQuery] = await db.insert(queries).values(query).returning();
    return newQuery;
  }

  async getQuery(id: number): Promise<QueryWithResponses | undefined> {
    const [query] = await db.select().from(queries).where(eq(queries.id, id));
    if (!query) return undefined;

    const queryResponses = await db.select().from(responses).where(eq(responses.queryId, id));
    return { ...query, responses: queryResponses };
  }

  async getQueries(): Promise<(typeof queries.$inferSelect)[]> {
    return db.select().from(queries).orderBy(desc(queries.createdAt));
  }

  async updateQueryStatus(id: number, status: string): Promise<void> {
    await db.update(queries).set({ status }).where(eq(queries.id, id));
  }

  async createResponse(response: InsertResponse): Promise<typeof responses.$inferSelect> {
    const [newResponse] = await db.insert(responses).values(response).returning();
    return newResponse;
  }

  async getResponses(queryId: number): Promise<(typeof responses.$inferSelect)[]> {
    return db.select().from(responses).where(eq(responses.queryId, queryId));
  }

  async createSupportMessage(data: InsertSupportMessage): Promise<typeof supportMessages.$inferSelect> {
    const [msg] = await db.insert(supportMessages).values(data).returning();
    return msg;
  }

  async getSupportMessages(): Promise<(typeof supportMessages.$inferSelect)[]> {
    return db.select().from(supportMessages).orderBy(desc(supportMessages.createdAt));
  }

  async incrementUserApiCost(userId: string, apiCostDollars: number): Promise<void> {
    await db.update(users).set({
      totalApiCost: sql`${users.totalApiCost}::numeric + ${apiCostDollars}`,
      updatedAt: new Date()
    }).where(eq(users.id, userId));
  }

  async incrementUserRevenue(userId: string, revenueDollars: number): Promise<void> {
    await db.update(users).set({
      totalRevenue: sql`${users.totalRevenue}::numeric + ${revenueDollars}`,
      updatedAt: new Date()
    }).where(eq(users.id, userId));
  }

  async backfillAnalytics(): Promise<void> {
    const hasStripeCharges = await db.execute(sql`
      SELECT EXISTS(SELECT 1 FROM stripe.charges WHERE status = 'succeeded' LIMIT 1) as has_data
    `);
    const useStripeCharges = (hasStripeCharges.rows[0]?.has_data === true);

    await db.transaction(async (tx) => {
      await tx.execute(sql`UPDATE users SET total_api_cost = 0, total_revenue = 0, updated_at = NOW()`);

      await tx.execute(sql`
        UPDATE users u SET total_api_cost = COALESCE(sub.cost, 0), updated_at = NOW()
        FROM (
          SELECT user_id, SUM(COALESCE(actual_api_cost::numeric, 0)) as cost
          FROM conversations
          WHERE user_id IS NOT NULL
          GROUP BY user_id
        ) sub
        WHERE u.id = sub.user_id
      `);

      if (useStripeCharges) {
        await tx.execute(sql`
          UPDATE users u SET total_revenue = COALESCE(sub.rev, 0), updated_at = NOW()
          FROM (
            SELECT u2.id as user_id, SUM(c.amount::numeric / 100.0) as rev
            FROM stripe.charges c
            JOIN stripe.customers cu ON c.customer = cu.id
            JOIN users u2 ON u2.stripe_customer_id = cu.id
            WHERE c.status = 'succeeded'
            GROUP BY u2.id
          ) sub
          WHERE u.id = sub.user_id
        `);
      } else {
        await tx.execute(sql`
          UPDATE users u SET total_revenue = COALESCE(sub.rev, 0), updated_at = NOW()
          FROM (
            SELECT user_id, COALESCE(SUM(
              CASE
                WHEN amount = 100 THEN 15.00
                WHEN amount = 325 THEN 39.00
                WHEN amount = 900 THEN 89.00
                WHEN amount = 150 THEN 15.00
                WHEN amount = 370 THEN 39.00
                WHEN amount = 870 THEN 89.00
                WHEN amount = 10 THEN 15.00
                WHEN amount = 30 THEN 39.00
                WHEN amount = 50 THEN 89.00
                ELSE 0
              END
            ), 0) as rev
            FROM credit_transactions
            WHERE type IN ('purchase', 'recovery') AND stripe_session_id IS NOT NULL
            GROUP BY user_id
          ) sub
          WHERE u.id = sub.user_id
        `);
      }
    });

    const totals = await this.getPlatformAnalytics();
    const today = new Date().toISOString().split('T')[0];

    await db.execute(sql`
      INSERT INTO platform_analytics (date, total_api_cost_dollars, total_prompt_tokens, total_completion_tokens, total_credits_charged, total_revenue_dollars, total_debates, active_users)
      VALUES (${today}, ${String(totals.totals.totalApiCost)}, ${totals.totals.totalPromptTokens}, ${totals.totals.totalCompletionTokens}, ${totals.totals.totalCreditsCharged}, ${String(totals.totals.totalRevenue)}, ${totals.totals.totalDebates}, ${totals.totals.activeUsers})
      ON CONFLICT (date) DO UPDATE SET
        total_api_cost_dollars = EXCLUDED.total_api_cost_dollars,
        total_prompt_tokens = EXCLUDED.total_prompt_tokens,
        total_completion_tokens = EXCLUDED.total_completion_tokens,
        total_credits_charged = EXCLUDED.total_credits_charged,
        total_revenue_dollars = EXCLUDED.total_revenue_dollars,
        total_debates = EXCLUDED.total_debates,
        active_users = EXCLUDED.active_users
    `);

    console.log('[ANALYTICS] Backfill of user total_api_cost and total_revenue complete');
    console.log(`[ANALYTICS] Daily snapshot upserted for ${today}`);
  }

  async getPlatformAnalytics(): Promise<{
    totals: { totalApiCost: number; totalRevenue: number; totalDebates: number; activeUsers: number; totalCreditsCharged: number; totalPromptTokens: number; totalCompletionTokens: number };
    users: { id: string; email: string | null; totalApiCost: string; totalRevenue: string; debateCredits: number; deliberationCount: number }[];
  }> {
    const aggregateResult = await db.execute(sql`
      SELECT
        COALESCE(SUM(actual_api_cost::numeric), 0) as total_api_cost,
        COUNT(*) as total_debates,
        COUNT(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL) as active_users,
        COALESCE(SUM(COALESCE(prompt_tokens, 0)), 0) as total_prompt_tokens,
        COALESCE(SUM(COALESCE(completion_tokens, 0)), 0) as total_completion_tokens
      FROM conversations
    `);
    const row = aggregateResult.rows[0] || {};
    const totalApiCost = parseFloat(row.total_api_cost as string || '0');
    const totalDebates = parseInt(row.total_debates as string || '0', 10);
    const activeUsers = parseInt(row.active_users as string || '0', 10);
    const totalPromptTokens = parseInt(row.total_prompt_tokens as string || '0', 10);
    const totalCompletionTokens = parseInt(row.total_completion_tokens as string || '0', 10);

    const revenueResult = await db.execute(sql`
      SELECT COALESCE(SUM(total_revenue::numeric), 0) as total_revenue FROM users
    `);
    const totalRevenue = parseFloat(revenueResult.rows[0]?.total_revenue as string || '0');

    const creditsResult = await db.execute(sql`
      SELECT COALESCE(SUM(amount), 0) as total_credits
      FROM credit_transactions
      WHERE type = 'deduction'
    `);
    const totalCreditsCharged = Math.abs(parseInt(creditsResult.rows[0]?.total_credits as string || '0', 10));

    const userBreakdown = await db.select({
      id: users.id,
      email: users.email,
      totalApiCost: users.totalApiCost,
      totalRevenue: users.totalRevenue,
      debateCredits: users.debateCredits,
      deliberationCount: users.deliberationCount,
    }).from(users).orderBy(desc(users.deliberationCount));

    return {
      totals: { totalApiCost, totalRevenue, totalDebates, activeUsers, totalCreditsCharged, totalPromptTokens, totalCompletionTokens },
      users: userBreakdown,
    };
  }
}

export const storage = new DatabaseStorage();

export async function ensureDatabaseViews() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS debate_cost_summary (
      debate_id INTEGER PRIMARY KEY,
      user_id VARCHAR,
      title TEXT,
      models TEXT,
      status TEXT,
      api_cost_dollars NUMERIC DEFAULT 0,
      credits_used INTEGER DEFAULT 0,
      revenue_dollars NUMERIC DEFAULT 0,
      profit_dollars NUMERIC DEFAULT 0,
      created_at TIMESTAMP
    )
  `);
  await refreshDebateCostSummary();
}

export async function refreshDebateCostSummary() {
  await db.execute(sql`
    INSERT INTO debate_cost_summary (debate_id, user_id, title, models, status, api_cost_dollars, credits_used, revenue_dollars, profit_dollars, created_at)
    SELECT
      c.id,
      c.user_id,
      LEFT(c.title, 100),
      array_to_string(c.models, ', '),
      c.status,
      COALESCE(c.actual_api_cost::numeric, 0),
      COALESCE(cpd.credits_used, 0),
      ROUND(COALESCE(cpd.credits_used, 0) * COALESCE(
        CASE WHEN COALESCE(ucp.total_purchased, 0) > 0 
          THEN u.total_revenue::numeric / ucp.total_purchased ELSE 0 END, 0), 4),
      ROUND(COALESCE(cpd.credits_used, 0) * COALESCE(
        CASE WHEN COALESCE(ucp.total_purchased, 0) > 0 
          THEN u.total_revenue::numeric / ucp.total_purchased ELSE 0 END, 0) - COALESCE(c.actual_api_cost::numeric, 0), 4),
      c.created_at
    FROM conversations c
    LEFT JOIN (
      SELECT conversation_id, ABS(SUM(amount)) AS credits_used
      FROM credit_transactions WHERE type = 'deduction' AND conversation_id IS NOT NULL
      GROUP BY conversation_id
    ) cpd ON c.id = cpd.conversation_id
    LEFT JOIN users u ON c.user_id = u.id
    LEFT JOIN (
      SELECT user_id, SUM(amount) AS total_purchased
      FROM credit_transactions WHERE type = 'purchase'
      GROUP BY user_id
    ) ucp ON u.id = ucp.user_id
    ON CONFLICT (debate_id) DO UPDATE SET
      api_cost_dollars = EXCLUDED.api_cost_dollars,
      credits_used = EXCLUDED.credits_used,
      revenue_dollars = EXCLUDED.revenue_dollars,
      profit_dollars = EXCLUDED.profit_dollars,
      status = EXCLUDED.status
  `);
  await db.execute(sql`
    INSERT INTO debate_cost_summary (debate_id, user_id, title, models, status, api_cost_dollars, credits_used, revenue_dollars, profit_dollars, created_at)
    SELECT 0, 'TOTAL', 'TOTAL', '', '', SUM(api_cost_dollars), SUM(credits_used), SUM(revenue_dollars), SUM(profit_dollars), NULL
    FROM debate_cost_summary WHERE debate_id != 0
    ON CONFLICT (debate_id) DO UPDATE SET
      api_cost_dollars = EXCLUDED.api_cost_dollars,
      credits_used = EXCLUDED.credits_used,
      revenue_dollars = EXCLUDED.revenue_dollars,
      profit_dollars = EXCLUDED.profit_dollars
  `);
}
