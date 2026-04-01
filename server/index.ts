import fs from "fs";
import path from "path";
import express, { type Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { setupAuth, registerAuthRoutes } from "./replit_integrations/auth";
import { runMigrations } from 'stripe-replit-sync';
import { getStripeSync } from './stripeClient';
import { WebhookHandlers } from './webhookHandlers';
import { pool, db } from './db';
import { sql, eq } from 'drizzle-orm';
import { conversations } from '@shared/schema';
import { startCreditExpirationCron } from './cron';
import { storage } from './storage';
import { securityLog } from './securityLogger';
import { withAdvisoryLock, withBlockingAdvisoryLock, LOCK_IDS } from './security/advisoryLocks';
import { startRateLimitCleanup } from './security/rateLimiter';
import { runStartupValidation } from './security/envValidation';
import { startSupportCleanupCron } from './security/supportCleanup';
import { safeErrorMessage } from './security/safeError';

runStartupValidation();

if (process.env.NODE_ENV === "production") {
  if (process.env.CLERK_PROD_SECRET_KEY) {
    process.env.CLERK_SECRET_KEY = process.env.CLERK_PROD_SECRET_KEY;
  }
  if (process.env.CLERK_PROD_PUBLISHABLE_KEY) {
    process.env.CLERK_PUBLISHABLE_KEY = process.env.CLERK_PROD_PUBLISHABLE_KEY;
  }
}

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests from this IP, please try again later." },
});


process.on("SIGHUP", () => {});

const app = express();
const httpServer = createServer(app);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "https://*.clerk.accounts.dev",
        "https://*.clerk.com",
        "https://stunning-beetle-45.clerk.accounts.dev",
        "https://clerk.askaicouncil.com",
        "https://challenges.cloudflare.com",
        "https://js.stripe.com",
        "https://scripts.refgrowcdn.com",
        "https://refgrowcdn.com",
        "'unsafe-inline'",
      ],
      styleSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://fonts.googleapis.com",
        "https://*.clerk.accounts.dev",
        "https://*.clerk.com",
        "https://stunning-beetle-45.clerk.accounts.dev",
        "https://clerk.askaicouncil.com",
      ],
      imgSrc: [
        "'self'",
        "data:",
        "blob:",
        "https://*.clerk.com",
        "https://img.clerk.com",
        "https://*.clerk.accounts.dev",
        "https://stunning-beetle-45.clerk.accounts.dev",
        "https://clerk.askaicouncil.com",
        "https://*.gravatar.com",
        "https://*.googleusercontent.com",
        "https://refgrow.com",
      ],
      connectSrc: [
        "'self'",
        "https://*.clerk.accounts.dev",
        "https://*.clerk.com",
        "https://clerk.com",
        "https://stunning-beetle-45.clerk.accounts.dev",
        "https://clerk.askaicouncil.com",
        "https://api.stripe.com",
        "https://openrouter.ai",
        "https://refgrowcdn.com",
        "https://scripts.refgrowcdn.com",
        "https://refgrow.com",
        "wss://*.pike.replit.dev",
        "wss://*.replit.dev",
        "wss://*.replit.app",
      ],
      frameSrc: [
        "'self'",
        "https://js.stripe.com",
        "https://*.clerk.accounts.dev",
        "https://*.clerk.com",
        "https://stunning-beetle-45.clerk.accounts.dev",
        "https://clerk.askaicouncil.com",
        "https://challenges.cloudflare.com",
        "https://refgrow.com",
        "https://refgrowcdn.com",
        "https://scripts.refgrowcdn.com",
      ],
      fontSrc: [
        "'self'",
        "https://fonts.gstatic.com",
        "data:",
      ],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: [
        "'self'",
        "https://*.replit.dev",
        "https://*.replit.app",
        "https://*.repl.co",
        "https://*.askaicouncil.com",
      ],
      formAction: [
        "'self'",
        "https://*.clerk.accounts.dev",
        "https://*.clerk.com",
        "https://stunning-beetle-45.clerk.accounts.dev",
        "https://clerk.askaicouncil.com",
      ],
      workerSrc: ["'self'", "blob:"],
      scriptSrcAttr: null,
      upgradeInsecureRequests: null,
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
}));

app.use((_req, res, next) => {
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), interest-cohort=()"
  );
  next();
});

