# Security Audit Report — AI Council

**Date:** March 18–19, 2026 (Phases 1–4)  
**Last Updated:** March 19, 2026  
**Scope:** Full codebase security audit and hardening  
**Status:** All critical and high-priority issues fixed across 4 phases; medium and low items addressed or documented

---

## Phase 1 Security Scorecard (Superseded — see Post Phase 4 scorecard below)

| Category | Rating | Notes |
|---|---|---|
| **Authentication** | ✅ Strong | Clerk-based auth with `isAuthenticated` middleware on all sensitive routes |
| **Secrets Management** | ✅ Good | Secrets via env vars; `.env` now in `.gitignore`; no hardcoded secrets found |
| **Input Validation** | ✅ Good | Zod schemas on all user inputs; file type allowlists added |
| **API Security** | ✅ Good | Rate limiting on all sensitive endpoints; SSRF protections added |
| **Dependency Security** | ⚠️ Acceptable | 5 low-severity issues in `@google-cloud/storage` deps (breaking change required); `fast-xml-parser` CVE fixed |
| **Frontend Security** | ✅ Good | No secrets in client state; Clerk tokens managed in memory |
| **Infrastructure** | ✅ Good | Helmet security headers; body size limits; `nosniff` on file serving |
| **Abuse Prevention** | ✅ Good | Per-endpoint rate limiting; file upload size/type restrictions |

---

## Prioritized Findings

### Critical — Fixed

**1. Unauthenticated admin endpoint (`GET /api/admin/support-messages`)**
- **Risk:** Complete data exposure — anyone could read all support messages without authentication
- **Fix:** Added `isAuthenticated` middleware and `isAdmin(req)` guard, matching the pattern used by `/api/admin/analytics`

**2. SSRF in `imageUrlToBase64`**
- **Risk:** Server-side request forgery — users could supply URLs pointing to internal services (cloud metadata at `169.254.169.254`, localhost ports, internal networks)
- **Fix:** Replaced open fetch with strict HTTPS-only allowlist via `isUrlSafeForFetch()`. Only Replit app domains (`REPLIT_DOMAINS`, `REPLIT_DEV_DOMAIN`) and `storage.googleapis.com` are permitted. Local files and object storage paths are resolved directly without any HTTP fetch. All `http://` URLs are blocked.

**3. SSRF in `extract-text` endpoint**
- **Risk:** `POST /api/uploads/extract-text` accepted arbitrary URLs in `fileUrl` body parameter and fetched them via HTTP, including to `http://localhost:5000`
- **Fix:** Removed the arbitrary HTTP fetch fallback entirely. The endpoint now only accepts local file paths (resolved via `resolveLocalFilePath`) and object storage paths.

**4. Missing security headers**
- **Risk:** No `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`, `Referrer-Policy`, or `Permissions-Policy` headers
- **Fix:** Installed and configured `helmet` with sensible defaults (CSP disabled to avoid breaking inline scripts; COEP disabled for cross-origin resources)

### High Priority — Fixed

**5. Missing `nosniff` and `Content-Disposition` on file serving**
- **Risk:** Browsers could MIME-sniff uploaded files and render malicious content (SVGs with embedded scripts, HTML files)
- **Fix:** Added `X-Content-Type-Options: nosniff` to `/uploads/:filename` and `/objects/*` routes. Added `Content-Disposition: inline` for safe types (images, PDFs) and `Content-Disposition: attachment` for all others. Removed SVG from inline-safe types.

**6. No file type filter on direct uploads**
- **Risk:** `POST /api/uploads/direct` accepted any file type, allowing arbitrary file uploads
- **Fix:** Added MIME type allowlist: images, PDFs, text/plain, and Word documents

**7. Missing rate limits on sensitive endpoints**
- **Risk:** Endpoints for file uploads, text extraction (CPU-heavy PDF parsing), credit recovery, payment setup, and account deletion had no specific rate limits beyond the global 100/15min
- **Fix:** Added per-endpoint rate limiters:
  - File uploads: 20/min
  - Text extraction: 10/min
  - Stripe operations (portal, setup, recover, sync): 5/min
  - Account deletion: 3/min
  - Support uploads: 5/min (tightened from 10/min)

