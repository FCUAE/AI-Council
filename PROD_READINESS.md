# Production Readiness — AI Council

**Date:** March 19, 2026  
**Status:** Ready for production — all launch blockers resolved

---

## Blockers Fixed

| # | Issue | Status |
|---|---|---|
| 1 | Unauthenticated admin endpoint | ✅ Fixed — auth + admin guard |
| 2 | SSRF in image URL and extract-text | ✅ Fixed — HTTPS-only allowlist, no arbitrary fetch |
| 3 | Auth identity collision / account takeover | ✅ Fixed — email collision blocked with 409 |
| 4 | Upload/object storage ACL bypass | ✅ Fixed — ownership tracking, fail-closed |
| 5 | Extract-text ACL bypass | ✅ Fixed — object storage + local ACL enforcement |
| 6 | Missing security headers | ✅ Fixed — Helmet + CSP + HSTS + Permissions-Policy |
| 7 | Host header injection in Stripe URLs | ✅ Fixed — domain allowlist validation |
| 8 | CSRF missing on state-changing requests | ✅ Fixed — Origin validation middleware |
| 9 | Duplicate refund risk | ✅ Fixed — atomic settled flag check-and-set |
| 10 | Revenue tracking race condition | ✅ Fixed — guarded by logCreditTransaction return |
| 11 | Cancel/retry race conditions | ✅ Fixed — compare-and-set status transitions |
| 12 | Attachment URL IDOR bypass | ✅ Fixed — centralized `attachmentAuth.ts` with URL normalization, ownership/ACL validation at ingestion (before DB write), defense-in-depth in `imageUrlToBase64`, retry re-validation |
| 13 | Cron blocking advisory lock | ✅ Fixed — non-blocking `withAdvisoryLock` pattern aligned with startup jobs |
| 14 | Unsafe startup lock semantics | ✅ Fixed — single blocking `pg_advisory_lock` chain for critical startup; 120s timeout; non-lock-holders wait |

## Phase 7 — Low-Risk Security Hardening (March 23, 2026)

| # | Improvement | Status |
|---|---|---|
| 15 | Production error logging hardened | ✅ Done — production logs safe summaries only (type + route + message), dev keeps full stacks |
| 16 | Startup environment validation | ✅ Done — `server/security/envValidation.ts` validates critical env vars, fails fast, never prints secrets |
| 17 | Readiness endpoint | ✅ Done — `GET /healthz` returns 200/503 with DB check (2s timeout), no secrets exposed |
| 18 | Support attachment cleanup | ✅ Done — daily cleanup of support-purpose uploads older than 30 days via `file_uploads.purpose` metadata |
| 19 | Security event counter logging | ✅ Done — `webhookFailure` and `supportAbuse` event types added to securityLogger |
| 20 | Dependency hygiene | ✅ Reviewed — security packages at latest compatible versions; Clerk/Stripe/parser upgrades skipped per guardrails |
| 21 | Support email prefill | ✅ Done — email prefilled once from Clerk profile; ref prevents overwriting user edits |

## Remaining Risks (Non-Blocking)

See `SECURITY_AUDIT.md` — Residual Risks section for full details. Key items:

1. **CSP `unsafe-inline`** — Required by Clerk SDK. Standard defense-in-depth mitigations in place.
2. **Step-up auth is JWT-age check** — Not true credential re-entry. Acceptable for current threat model.
3. **Document parsing in main process** — No worker isolation. Mitigated by timeouts and size guards.
4. **5 low-severity dependency vulnerabilities** — In `@google-cloud/storage` chain; require breaking change.

---

## Startup Safety

### Critical Startup Chain — Blocking Lock

The three critical startup jobs run as a single ordered chain under one **blocking** Postgres advisory lock (`pg_advisory_lock`, lock ID 200). No instance can reach `httpServer.listen()` until the entire chain completes:

1. **App Migrations** — DDL, indexes, triggers
2. **Stripe Init** — schema, webhook, data sync
3. **ensureDatabaseViews** — summary tables that depend on migration schema