app.post(
  '/api/stripe/webhook',
  express.raw({ type: 'application/json', limit: '1mb' }),
  async (req, res) => {
    const signature = req.headers['stripe-signature'];
    if (!signature) {
      return res.status(400).json({ error: 'Missing stripe-signature' });
    }
    try {
      const sig = Array.isArray(signature) ? signature[0] : signature;
      if (!Buffer.isBuffer(req.body)) {
        console.error('STRIPE WEBHOOK ERROR: req.body is not a Buffer');
        return res.status(500).json({ error: 'Webhook processing error' });
      }
      await WebhookHandlers.processWebhook(req.body as Buffer, sig);
      res.status(200).json({ received: true });
    } catch (error: unknown) {
      const msg = safeErrorMessage(error);
      console.error('Webhook error:', msg);
      securityLog.webhookFailure({ source: "stripe", reason: msg });
      res.status(400).json({ error: 'Webhook processing error' });
    }
  }
);

app.use(
  express.json({
    limit: '1mb',
  }),
);

app.use(express.urlencoded({ extended: false, limit: '1mb' }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use("/api/", apiLimiter);

function getAllowedOrigins(): string[] {
  const origins: string[] = [];
  if (process.env.REPLIT_DOMAINS) {
    origins.push(...process.env.REPLIT_DOMAINS.split(",").map(d => `https://${d.trim()}`).filter(Boolean));
  }
  if (process.env.REPLIT_DEV_DOMAIN) {
    origins.push(`https://${process.env.REPLIT_DEV_DOMAIN}`);
  }
  return origins;
}

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

app.use("/api/", (req: Request, res: Response, next: NextFunction) => {
  if (!STATE_CHANGING_METHODS.has(req.method)) return next();
  if (req.originalUrl.startsWith("/api/stripe/webhook")) return next();

  const origin = req.headers.origin;
  const allowed = getAllowedOrigins();
  if (allowed.length === 0) {
    if (process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1") {
      console.error("[SECURITY] No allowed origins configured in production — blocking state-changing request");
      return res.status(403).json({ message: "Forbidden" });
    }
    return next();
  }

  if (!origin) {
    securityLog.csrfOriginMismatch({ route: req.path, origin: "(none)", method: req.method });
    return res.status(403).json({ message: "Forbidden" });
  }

  if (!allowed.includes(origin)) {
    securityLog.csrfOriginMismatch({ route: req.path, origin, method: req.method });
    return res.status(403).json({ message: "Forbidden" });
  }
  next();
});

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      log(`${req.method} ${path} ${res.statusCode} in ${duration}ms`);
    }
  });

  next();
});

async function initStripe() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL required for Stripe');
    return;
  }

  try {
    console.log('Initializing Stripe schema...');
    await runMigrations({ databaseUrl });
    console.log('Stripe schema ready');

    const stripeSync = await getStripeSync();

    console.log('Setting up managed webhook...');
    const domain = process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DOMAINS?.split(',')[0];
    if (domain) {
      const webhookBaseUrl = `https://${domain}`;
      try {
        const result = await stripeSync.findOrCreateManagedWebhook(
          `${webhookBaseUrl}/api/stripe/webhook`
        );
        console.log(`Webhook configured: ${result?.webhook?.url || 'ok'}`);
      } catch (webhookError: any) {
        console.warn('Webhook setup warning:', webhookError.message);
      }
    } else {
      console.warn('No domain available for webhook setup');
    }

    stripeSync.syncBackfill()
      .then(() => console.log('Stripe data synced'))
      .catch((err: unknown) => console.error('Error syncing Stripe data:', safeErrorMessage(err)));
  } catch (error: unknown) {
    if (process.env.NODE_ENV === "production") {
      console.error('Failed to initialize Stripe:', safeErrorMessage(error));
    } else {
      console.error('Failed to initialize Stripe:', error);
    }
    throw error;
  }
}