**8. Host header injection in `getBaseUrl`**
- **Risk:** `req.get("host")` was trusted directly, allowing attacker-controlled domains to be injected into Stripe redirect URLs
- **Fix:** Host header is now validated against `REPLIT_DOMAINS` and `REPLIT_DEV_DOMAIN` allowlist. Function fails closed to `http://localhost:PORT` when no allowed domains are configured — never trusts an unvalidated Host header.

**9. Error detail leakage**
- **Risk:** Some catch blocks logged full error objects (which could contain headers/tokens) and the global error handler forwarded `err.message` for all status codes
- **Fix:** 
  - Global error handler now returns generic "Internal Server Error" for 5xx errors
  - All Stripe-related catch blocks now log only `error.message` instead of the full error object
  - No internal error details, stack traces, or SQL errors are sent to API clients

### Medium Priority — Fixed

**10. `.env` not in `.gitignore`**
- **Risk:** Accidental commit of secret files
- **Fix:** Added `.env` and `.env.*` patterns to `.gitignore` (with `!.env.example` exception)

**11. Console logging audit**
- **Finding:** Server logs contain operational data (user IDs, conversation IDs, credit amounts) which is appropriate for debugging. No API keys, auth tokens, or raw request bodies are logged. Stripe error objects were logging full objects (potentially including headers) — now fixed to log only messages.

**12. Attachment count and total size validation**
- **Risk:** No server-side enforcement of attachment count or total size beyond Zod schema array max
- **Fix:** Added explicit server-side validation on both `create` and `addMessage` endpoints: max 30 attachments and 50MB total size. These checks run after Zod parsing but before processing.

**13. Support upload endpoint hardened**
- **Risk:** `POST /api/support/upload` was publicly accessible with a generous rate limit (10/min)
- **Fix:** Tightened rate limit to 5/min. The endpoint already has file type filtering (images only) and size limits (5MB). Adding auth would break the support form for non-logged-in users, which is the intended use case.

**14. Request body size limits**
- **Risk:** Express `json()` and `urlencoded()` middleware had 50MB limits, enabling large payload DoS
- **Fix:** Reduced to 1MB for both. The Stripe webhook endpoint uses `express.raw()` separately and is registered before the JSON parser.

**15. Background job and cron security**
- **Finding:** The credit expiration cron uses `pg_advisory_lock(42)` correctly — acquired at start, released in `finally` block. The lock is properly released on error paths via `client.query("SELECT pg_advisory_unlock(42)").catch(() => {})`. Stale conversation recovery uses proper WHERE clauses with status checks to prevent double-processing.

### Low Priority — Addressed

**16. Dependency vulnerabilities**
- **Finding:** `npm audit` showed 6 vulnerabilities. Fixed `fast-xml-parser` (high severity CVE). 5 remaining low-severity issues are in `@google-cloud/storage` dependency chain and require a breaking major version downgrade — not safe to fix.

**17. CORS configuration**
- **Finding:** No explicit CORS middleware is configured. This is correct for a same-origin application where frontend and backend are served from the same Express server. No action needed.

**18. Stripe webhook signature verification**
- **Finding:** The webhook endpoint correctly checks for `stripe-signature` header, verifies `req.body` is a Buffer, and passes it to `WebhookHandlers.processWebhook()` which uses `stripe-replit-sync` for signature verification. The raw body is preserved via `express.raw({ type: 'application/json' })` registered before the JSON parser.

**19. Frontend security review**
- **Finding:** Clerk tokens are managed via a getter function in `client/src/lib/clerk-token.ts` (in memory, not localStorage). No sensitive config values are exposed in client-side state. The only client-exposed config is the Clerk publishable key (which is designed to be public).

---

## Audit Checklist Coverage (A–O)

