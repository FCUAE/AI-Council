import path from "path";
import fs from "fs/promises";
import { users, type User, type UpsertUser, creditTransactions, creditBatches } from "@shared/models/auth";
import { conversations, messages, councilResponses, analyticsEvents, supportMessages } from "@shared/schema";
import { db } from "../../db";
import { pool } from "../../db";
import { eq, inArray, and, ne, sql } from "drizzle-orm";
import { securityLog } from "../../securityLogger";

const UPLOADS_DIR = path.join(process.cwd(), "uploads");

export type UpsertUserResult =
  | { status: "success"; user: User }
  | { status: "email_collision_blocked"; existingUserId: string };

export interface IAuthStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<UpsertUserResult>;
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

  async upsertUser(userData: UpsertUser): Promise<UpsertUserResult> {
    try {
      const existingUser = await this.getUser(userData.id!);
      const isNewUser = !existingUser;

      const [user] = await db
        .insert(users)
        .values(userData)
        .onConflictDoUpdate({
          target: users.id,
          set: {
            email: userData.email,
            firstName: userData.firstName,
            lastName: userData.lastName,
            profileImageUrl: userData.profileImageUrl,
            updatedAt: new Date(),
          },
        })
        .returning();

      if (isNewUser && user.debateCredits > 0) {
        try {
          const expiresAt = new Date();
          expiresAt.setDate(expiresAt.getDate() + 60);
          await db.execute(sql`
            INSERT INTO credit_batches (user_id, credits_remaining, credits_original, expires_at, pack_tier, status)
            SELECT ${user.id}, ${user.debateCredits}, ${user.debateCredits}, ${expiresAt}, 'free', 'active'
            WHERE NOT EXISTS (
              SELECT 1 FROM credit_batches WHERE user_id = ${user.id} AND pack_tier = 'free'
            )
          `);
        } catch (batchErr: any) {
          console.error(`[AUTH] Non-fatal: failed to create free batch for user ${user.id}:`, batchErr.message);
        }
      }

      return { status: "success", user };
    } catch (error: any) {
      if (error?.code === '23505' && error?.constraint === 'users_email_unique' && userData.email) {
        const existing = await this.getUserByEmail(userData.email);
        if (existing && existing.id !== userData.id) {
          securityLog.authCollisionBlocked({
            email: userData.email,
            existingId: existing.id,
            newId: userData.id ?? "unknown",
          });
          return { status: "email_collision_blocked", existingUserId: existing.id };
        }
      }
      throw error;
    }
  }
  async deleteUser(id: string): Promise<void> {
    let filenames: string[] = [];
    const client = await pool.connect();
    try {
      const fileResult = await client.query(
        'SELECT filename FROM file_uploads WHERE user_id = $1',
        [id]
      );
      filenames = fileResult.rows.map((r: any) => r.filename);
    } finally {
      client.release();
    }

    for (const filename of filenames) {
      try {
        const filePath = path.join(UPLOADS_DIR, path.basename(filename));
        await fs.unlink(filePath);
      } catch (err: any) {
        if (err.code !== "ENOENT") {
          console.error(`[DELETE_USER] Failed to delete file ${filename}:`, err.message);
        }
      }
    }

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
      await tx.delete(creditBatches).where(eq(creditBatches.userId, id));
      await tx.delete(supportMessages).where(eq(supportMessages.userId, id));
      await tx.delete(analyticsEvents).where(eq(analyticsEvents.userId, id));
      await tx.execute(sql`DELETE FROM file_uploads WHERE user_id = ${id}`);
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
