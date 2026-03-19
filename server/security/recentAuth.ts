import type { Request, Response, NextFunction } from "express";
import { getAuth } from "@clerk/express";

const MAX_SESSION_AGE_SECONDS = 600;

/**
 * Middleware that requires a recently-issued Clerk session for destructive actions.
 *
 * IMPORTANT: This is a JWT-age approximation, NOT true Clerk reverification.
 * It checks the JWT's `iat` (issued-at) claim, not when the user last entered
 * their password. If Clerk silently refreshes tokens, the effective window may
 * differ from the configured threshold. True step-up auth requires Clerk's
 * reverification APIs which are not available in @clerk/express v2.
 */
export const requireRecentAuth = (req: Request, res: Response, next: NextFunction) => {
  const auth = getAuth(req);
  const claims = auth.sessionClaims as Record<string, unknown> | null;
  const iat = claims?.iat;

  if (typeof iat !== "number") {
    return res.status(403).json({
      message: "Please re-authenticate to perform this action",
      code: "RECENT_AUTH_REQUIRED",
    });
  }

  const ageSeconds = Math.floor(Date.now() / 1000) - iat;

  if (ageSeconds > MAX_SESSION_AGE_SECONDS) {
    return res.status(403).json({
      message: "Please re-authenticate to perform this action",
      code: "RECENT_AUTH_REQUIRED",
    });
  }

  next();
};