| # | Category | Status |
|---|---|---|
| A | Secrets & Environment Variables | ✅ Clean — no hardcoded secrets; `.env` gitignored |
| B | Authentication & Authorization | ✅ Fixed — admin endpoint secured; all sensitive routes require auth |
| C | Session Management | ✅ Clean — Clerk handles sessions; no custom session logic |
| D | Input Validation | ✅ Hardened — Zod schemas, file type allowlists, URL validation |
| E | API Security | ✅ Hardened — rate limiting, SSRF protection, body size limits |
| F | File Upload/Serving | ✅ Hardened — type allowlists, nosniff, Content-Disposition, path traversal checks |
| G | Security Headers | ✅ Fixed — helmet configured with sensible defaults |
| H | SSRF Prevention | ✅ Fixed — IP/hostname blocklist, removed arbitrary fetch paths |
| I | Error Handling | ✅ Fixed — generic errors for 5xx, sanitized logging |
| J | Business Logic | ✅ Clean — credit deductions use transactions with WHERE guards |
| K | Background Jobs | ✅ Clean — advisory locks, proper error handling, idempotent operations |
| L | Dependency Security | ⚠️ Partial — high CVE fixed; low-severity issues require breaking changes |
| M | Frontend Security | ✅ Clean — no exposed secrets or tokens |
| N | CORS | ✅ Clean — same-origin architecture, no CORS needed |
| O | Webhook Security | ✅ Clean — signature verification via stripe-replit-sync |

---

---

## Phase 2 Hardening (March 18, 2026)

### Critical — Fixed

**20. Auth identity collision / account takeover**
- **Risk:** When a new user signed in with an email already in use by a different account, `upsertUser` would silently reassign the existing account's `id` to the new identity — enabling full account takeover.
- **Fix:** `upsertUser` now uses `onConflictDoUpdate` on `id` only. Email uniqueness violations (Postgres `23505`) return `{ status: "email_collision_blocked" }` instead of overwriting. The auth middleware returns HTTP 409 with a support-contact message. All collisions are logged.
- **File:** `server/replit_integrations/auth/storage.ts`

### High — Fixed

**21. Upload and object storage access control**
- **Risk:** `/uploads/:filename` served any uploaded file publicly. `/api/support/upload` had no auth. `/objects/` bypassed ACL checks.
- **Fix:** 
  - New `file_uploads` table tracks ownership (user_id, filename, purpose).
  - `/uploads/:filename` checks requester against file owner; unauthenticated requests to owned files return 403.
  - `/api/support/upload` now requires `isAuthenticated`.
  - `/objects/` now enforces `canAccessObjectEntity` ACL.
  - 404s replaced with 403s to prevent information disclosure.
- **File:** `server/replit_integrations/object_storage/routes.ts`

### Medium — Fixed

**22. Content Security Policy enabled**
- **Risk:** CSP was fully disabled (`contentSecurityPolicy: false`), leaving the app open to XSS/data exfiltration.
- **Fix:** Strict CSP configured with allowlists for Clerk, Stripe, RefGrow, Google Fonts, and Replit WebSocket domains. `object-src: 'none'`, `base-uri: 'self'`, `frame-ancestors: 'self'`, `form-action: 'self'`.
- **Note:** `'unsafe-inline'` is required for scripts/styles due to Clerk SDK. Tighten to nonce-based when Clerk supports it.
- **File:** `server/index.ts`

**23. File upload validation hardened**
- **Risk:** File validation relied only on browser-reported MIME type (trivially spoofable). No magic-byte checks, no extension blocklist, no filename sanitization.
- **Fix:** Magic-byte verification for PNG, JPEG, GIF, WebP, PDF, DOCX, DOC. Extension blocklist blocks executables, scripts, and HTML variants. Multi-extension filenames (e.g., `file.pdf.exe`) are detected. Null bytes in filenames are rejected. `Content-Disposition: attachment` for non-image/PDF types.
- **File:** `server/replit_integrations/object_storage/routes.ts`

**24. CSRF / Origin validation**
- **Risk:** No Origin header validation on state-changing API requests, enabling cross-site request forgery.
- **Fix:** Middleware validates `Origin` header on POST/PUT/PATCH/DELETE to `/api/` against known Replit domains. Mismatched origins return 403 and are logged. Stripe webhook is excluded.
- **File:** `server/index.ts`

