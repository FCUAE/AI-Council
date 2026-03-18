import { clerkMiddleware, getAuth, clerkClient } from "@clerk/express";
import type { Express, RequestHandler, Request, Response, NextFunction } from "express";
import { authStorage } from "./storage";

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(clerkMiddleware());
}

async function syncClerkUser(userId: string) {
  const existing = await authStorage.getUser(userId);
  if (existing) return;

  const clerkUser = await clerkClient.users.getUser(userId);

  const result = await authStorage.upsertUser({
    id: userId,
    email: clerkUser.emailAddresses?.[0]?.emailAddress || null,
    firstName: clerkUser.firstName || null,
    lastName: clerkUser.lastName || null,
    profileImageUrl: clerkUser.imageUrl || null,
  });

  if (result.status === "email_collision_blocked") {
    throw new Error("Email address is already associated with another account");
  }
}

export const isAuthenticated: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
  const auth = getAuth(req);
  const { userId } = auth;

  if (!userId) {
    console.error(`[auth] 401 on ${req.method} ${req.path} - sessionId: ${(auth as any).sessionId}, reason: no userId, hasAuthHeader: ${!!req.headers.authorization}`);
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    await syncClerkUser(userId);
  } catch (error: any) {
    if (error?.message?.includes("Email address is already associated")) {
      return res.status(409).json({ message: "This email is already linked to another account. Please contact support." });
    }
    console.error("Error syncing Clerk user:", error);
    return res.status(500).json({ message: "Authentication error" });
  }

  next();
};