| Behavior | Detail |
|----------|--------|
| Lock type | `pg_advisory_lock` (blocking) — non-lock-holder waits |
| Same session | Lock acquire → job → lock release use the same pool client. App migrations and views DDL execute on the lock-holding session. Stripe init uses its own connections (third-party `stripe-replit-sync` library) but runs sequentially within the locked chain. |
| Timeout | 120 seconds wall-clock timer (`process.exit(1)`) + SQL `statement_timeout`; covers both lock-wait and callback execution |
| Failure | Any error in the chain crashes the process (prevents serving on bad state) |
| Observability | Logs: attempting lock → waiting (if blocked) → acquired → each step → completed with elapsed time |

### Non-Critical Startup Jobs — Non-Blocking Lock

| Job | Lock ID | Failure Behavior |
|-----|---------|------------------|
| Stuck Conversation Recovery | 102 | Skipped if locked; logs error on failure, continues |
| Analytics Backfill | 103 | Skipped if locked; logs error on failure, continues |
| Credit Expiration Cron | 42 | Skipped if locked; runs on interval |

These use `pg_try_advisory_lock` (non-blocking). If another instance holds the lock, the job is skipped with a log message. This is safe because these jobs are idempotent and non-essential for serving traffic.

### Startup Lock Validation

The blocking lock behavior was validated as follows:
1. Instance A starts → acquires lock 200 immediately → runs migrations, Stripe init, views in order → releases lock → proceeds to `listen()`
2. If instance B starts while A holds lock 200, B logs "waiting for Critical Startup" and blocks until A releases
3. B does NOT reach `registerRoutes` or `httpServer.listen()` while waiting
4. After A releases, B acquires lock, runs the chain (idempotent — IF NOT EXISTS / sync), completes, proceeds to `listen()`
5. If the chain takes >120s, `statement_timeout` fires and the process crashes (preventing indefinite hangs)

### Operational Tradeoff: In-Process Startup Jobs

Startup jobs run inside the web server process. This is intentional:

**Why:** Simpler deployment (single process); blocking locks guarantee no traffic before readiness; critical failures crash the process for health check restart.

**Residual risk:** Startup time increases slightly due to sequential execution. A long-running migration blocks all instances from serving traffic until the lock holder completes.

**Mitigation path (future):** Extract to a `scripts/startup.ts` entrypoint or use deployment lifecycle hooks to run before the web process.

### Removed: process.exit Suppression

The `process.exit` monkey-patch that suppressed non-zero exits has been removed. Fatal failures now crash the process as expected, enabling proper health check failures and container restart.

### Removed: Startup Credit Correction

The one-off `correctDoubleRefundCredits` function no longer runs on every boot. It has been extracted to `scripts/fix-double-refund-credit-correction.ts` and must be intentionally invoked with `npx tsx scripts/fix-double-refund-credit-correction.ts`.

---

## Deployment Checklist

### Pre-Deployment

- [ ] All environment variables configured (see table below)
- [ ] `ADMIN_USER_IDS` contains the correct Clerk user IDs for admin access
- [ ] Clerk production keys (`CLERK_PROD_SECRET_KEY`, `CLERK_PROD_PUBLISHABLE_KEY`) are set
- [ ] Stripe webhook endpoint URL points to production domain
- [ ] Database is accessible and connection string is correct
- [ ] `npm run build` completes without errors

### Post-Deployment

- [ ] Application starts without migration errors
- [ ] `GET /healthz` returns `{ ok: true }` with status 200
- [ ] Stripe webhook receives test events
- [ ] Authentication flow works (sign in, sign out)
- [ ] Credit purchase flow works end-to-end
- [ ] Security headers present (check with browser dev tools or `curl -I`)
- [ ] `Strict-Transport-Security` header present in production responses
- [ ] Admin routes accessible only to configured admin users

---

## Required Environment Variables