**25. Account deletion hardened**
- **Risk:** Account deletion only required a modal click — no typed confirmation.
- **Fix:** Backend requires `{ confirmation: "DELETE" }` in request body. Frontend shows a text input requiring the user to type "DELETE" before the button activates. All deletions are logged via security logger.
- **Files:** `server/routes.ts`, `client/src/pages/Profile.tsx`

**26. Per-user rate limiting**
- **Risk:** Rate limiters were IP-based only, allowing abuse via proxies and incorrect attribution on shared IPs.
- **Fix:** In-memory per-user rate limiter supplements IP-based limits. Debate creation: 5/user/min. Stale buckets cleaned every 5 minutes. Rate limit hits logged.
- **File:** `server/routes.ts`

**27. Structured security logging**
- **Fix:** Centralized `securityLog` module with structured JSON logging for: auth collisions, file access denials, destructive actions, CSRF mismatches, upload validation failures, and rate limit hits. PII is redacted. All events prefixed with `[SECURITY]` for easy grep/filter.
- **File:** `server/securityLogger.ts`

---

## Security Scorecard (Post Phase 4)

| Category | Rating | Notes |
|---|---|---|
| **Authentication** | ✅ Strong | Clerk auth; identity collision blocked; step-up auth on destructive actions |
| **Authorization** | ✅ Strong | File ownership tracking; ACL enforcement; fail-closed on missing records |
| **Secrets Management** | ✅ Good | Secrets via env vars; `.env` gitignored |
| **Input Validation** | ✅ Strong | Zod schemas; magic-byte + extension-MIME validation; double-extension rejection |
| **API Security** | ✅ Strong | IP + Postgres-backed per-user rate limiting; CSRF origin checks; concurrent debate limits |
| **File Upload/Serving** | ✅ Strong | Magic bytes; extension blocklist; ownership ACL; nosniff; attachment for non-images |
| **Security Headers** | ✅ Strong | Helmet + full CSP; Cache-Control: no-store on sensitive routes |
| **SSRF Prevention** | ✅ Strong | IP/hostname allowlist; no arbitrary fetch |
| **Error Handling** | ✅ Good | Generic 5xx errors; sanitized logging; no stack traces to clients |
| **Business Logic** | ✅ Good | Credit transactions with WHERE guards; typed deletion confirmation; concurrent limits |
| **Monitoring** | ✅ Strong | Structured JSON security logging; 8 event types; PII redaction |
| **Multi-Instance Safety** | ✅ Good | Advisory locks on startup; Postgres-backed rate limits; idempotent jobs |

---

## Phase 3 Hardening (March 19, 2026)

### Critical — Fixed

**28. Extract-text ACL bypass on object storage and local files**
- **Risk:** `POST /api/uploads/extract-text` accessed object storage files without verifying the requesting user had read permission via the ACL system. The local file ownership check was also fail-open for files without ownership records. Any authenticated user could extract text from another user's files.
- **Fix:** Both object-storage branches (image and document) now call `objectStorageService.canAccessObjectEntity()` with `ObjectPermission.READ` before reading any file. The local file ownership check is now fail-closed: non-admin requests are denied when no ownership record exists. Access denied returns 403 and is logged.
- **File:** `server/routes.ts`

**29. Upload endpoint fail-open on missing ownership record**
- **Risk:** `GET /uploads/:filename` only denied access when a file had an owner and the requester didn't match. Files without ownership records (pre-migration uploads) were served to any authenticated user.
- **Fix:** Changed to fail-closed: if no ownership record exists and the requester is not an admin, access is denied with 403. Admins can still access all files.
- **File:** `server/replit_integrations/object_storage/routes.ts`

### High — Fixed

**30. PDF rendered images bypassed upload ACL**
- **Risk:** `renderPdfToImages` created temp files in `/uploads/` and passed HTTP URLs (`${baseUrl}/uploads/${filename}`) as image references. These URLs would be fetched via HTTP back through the server, bypassing ownership checks since temp render files had no ownership records.
- **Fix:** PDF rendered images now use direct file paths instead of HTTP URLs. `imageUrlToBase64` resolves them from disk directly, eliminating the HTTP round-trip and ownership check bypass.
- **File:** `server/routes.ts`