async function runAppMigrations(client: import('pg').PoolClient) {
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS credit_transactions (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR NOT NULL,
        email VARCHAR,
        type VARCHAR(20) NOT NULL,
        amount INTEGER NOT NULL,
        balance_after INTEGER NOT NULL,
        description TEXT,
        stripe_session_id VARCHAR,
        conversation_id INTEGER,
        created_at TIMESTAMP DEFAULT NOW()
      );
      ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS email VARCHAR;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_transactions_stripe_session
        ON credit_transactions(stripe_session_id) WHERE stripe_session_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_id
        ON credit_transactions(user_id);

      ALTER TABLE users ADD COLUMN IF NOT EXISTS credits_purchased_at TIMESTAMP;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS credits_expiry_warned BOOLEAN NOT NULL DEFAULT FALSE;

      ALTER TABLE conversations ADD COLUMN IF NOT EXISTS reserved_credits INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE conversations ADD COLUMN IF NOT EXISTS settled INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE conversations ADD COLUMN IF NOT EXISTS context_summary TEXT;

      ALTER TABLE council_responses ADD COLUMN IF NOT EXISTS substituted_for TEXT;

      CREATE TABLE IF NOT EXISTS file_uploads (
        id SERIAL PRIMARY KEY,
        filename VARCHAR NOT NULL UNIQUE,
        user_id VARCHAR NOT NULL,
        purpose VARCHAR(20) NOT NULL DEFAULT 'debate',
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_file_uploads_filename ON file_uploads(filename);
      CREATE INDEX IF NOT EXISTS idx_file_uploads_user_id ON file_uploads(user_id);

      CREATE TABLE IF NOT EXISTS support_messages (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL,
        message TEXT NOT NULL,
        image_urls JSONB DEFAULT '[]',
        created_at TIMESTAMP DEFAULT NOW()
      );

      ALTER TABLE users ADD COLUMN IF NOT EXISTS total_api_cost NUMERIC NOT NULL DEFAULT 0;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS total_revenue NUMERIC NOT NULL DEFAULT 0;

      ALTER TABLE conversations ADD COLUMN IF NOT EXISTS prompt_tokens INTEGER DEFAULT 0;
      ALTER TABLE conversations ADD COLUMN IF NOT EXISTS completion_tokens INTEGER DEFAULT 0;

      CREATE TABLE IF NOT EXISTS platform_analytics (
        id SERIAL PRIMARY KEY,
        date DATE UNIQUE NOT NULL,
        total_api_cost_dollars NUMERIC NOT NULL DEFAULT 0,
        total_prompt_tokens INTEGER NOT NULL DEFAULT 0,
        total_completion_tokens INTEGER NOT NULL DEFAULT 0,
        total_credits_charged INTEGER NOT NULL DEFAULT 0,
        total_revenue_dollars NUMERIC NOT NULL DEFAULT 0,
        total_debates INTEGER NOT NULL DEFAULT 0,
        active_users INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE OR REPLACE FUNCTION sync_credits_on_insert()
      RETURNS TRIGGER AS $$
      DECLARE
        new_balance INTEGER;
        user_email VARCHAR;
      BEGIN
        IF NEW.email IS NULL THEN
          SELECT email INTO user_email FROM users WHERE id = NEW.user_id;
          NEW.email := user_email;
        END IF;

        IF NEW.type = 'deduction' OR NEW.type = 'correction' THEN
          RETURN NEW;
        END IF;

        UPDATE users
        SET debate_credits = GREATEST(0, debate_credits + NEW.amount),
            updated_at = NOW()
        WHERE id = NEW.user_id
        RETURNING debate_credits INTO new_balance;

        IF new_balance IS NOT NULL THEN
          NEW.balance_after := new_balance;
        END IF;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_sync_credits ON credit_transactions;
      CREATE TRIGGER trg_sync_credits
        BEFORE INSERT ON credit_transactions
        FOR EACH ROW
        EXECUTE FUNCTION sync_credits_on_insert();

      CREATE TABLE IF NOT EXISTS rate_limit_buckets (
        route_key TEXT NOT NULL,
        user_id TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 1,
        reset_at TIMESTAMPTZ NOT NULL,
        UNIQUE (route_key, user_id)
      );

      ALTER TABLE users ALTER COLUMN debate_credits SET DEFAULT 21;

      CREATE TABLE IF NOT EXISTS credit_batches (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR NOT NULL,
        credits_remaining INTEGER NOT NULL,
        credits_original INTEGER NOT NULL,
        purchased_at TIMESTAMP NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMP NOT NULL,
        pack_tier VARCHAR(20) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        stripe_session_id VARCHAR,
        warning_sent BOOLEAN NOT NULL DEFAULT FALSE,
        final_warning_sent BOOLEAN NOT NULL DEFAULT FALSE
      );
      CREATE INDEX IF NOT EXISTS idx_credit_batches_user_status_expires
        ON credit_batches(user_id, status, expires_at);

      CREATE TABLE IF NOT EXISTS analytics_events (
        id SERIAL PRIMARY KEY,
        event VARCHAR(60) NOT NULL,
        user_id VARCHAR,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_analytics_events_event ON analytics_events(event);
      CREATE INDEX IF NOT EXISTS idx_analytics_events_created_at ON analytics_events(created_at);

      ALTER TABLE users ADD COLUMN IF NOT EXISTS email_unsubscribed BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS last_email_sent_at TIMESTAMP;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS credits_expiry_final_warned BOOLEAN NOT NULL DEFAULT FALSE;

      ALTER TABLE credit_batches ADD COLUMN IF NOT EXISTS engagement_nudge_sent BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE credit_batches ADD COLUMN IF NOT EXISTS post_expiry_sent BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE credit_batches ADD COLUMN IF NOT EXISTS dormancy_notice_sent BOOLEAN NOT NULL DEFAULT FALSE;

      ALTER TABLE conversations ADD COLUMN IF NOT EXISTS estimated_credits INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE conversations ADD COLUMN IF NOT EXISTS actual_api_cost NUMERIC;
      ALTER TABLE conversations ADD COLUMN IF NOT EXISTS verdict_ledger TEXT;
      ALTER TABLE conversations ADD COLUMN IF NOT EXISTS error_reason TEXT;

      ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachments JSONB;
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'processing';

      ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS user_id TEXT;
      UPDATE support_messages SET user_id = 'unknown' WHERE user_id IS NULL;
      ALTER TABLE support_messages ALTER COLUMN user_id SET NOT NULL;

      INSERT INTO credit_batches (user_id, credits_remaining, credits_original, purchased_at, expires_at, pack_tier, status)
      SELECT
        id,
        debate_credits,
        debate_credits,
        COALESCE(credits_purchased_at, created_at, NOW()),
        COALESCE(credits_purchased_at, created_at, NOW()) + INTERVAL '60 days',
        'migrated',
        'active'
      FROM users
      WHERE debate_credits > 0
        AND NOT EXISTS (
          SELECT 1 FROM credit_batches cb WHERE cb.user_id = users.id
        );

      UPDATE users SET debate_credits = 21
      WHERE debate_credits = 10
        AND subscription_status = 'free'
        AND NOT EXISTS (
          SELECT 1 FROM credit_batches cb WHERE cb.user_id = users.id AND cb.pack_tier NOT IN ('free', 'migrated')
        );

      UPDATE credit_batches SET credits_remaining = 21, credits_original = 21
      WHERE pack_tier IN ('free', 'migrated')
        AND credits_original = 10
        AND credits_remaining = 10
        AND user_id IN (
          SELECT id FROM users WHERE subscription_status = 'free'
        );
    `);
    console.log('App migrations complete');
  } catch (error: unknown) {
    if (process.env.NODE_ENV === "production") {
      console.error('App migration error:', safeErrorMessage(error));
    } else {
      console.error('App migration error:', error);
    }
    throw error;
  }
}

(async () => {
  await setupAuth(app);
  registerAuthRoutes(app);
  
  await withBlockingAdvisoryLock(
    LOCK_IDS.CRITICAL_STARTUP,
    "Critical Startup (migrations → Stripe → views)",
    async (lockClient) => {
      console.log("[STARTUP] Running app migrations (on lock session)...");
      await runAppMigrations(lockClient);
      console.log("[STARTUP] Running Stripe init (third-party, own connections)...");
      await initStripe();
      console.log("[STARTUP] Ensuring database views (DDL on lock session)...");
      const { ensureDatabaseViews } = await import("./storage");
      await ensureDatabaseViews(lockClient);
      console.log("[STARTUP] Critical startup chain complete.");
    },
    { timeoutMs: 120_000 }
  );
  
  try {
    const uploadsDir = path.resolve(process.cwd(), "uploads");
    if (fs.existsSync(uploadsDir)) {
      const orphanPatterns = ["pdf-render-", "tmp-"];
      const files = fs.readdirSync(uploadsDir);
      let cleaned = 0;
      for (const f of files) {
        if (orphanPatterns.some(p => f.startsWith(p))) {
          try {
            fs.unlinkSync(path.join(uploadsDir, f));
            cleaned++;
          } catch {}
        }
      }
      if (cleaned > 0) {
        console.log(`[STARTUP] Cleaned ${cleaned} orphaned temp file(s) from uploads/`);
      }
    }
  } catch (err) {
    console.warn("[STARTUP] Orphan cleanup failed:", err);
  }

  await registerRoutes(httpServer, app);

  app.get("/healthz", async (_req: Request, res: Response) => {
    try {
      await Promise.race([
        (async () => {
          const client = await pool.connect();
          try {
            await client.query("SELECT 1");
          } finally {
            client.release();
          }
        })(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 2000)),
      ]);
      res.status(200).json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = status >= 500 ? "Internal Server Error" : (err.message || "Internal Server Error");

    res.status(status).json({ message });
    if (process.env.NODE_ENV === "production") {
      const errType = err?.constructor?.name || "Error";
      const route = _req?.path || "unknown";
      const safeMsg = safeErrorMessage(err).slice(0, 200);
      console.error(`[error] ${errType} on ${route}: ${safeMsg}`);
    } else {
      console.error(`[error] ${err.stack || err.message || err}`);
    }
  });

  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  async function recoverStuckConversations() {
    try {
      const recovered = await storage.recoverStuckConversations();
      if (recovered > 0) {
        log(`[RECOVERY] Recovered ${recovered} stuck conversation(s) from previous deployment`);
      } else {
        log(`[RECOVERY] No stuck conversations found`);
      }
    } catch (error: any) {
      console.error('[RECOVERY] Failed to recover stuck conversations:', error.message);
    }
  }

  await withAdvisoryLock(LOCK_IDS.STALE_RECOVERY, "Stuck Conversation Recovery", recoverStuckConversations);

  const STALE_CHECK_INTERVAL_MS = 5 * 60 * 1000;
  const STALE_THRESHOLD_MINUTES = 15;
  const staleRecoveryInterval = setInterval(async () => {
    try {
      const recovered = await storage.recoverStaleConversations(STALE_THRESHOLD_MINUTES);
      if (recovered > 0) {
        log(`[STALE RECOVERY] Recovered ${recovered} conversation(s) stuck for >${STALE_THRESHOLD_MINUTES} minutes`);
      }
    } catch (error: any) {
      console.error('[STALE RECOVERY] Error during periodic stuck conversation check:', error.message);
    }
  }, STALE_CHECK_INTERVAL_MS);
  staleRecoveryInterval.unref();

  await withAdvisoryLock(LOCK_IDS.ANALYTICS_BACKFILL, "Analytics Backfill", async () => {
    await storage.backfillAnalytics();
    log('[ANALYTICS] Backfill completed on startup');
  });

  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
      startCreditExpirationCron();
      startRateLimitCleanup();
      startSupportCleanupCron();
    },
  );

  let isShuttingDown = false;

  async function gracefulShutdown(signal: string) {
    if (isShuttingDown) return;
    isShuttingDown = true;

    log(`[SHUTDOWN] Received ${signal}. Starting graceful shutdown...`);

    httpServer.close(() => {
      log(`[SHUTDOWN] HTTP server closed, no new connections accepted`);
    });

    const SHUTDOWN_TIMEOUT = 30_000;

    await new Promise<void>((resolve) => {
      const timer = setTimeout(async () => {
        log(`[SHUTDOWN] Timeout reached (${SHUTDOWN_TIMEOUT / 1000}s). Marking in-flight debates as error...`);
        try {
          await storage.markProcessingConversationsAsError();
          log(`[SHUTDOWN] In-flight conversations marked as error`);
        } catch (err: any) {
          console.error(`[SHUTDOWN] Failed to mark conversations:`, err.message);
        }
        resolve();
      }, SHUTDOWN_TIMEOUT);

      timer.unref();

      const checkInterval = setInterval(async () => {
        try {
          const result = await db.select({ count: sql<string>`count(*)` })
            .from(conversations)
            .where(eq(conversations.status, 'processing'));
          const count = parseInt(result[0]?.count || '0', 10);
          if (count === 0) {
            log(`[SHUTDOWN] All in-flight debates completed`);
            clearTimeout(timer);
            clearInterval(checkInterval);
            resolve();
          }
        } catch {
          clearTimeout(timer);
          clearInterval(checkInterval);
          resolve();
        }
      }, 2000);

      checkInterval.unref();
    });

    log(`[SHUTDOWN] Graceful shutdown complete`);
    process.exit(0);
  }

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
})();