| Variable | Purpose | Required | Source |
|---|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | Yes | Replit DB |
| `CLERK_SECRET_KEY` | Clerk auth (dev) | Dev only | Clerk dashboard |
| `CLERK_PUBLISHABLE_KEY` | Clerk auth (dev) | Dev only | Clerk dashboard |
| `CLERK_PROD_SECRET_KEY` | Clerk auth (prod — overrides `CLERK_SECRET_KEY`) | Prod only | Clerk dashboard |
| `CLERK_PROD_PUBLISHABLE_KEY` | Clerk auth (prod — overrides `CLERK_PUBLISHABLE_KEY`) | Prod only | Clerk dashboard |
| `ADMIN_USER_IDS` | Comma-separated Clerk user IDs for admin access | Yes | Manual |
| `SUPPORT_EMAIL` | Support email recipient (default: `support@askaicouncil.com`) | No | Manual |
| `AI_INTEGRATIONS_OPENROUTER_API_KEY` | OpenRouter API key for AI model access | Yes | Replit integration |
| `AI_INTEGRATIONS_OPENROUTER_BASE_URL` | OpenRouter base URL (default: `https://openrouter.ai/api/v1`) | No | Replit integration |
| `REPLIT_DOMAINS` | Allowed origins for CSRF validation | Auto | Replit platform |
| `REPLIT_DEV_DOMAIN` | Dev domain for CSRF + base URL | Auto | Replit platform |
| `REPLIT_DEPLOYMENT` | Set to `1` in production by Replit | Auto | Replit platform |
| `PORT` | Server port (default: 5000) | No | Replit platform |
| `NODE_ENV` | `development` or `production` | Auto | Replit platform |

Stripe-related variables are managed by the `stripe-replit-sync` integration and do not need manual configuration.

---

## Multi-Instance Safety Assessment

The application is designed to run safely on **multiple instances** with the following safeguards:

### Safe for Multi-Instance

| Component | Mechanism | Notes |
|---|---|---|
| Critical startup chain | Blocking advisory lock (ID 200) | Migrations → Stripe → views run in strict order; non-holders wait; 120s timeout |
| Stuck conversation recovery | Advisory lock (ID 102) | Prevents duplicate refunds during startup |
| Analytics backfill | Advisory lock (ID 103) | Prevents concurrent updates |
| Credit expiration cron | Non-blocking advisory lock (ID 42) | Skipped with log message if another instance holds lock |
| Per-user rate limiting | Postgres `rate_limit_buckets` table | Shared across instances via atomic upsert |
| Credit transactions | Unique index on `stripe_session_id` | Prevents duplicate credit grants |
| Refunds | Atomic `settled` flag (CAS) | Prevents duplicate refunds |
| Status transitions | Compare-and-set WHERE clauses | Prevents race conditions on cancel/retry |
| Attachment authorization | `file_uploads` table + object storage ACL | Ownership checked via DB, safe across instances |
| CSRF origin check | Stateless | Origin validation against env vars |
| Session management | Stateless | Clerk JWT-based, no server-side sessions |

### Assumptions

1. **Single database** — All instances connect to the same PostgreSQL database
2. **No sticky sessions required** — Clerk JWT auth is stateless; no server-side session state
3. **In-flight debates are instance-bound** — A debate started on instance A cannot be cancelled from instance B's in-memory abort controller. The stale recovery job (every 5 minutes, 15-minute threshold) recovers these automatically.
4. **Boot-time orphan cleanup is instance-local** — Each instance only cleans up temp files in its own `uploads/` directory

### Operational Notes

- **Startup jobs** run in the web process under advisory locks. This is simpler than separate worker processes but means startup is slightly slower. The tradeoff is acceptable for the current scale.
- **Stale recovery interval** runs every 5 minutes and recovers conversations stuck > 15 minutes. This handles the case where an instance dies mid-debate without graceful shutdown.
- **Graceful shutdown** waits up to 30 seconds for in-flight work, then marks remaining conversations as error and issues refunds.
- **Credit expiration cron** runs on every instance but uses advisory locking internally to prevent concurrent execution.