**31. Support form used unauthenticated requests**
- **Risk:** `SupportWidget.tsx` used plain `fetch()` instead of `authFetch()` for both `/api/support/upload` and `/api/support` endpoints. This bypassed Clerk token transmission, making requests unauthenticated.
- **Fix:** Switched both calls to `authFetch()`. Added `isAuthenticated` middleware to `POST /api/support` (the upload endpoint already had it).
- **Files:** `client/src/components/SupportWidget.tsx`, `server/routes.ts`

### Medium — Fixed

**32. CSRF middleware allowed missing Origin header**
- **Risk:** The CSRF origin check only ran when an `Origin` header was present. State-changing requests without an `Origin` header (e.g., from curl, scripts, or some browser extensions) bypassed validation entirely.
- **Fix:** When allowed origins are configured, requests with a missing `Origin` header are now denied with 403 and logged.
- **File:** `server/index.ts`

**33. Per-user rate limits were not route-scoped**
- **Risk:** All per-user rate limit checks shared a single global bucket per user. A user exhausting their limit on one endpoint would be blocked on all endpoints, while a user could also avoid limits by spreading requests across endpoints.
- **Fix:** Rate limit keys are now scoped as `${userId}:${route}`. Each endpoint has its own independent per-user bucket.
- **File:** `server/routes.ts`

**34. Missing per-user rate limits on sensitive endpoints**
- **Risk:** Several sensitive endpoints only had IP-based rate limits: retry (3/min), extract-text (10/min), stripe.recover-credits (3/min), stripe.sync-credits (3/min).
- **Fix:** Added per-user rate limits to all four endpoints with appropriate thresholds.
- **File:** `server/routes.ts`

**35. Admin routes and billing mutations not logged**
- **Risk:** Admin access to support messages, analytics, and analytics refresh were not captured in security logs. Subscription cancellation had no audit trail.
- **Fix:** Added `securityLog.adminAccess()` to all admin route handlers. Added `securityLog.billingAnomaly()` to subscription cancellation.
- **File:** `server/routes.ts`

### Low — Documented (No Fix Needed)

**36. CSP `unsafe-inline` in script-src**
- **Risk:** `'unsafe-inline'` in `script-src` weakens XSS protection.
- **Status:** Required by Clerk SDK which injects inline scripts. Cannot be replaced with nonce-based loading until Clerk supports it. Similarly, `'unsafe-inline'` in `style-src` is required for React's dynamic styles and Clerk's style injection.
- **Recommendation:** Revisit when Clerk adds nonce/hash support.

### Phase 4 — Hardening (March 19, 2026)

**37. Session-age check on destructive endpoints** — IMPLEMENTED (approximation)
- `requireRecentAuth` middleware checks Clerk JWT `iat` claim; rejects sessions older than 10 minutes
- Protected: DELETE /api/user, POST /api/stripe/cancel-subscription, POST /api/stripe/create-portal, POST /api/stripe/setup-payment
- Frontend detects `RECENT_AUTH_REQUIRED` response code and triggers sign-out + sign-in flow
- **Limitation**: JWT-age approximation, not true Clerk reverification. See residual risks.
- **Files:** `server/security/recentAuth.ts`, `client/src/pages/Profile.tsx`

**38. Startup safety — advisory locks and process hardening**
- **Risk:** Multi-instance deployments could run migrations and startup jobs concurrently, causing data corruption.
- **Fix:** All startup jobs (migrations, Stripe sync, stale recovery, analytics backfill) now use Postgres advisory locks. Migrations and Stripe sync are critical (rethrow on error). Removed `process.exit` monkey-patch; moved one-off credit correction script to `scripts/`.
- **File:** `server/security/advisoryLocks.ts`, `server/index.ts`

**39. Distributed rate limiting (Postgres-backed)**
- **Risk:** In-memory per-user rate limits were lost on restart and not shared across instances.
- **Fix:** `rate_limit_buckets` table with atomic `checkPerUserLimit()` using INSERT ON CONFLICT + UPDATE. Route-scoped keys prevent cross-endpoint interference. Opportunistic cleanup of expired buckets.
- **File:** `server/security/rateLimiter.ts`

