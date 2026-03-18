import { users, type User, type UpsertUser, creditTransactions } from "@shared/models/auth";
import { conversations, messages, councilResponses } from "@shared/schema";
import { db } from "../../db";
import { eq, inArray, and, ne } from "drizzle-orm";

export interface IAuthStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  deleteUser(id: string): Promise<void>;
  updateUserProfile(userId: string, data: { firstName: string; lastName: string; email: string }): Promise<{ user?: User; error?: string }>;
}

class AuthStorage implements IAuthStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    try {
      const [user] = await db
        .insert(users)
        .values(userData)
        .onConflictDoUpdate({
          target: users.id,
          set: {
            ...userData,
            updatedAt: new Date(),
          },
        })
        .returning();
      return user;
    } catch (error: any) {
      if (error?.code === '23505' && error?.constraint === 'users_email_unique' && userData.email) {
        const existing = await this.getUserByEmail(userData.email);
        if (existing) {
          const [user] = await db
            .update(users)
            .set({
              id: userData.id,
              firstName: userData.firstName,
              lastName: userData.lastName,
              profileImageUrl: userData.profileImageUrl,
              updatedAt: new Date(),
            })
            .where(eq(users.email, userData.email))
            .returning();
          return user;
        }
      }
      throw error;
    }
  }
  async deleteUser(id: string): Promise<void> {
    await db.transaction(async (tx) => {
      const userConvs = await tx.select({ id: conversations.id }).from(conversations).where(eq(conversations.userId, id));
      if (userConvs.length > 0) {
        const convIds = userConvs.map(c => c.id);
        const msgs = await tx.select({ id: messages.id }).from(messages).where(inArray(messages.conversationId, convIds));
        if (msgs.length > 0) {
          const msgIds = msgs.map(m => m.id);
          await tx.delete(councilResponses).where(inArray(councilResponses.messageId, msgIds));
        }
        await tx.delete(messages).where(inArray(messages.conversationId, convIds));
        await tx.delete(conversations).where(inArray(conversations.id, convIds));
      }
      await tx.delete(creditTransactions).where(eq(creditTransactions.userId, id));
      await tx.delete(users).where(eq(users.id, id));
    });
  }
  async updateUserProfile(userId: string, data: { firstName: string; lastName: string; email: string }): Promise<{ user?: User; error?: string }> {
    const existing = await db
      .select()
      .from(users)
      .where(and(eq(users.email, data.email), ne(users.id, userId)));
    if (existing.length > 0) {
      return { error: "Email is already in use by another account" };
    }

    try {
      const [user] = await db
        .update(users)
        .set({
          firstName: data.firstName,
          lastName: data.lastName,
          email: data.email,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId))
        .returning();

      if (!user) {
        return { error: "User not found" };
      }

      return { user };
    } catch (error: any) {
      if (error?.code === '23505' && error?.constraint === 'users_email_unique') {
        return { error: "Email is already in use by another account" };
      }
      throw error;
    }
  }
}

export const authStorage = new AuthStorage();