**40. Cache-Control on sensitive endpoints**
- **Risk:** Authenticated data endpoints (user profile, usage, payment methods, invoices) could be cached by browsers or proxies.
- **Fix:** Added `Cache-Control: no-store` at the top of all sensitive authenticated GET handlers so all code paths (success, error, early return) are covered.
- **Files:** `server/routes.ts`, `server/replit_integrations/auth/routes.ts`

**41. CSP unsafe-inline justification documented**
- `script-src 'unsafe-inline'`: Required for Clerk SDK inline script injection for auth widgets.
- `style-src 'unsafe-inline'`: Required for React CSS-in-JS and Clerk widget inline styles.
- Inline comments added to CSP configuration in `server/index.ts`.

**42. File upload validation hardened**
- **Risk:** WebP magic-byte check only verified RIFF header (shared with other RIFF formats). No extension-MIME consistency check. PDF served inline. Text/plain only checked for NUL bytes.
- **Fix:**
  - WebP now checks both RIFF header (bytes 0-3) AND "WEBP" signature (bytes 8-11)
  - Extension-MIME mismatch validation via `MIME_TO_EXTENSIONS` map
  - All double-extension filenames rejected (not just blocked-extension combinations)
  - PDF removed from `SAFE_INLINE_TYPES` — served as attachment
  - Text/plain binary detection strengthened: rejects >5% control/non-text bytes in 8KB sample
- **File:** `server/replit_integrations/object_storage/routes.ts`

**43. Document parser hardening**
- **Risk:** PDF/DOCX parsing had no timeout, no file size guard, could hang on malicious files.
- **Fix:**
  - 30-second timeout wrapper on all PDF and DOCX parsing operations
  - 50MB file size check before parsing
  - `getPdfPageCount` also wrapped with timeout
- **File:** `server/documentParser.ts`

**44. Concurrent debate limit**
- **Risk:** Users could start unlimited simultaneous debates, amplifying AI API costs.
- **Fix:** Before creating a new conversation, queries user's active debates. Rejects if >= 3 are in "processing" status.
- **File:** `server/routes.ts`

**45. Per-user rate limits on uploads and support**
- **Risk:** Upload and support endpoints only had IP-based limits.
- **Fix:**
  - `/api/uploads/direct`: 30/min per user
  - `/api/support/upload`: 10/min per user
  - `/api/support`: 10/day per user (daily limit)
  - Files cleaned up on rate-limit rejection
- **Files:** `server/replit_integrations/object_storage/routes.ts`, `server/routes.ts`

---

## Manual Testing Checklist

### Authentication & Authorization
- [ ] Unauthenticated requests to `/api/user/usage`, `/api/conversations`, `/api/support/upload` return 401/403
- [ ] Admin-only routes (`/api/admin/*`) reject non-admin users with 403
- [ ] File access: user A cannot access user B's uploaded files (returns 403)
- [ ] Files without ownership records return 403 for non-admin users

### CSRF Protection
- [ ] POST/PUT/PATCH/DELETE to `/api/*` without Origin header returns 403
- [ ] POST to `/api/conversations` with mismatched Origin returns 403
- [ ] GET requests work without Origin header
- [ ] Stripe webhook POST works without Origin header (exempted)

### Rate Limiting
- [ ] Creating > 5 debates per minute triggers per-user rate limit (429)
- [ ] Creating a debate while 3+ are processing triggers concurrent limit (429)
- [ ] Retrying > 3 times per minute triggers rate limit (429)
- [ ] Sending > 10 support messages in 24 hours triggers daily limit (429)
- [ ] Uploading > 30 files per minute triggers upload rate limit (429)

### File Upload Validation
- [ ] Uploading a renamed `.exe` → `.png` file is rejected (magic byte mismatch)
- [ ] Uploading a file with double extension (e.g., `test.pdf.exe`) is rejected
- [ ] Uploading an SVG, HTML, or JS file is rejected (blocked extension)
- [ ] Uploading a valid PNG, JPEG, PDF, DOCX succeeds
- [ ] Downloaded PDFs have `Content-Disposition: attachment`
- [ ] Downloaded images have `Content-Disposition: inline`

### Account Deletion
- [ ] DELETE `/api/user` without `{ confirmation: "DELETE" }` returns 400
- [ ] DELETE `/api/user` with a stale session (>10 min) returns 403 RECENT_AUTH_REQUIRED
- [ ] Frontend shows re-auth flow on RECENT_AUTH_REQUIRED
- [ ] Successful deletion removes user from DB, Stripe, and Clerk

### Sensitive Data Caching
- [ ] GET `/api/auth/user` response includes `Cache-Control: no-store`
- [ ] GET `/api/user/usage` response includes `Cache-Control: no-store`
- [ ] GET `/api/stripe/payment-method` response includes `Cache-Control: no-store`

### Security Headers
- [ ] Response includes `X-Content-Type-Options: nosniff`
- [ ] Response includes `Strict-Transport-Security` header
- [ ] Response includes `Content-Security-Policy` header (not report-only)
- [ ] Error responses (500) return generic message, no stack trace

---

## Residual Risks & Known Limitations

1. **Step-up auth is JWT-age approximation** — `requireRecentAuth` checks JWT `iat`, not true credential re-entry. A compromised session within 10 minutes can still perform destructive actions. True step-up requires Clerk reverification APIs (not available in @clerk/express v2).

2. **CSP `unsafe-inline`** — Required for Clerk SDK and React dynamic styles. Weakens XSS protection. Revisit when Clerk adds nonce/hash support.

3. **No support attachment retention cleanup** — Support upload images persist indefinitely. A retention job (delete `purpose='support'` files older than N days) would reduce storage abuse risk.

4. **Rate limit precision across restarts** — Postgres-backed rate limits survive restarts but have eventual-consistency semantics (opportunistic cleanup, no distributed clock).

5. **File ownership backfill gap** — Files uploaded before the `file_uploads` table have no ownership record and are inaccessible to non-admins (fail-closed is correct, but old data is orphaned).

6. **Low-severity dependency vulnerabilities** — 5 issues in `@google-cloud/storage` chain require a breaking major version change.

---

## Required Environment Variables

| Variable | Purpose | Required |
|---|---|---|
| `CLERK_SECRET_KEY` | Clerk auth (dev) | Yes |
| `CLERK_PUBLISHABLE_KEY` | Clerk auth (dev) | Yes |
| `CLERK_PROD_SECRET_KEY` | Clerk auth (prod, overrides SECRET_KEY) | Prod only |
| `CLERK_PROD_PUBLISHABLE_KEY` | Clerk auth (prod) | Prod only |
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `STRIPE_SECRET_KEY` | Stripe payments | Yes |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signature verification | Yes |
| `ADMIN_USER_IDS` | Comma-separated Clerk user IDs for admin access | Yes |
| `REPLIT_DOMAINS` | Allowed origins for CSRF validation | Auto-set by Replit |
| `REPLIT_DEV_DOMAIN` | Dev domain for CSRF validation | Auto-set by Replit |

---

## Recommendations (Require Product Decisions)

1. **CAPTCHA on support form** — Consider adding CAPTCHA to prevent automated abuse.
2. **Dependency upgrades** — `@google-cloud/storage` chain has low-severity issues requiring major version change.
3. **DNS-level SSRF protection** — Full mitigation would require a custom HTTP agent that validates resolved IPs before connecting.
4. **Redis-backed rate limiting** — For horizontal scaling, move per-user buckets to Redis. Current Postgres-backed approach works for single/few instances.
5. **CSP nonces** — Replace `'unsafe-inline'` with nonce-based script loading when Clerk supports it.
6. **File ownership backfill** — Files uploaded before the `file_uploads` table exists have no ownership record. Consider a migration to backfill from conversation attachment metadata.
7. **Support attachment retention** — Add a scheduled job to delete support-purpose uploads older than 30 days.
8. **True step-up auth** — Upgrade to Clerk reverification when @clerk/express supports it.
