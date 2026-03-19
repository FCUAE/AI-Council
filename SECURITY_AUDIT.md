# Security Audit Report — AI Council

**Date:** March 18–19, 2026 (Phases 1–5)  
**Last Updated:** March 19, 2026  
**Auditor:** Automated security review + manual code audit  
**Scope:** Full codebase — authentication, authorization, billing, file handling, AI/attachment processing, API security, browser security, startup safety

---

## Executive Summary

The AI Council platform underwent a 5-phase security hardening across authentication, authorization, billing/payments, file handling, AI/attachment processing safety, API abuse prevention, browser security, and operational safety. **54 findings** were identified and addressed across Critical (6), High (6), Medium (17), and Low/Informational (25) severities.

**Production Readiness Verdict:** The application is production-ready with acceptable residual risk. All critical and high-priority vulnerabilities have been fixed. Remaining risks are documented below with mitigations in place.

---

## Security Scorecard

| Category | Rating | Details |
|---|---|---|
| **Authentication** | ✅ Strong | Clerk-based auth; identity collision blocked with 409; step-up auth (JWT-age) on destructive actions |
| **Authorization** | ✅ Strong | File ownership tracking via `file_uploads` table; ACL on object storage; fail-closed on missing records; admin guards on all admin routes |
| **Billing & Payments** | ✅ Strong | Idempotent refunds (atomic `settled` flag); duplicate revenue prevention; compare-and-set on status transitions; advisory-locked Stripe init |
| **Rate Limiting & Abuse** | ✅ Strong | IP-based global (100/15min) + Postgres-backed per-user limits on all sensitive endpoints; concurrent debate cap (3); daily support limit |
| **File Uploads** | ✅ Strong | Magic-byte verification; extension blocklist; double-extension rejection; MIME-extension consistency; ownership ACL; `nosniff` + `Content-Disposition` |
| **Document Parsing** | ✅ Good | 50MB size guard; 30s timeout; 3-page PDF render limit; 150 DPI cap; boot-time orphan cleanup; temp file `finally` blocks |
| **Frontend / Browser** | ✅ Good | Full CSP (with documented `unsafe-inline` for Clerk); HSTS (prod); Referrer-Policy; Permissions-Policy; COOP; no client-side secrets |
| **SSRF Prevention** | ✅ Strong | HTTPS-only allowlist (`isUrlSafeForFetch`); no arbitrary fetch paths; local file resolution with path traversal guard |
| **CSRF Protection** | ✅ Strong | Origin header validation on all state-changing requests; fail-closed on missing Origin; webhook exempt |
| **Error Handling** | ✅ Good | Generic "Internal Server Error" for 5xx; sanitized document parser errors; no stack traces to clients |
| **Logging & Monitoring** | ✅ Strong | Structured JSON security logging (8 event types); PII redaction; billing audit trail; no secrets logged |
| **AI/Attachment Processing** | ✅ Strong | Centralized `attachmentAuth.ts` with URL normalization; ownership/ACL validated at ingestion (before DB write); defense-in-depth in `imageUrlToBase64`; retry re-validates attachments; file existence ≠ authorization |
| **Multi-Instance Safety** | ✅ Good | Advisory locks on migrations, Stripe, recovery, analytics, cron; Postgres-backed rate limits; idempotent startup jobs; non-blocking cron lock |

---

## All Findings by Phase

### Phase 1 — Initial Audit (Critical + High)

#### Critical — Fixed

**1. Unauthenticated admin endpoint** (`GET /api/admin/support-messages`)
- **Risk:** Complete data exposure — anyone could read all support messages
- **Fix:** Added `isAuthenticated` + `isAdmin(req)` guard

**2. SSRF in `imageUrlToBase64`**
- **Risk:** Users could supply URLs targeting internal services (169.254.169.254, localhost)
- **Fix:** HTTPS-only allowlist via `isUrlSafeForFetch()` — only Replit domains + `storage.googleapis.com`

**3. SSRF in `extract-text` endpoint**
- **Risk:** Arbitrary HTTP fetch via `fileUrl` body parameter
- **Fix:** Removed HTTP fetch fallback; only local paths (`resolveLocalFilePath`) and object storage paths accepted

**4. Missing security headers**
- **Risk:** No `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`, etc.
- **Fix:** Helmet configured with full header suite

#### High — Fixed

**5. Missing `nosniff` and `Content-Disposition` on file serving**
- **Fix:** `nosniff` on `/uploads/` and `/objects/`; `Content-Disposition: attachment` for non-image types; SVG removed from inline-safe list

**6. No file type filter on direct uploads**
- **Fix:** MIME type allowlist: images, PDFs, text/plain, Word documents

**7. Missing rate limits on sensitive endpoints**
- **Fix:** Per-endpoint rate limiters on uploads, text extraction, Stripe operations, account deletion, support

**8. Host header injection in `getBaseUrl`**
- **Fix:** Host header validated against `REPLIT_DOMAINS` allowlist; fails closed to localhost

**9. Error detail leakage**
- **Fix:** Generic "Internal Server Error" for 5xx; Stripe catch blocks log `error.message` only

#### Medium — Fixed

**10.** `.env` added to `.gitignore`  
**11.** Console logging audit — no API keys/tokens logged  
**12.** Attachment count (30) and total size (50MB) server-side validation  
**13.** Support upload rate limit tightened to 5/min  
**14.** Request body size reduced to 1MB (JSON + urlencoded)  

#### Low — Addressed

**15.** Background job advisory locks verified correct  
**16.** Dependency vulnerabilities: `fast-xml-parser` CVE fixed; 5 low-severity `@google-cloud/storage` issues documented  
**17.** CORS: same-origin architecture, no CORS needed  
**18.** Stripe webhook signature verification verified correct  
**19.** Frontend: Clerk tokens in memory, no secrets in client state  

---

### Phase 2 — Identity & Access Control

#### Critical — Fixed

**20. Auth identity collision / account takeover**
- **Risk:** Email collision could reassign existing accounts to new identities
- **Fix:** `onConflictDoUpdate` on `id` only; email collisions return 409; all collisions logged

#### High — Fixed

**21. Upload and object storage access control**
- **Fix:** `file_uploads` table tracks ownership; `/uploads/` checks owner; `/objects/` enforces ACL; 404→403 to prevent info disclosure

#### Medium — Fixed

**22.** CSP enabled (Clerk/Stripe/RefGrow/Google Fonts allowlisted)  
**23.** File upload magic-byte verification (PNG, JPEG, GIF, WebP, PDF, DOCX, DOC); extension blocklist; double-extension detection; null byte rejection  
**24.** CSRF Origin validation on POST/PUT/PATCH/DELETE; Stripe webhook exempt  
**25.** Account deletion requires typed `{ confirmation: "DELETE" }` + step-up auth  
**26.** In-memory per-user rate limiting (superseded by Postgres-backed in Phase 4)  
**27.** Structured security logging (`securityLog` module with 8 event types)  

---

### Phase 3 — ACL Enforcement & Logging

#### Critical — Fixed

**28. Extract-text ACL bypass**
- **Risk:** Any authenticated user could extract text from another user's files
- **Fix:** Object storage ACL check (`canAccessObjectEntity` with READ permission) and fail-closed local file ownership

**29. Upload endpoint fail-open**
- **Risk:** Files without ownership records served to any authenticated user
- **Fix:** Fail-closed: no ownership record = 403 for non-admins

#### High — Fixed

**30.** PDF rendered images use direct file paths instead of HTTP URLs (eliminated ACL bypass)  
**31.** Support widget uses `authFetch()` + `isAuthenticated` on `POST /api/support`; userId bound server-side  

#### Medium — Fixed

**32.** CSRF: missing Origin header now denied (was pass-through)  
**33.** Per-user rate limits route-scoped (`${userId}:${route}` keys)  
**34.** Per-user rate limits added to retry, extract-text, recover-credits, sync-credits  
**35.** Security logging added to all admin routes, billing mutations, and all 403 deny paths  

#### Low — Documented

**36.** CSP `unsafe-inline` required for Clerk SDK — documented and tracked  

---

### Phase 4 — Hardening & Operational Safety

#### High — Fixed

**37. Step-up auth on destructive endpoints**
- `requireRecentAuth` checks JWT `iat` < 10 minutes
- Protected: DELETE /api/user, cancel-subscription, create-portal, setup-payment
- Limitation: JWT-age approximation, not true Clerk reverification

**38. Startup safety — advisory locks**
- All startup jobs (migrations, Stripe sync, stale recovery, analytics) and cron use Postgres advisory locks
- Lock IDs: migrations=100, Stripe=101, stale-recovery=102, analytics=103, credit-expiry-cron=42
- Migrations and Stripe are critical (rethrow on error); cron uses non-blocking lock (skips if held)

**39. Distributed rate limiting (Postgres-backed)**
- `rate_limit_buckets` table with atomic INSERT ON CONFLICT + UPDATE
- Survives restarts; shared across instances; opportunistic cleanup

#### Medium — Fixed

**40.** `Cache-Control: no-store` on all sensitive GET endpoints  
**41.** CSP `unsafe-inline` justification documented inline in code  
**42.** File upload: WebP checks both RIFF + "WEBP" signature; all double-extensions rejected; PDF served as attachment; text/plain binary detection strengthened  
**43.** Document parser: 30s timeout, 50MB size guard, `checkFileSize()` in all 4 parser functions  
**44.** Concurrent debate limit: max 3 in "processing" state per user  
**45.** Per-user rate limits on uploads (10/min), support (3/min + 10/day), support upload (10/min)  
**46.** Security headers: Referrer-Policy, Permissions-Policy (camera/mic/geo denied, Stripe payment allowed), HSTS (prod-only), COOP (`same-origin-allow-popups`), CSP `upgrade-insecure-requests`  
**47.** CSP nonce investigation: not feasible due to Clerk SDK inline script injection  
**48.** Document parser file processing: boot-time orphan cleanup, temp file `finally` blocks, error message sanitization  

#### Business Logic Race Conditions — Fixed

**49. Duplicate refund prevention**
- **Risk:** Multiple error paths (timeout, cancel, error, stale recovery, shutdown) could all call `refundDebateCredits` for the same conversation, producing duplicate credit refunds
- **Fix:** `refundDebateCredits` now atomically checks and sets the `settled` flag: `UPDATE conversations SET settled = 1 WHERE id = ? AND settled = 0 RETURNING id`. If no row is returned, the refund is skipped. This prevents all duplicate refund scenarios regardless of which error path triggers first.

**50. Revenue tracking idempotency**
- **Risk:** `recover-credits` endpoint called `storage.logCreditTransaction` without checking its return value before calling `incrementUserRevenue`. A race condition could allow the same Stripe session to inflate revenue even though the unique index on `stripe_session_id` prevented duplicate credit grants.
- **Fix:** Recovery now checks `logCreditTransaction` return value; if `false` (duplicate), skips revenue increment entirely. The `sync-credits` endpoint already had this guard via the `inserted` variable.

**51. Compare-and-set on cancel/retry**
- **Risk:** Non-atomic status updates on cancel and retry endpoints could race with in-flight processing, leading to inconsistent state (e.g., cancelling an already-completed debate, retrying a debate that's already being retried).
- **Fix:** Cancel uses `UPDATE ... SET status = 'cancelled' WHERE status = 'processing'` with RETURNING. Retry uses `UPDATE ... SET status = 'processing' WHERE status IN ('error', 'cancelled')` with RETURNING. Both return 409 if the status has already changed.

### Phase 5 — Final Security Hardening (Attachment Auth & Cron)

#### Critical — Fixed

**52. Attachment URL IDOR bypass in conversation create/addMessage**
- **Risk:** Users could submit another user's `/uploads/` or `/objects/` file URLs as attachment references in conversation create or add-message requests. The server would store these URLs in the database and process them via `imageUrlToBase64` and `processCouncilMessage` without verifying that the requesting user owned or had ACL access to the referenced files. This allowed cross-user file exfiltration through AI processing.
- **Fix:** Centralized `server/security/attachmentAuth.ts` module with:
  - `normalizeAttachmentUrl()` — canonicalizes URLs before validation (decodes, strips query/fragments, collapses duplicate slashes, resolves traversal segments, rejects malformed URLs)
  - `validateAttachmentAccess()` — checks `/uploads/*` ownership via `file_uploads` table (missing record = deny), `/objects/*` via `canAccessObjectEntity` ACL, external URLs via `isUrlSafeForFetch` allowlist
  - `validateAttachmentsBatch()` — validates all attachments, rejects entire request on first failure, logs denials via `securityLog`
  - Ingestion validation in POST `/api/conversations` and POST `/api/conversations/:id/messages` BEFORE inserting messages into the database — unauthorized attachment URLs are never stored
  - Retry endpoint re-validates all stored attachments against the current authenticated user
  - Defense-in-depth in `imageUrlToBase64` — ownership/ACL checks with userId and isAdminUser parameters threaded through `processCouncilMessage` → `callLLMWithVision` → `convertImagesToBase64` → `imageUrlToBase64`; admin override consistent between ingestion and processing
  - File existence is NOT proof of authorization — `file_uploads` ownership record required

#### Medium — Fixed

**53. Credit expiration cron used blocking advisory lock**
- **Risk:** The credit expiration cron used `pg_advisory_lock(42)` (blocking) while all other startup jobs used `pg_try_advisory_lock` (non-blocking). On multi-instance deployments, a stuck cron job on one instance could block the cron check on all other instances indefinitely.
- **Fix:** Converted to `withAdvisoryLock` helper (non-blocking `pg_try_advisory_lock`). Skipped runs are logged clearly. Lock acquire and release happen on the same DB session.

#### Low — Fixed

**54. Attachment auth tests**
- 21 unit tests covering URL normalization, ownership validation, batch rejection, traversal attempts, unknown URL patterns, data URI passthrough, and malformed URL handling

---

## Residual Risks & Known Limitations

### High Impact (Mitigated)

1. **CSP `unsafe-inline`** — Required for Clerk SDK (script-src) and React CSS-in-JS (style-src). Weakens XSS protection. Mitigated by strict CSP on all other directives. Revisit when Clerk adds nonce/hash support.

2. **Step-up auth is JWT-age approximation** — `requireRecentAuth` checks JWT `iat`, not true credential re-entry. A compromised session within 10 minutes can perform destructive actions. True step-up requires Clerk reverification APIs (not available in @clerk/express v2).

### Medium Impact (Mitigated)

3. **Document parsing in-process** — All parsing runs in the main Node.js process. A crash in sharp/pdftoppm could take down the server. Mitigated by: 30s timeout, restart via workflow manager, 50MB size guard, 3-page render limit.

4. **pdftoppm memory limit** — No memory limit flag available. High-resolution PDF pages could consume excessive memory during rendering. Mitigated by: 150 DPI cap, 3-page limit, 30s timeout, 50MB file size guard.

5. **Decompression bombs** — mammoth (DOCX) and pdf-parse (PDF) have no built-in decompression bomb protection. Mitigated by: 50MB file size guard (pre-decompression), 30s timeout, 200KB text output cap.

6. **No antivirus scanning** — Uploaded files not scanned for malware. Mitigated by: file type validation, magic byte checks, `Content-Disposition: attachment` for non-images.

### Low Impact

7. **Rate limit precision** — Postgres-backed limits have eventual-consistency semantics. Under extreme concurrent load, a small over-count is possible before the atomic upsert takes effect.

8. **File ownership backfill gap** — Files uploaded before the `file_uploads` table have no ownership record. Fail-closed (403 for non-admins) is the correct behavior, but old data is inaccessible.

9. **Support attachment retention** — Support upload images persist indefinitely. No retention job exists.

10. **Low-severity dependency vulnerabilities** — 5 issues in `@google-cloud/storage` chain require a breaking major version change.

---

## SSRF Review

| Path | Status | Notes |
|---|---|---|
| `imageUrlToBase64` | ✅ Safe | Defense-in-depth ownership/ACL checks (userId param); checks object storage → local path → `isUrlSafeForFetch` before any HTTP fetch |
| `extract-text` | ✅ Safe | Only `resolveLocalFilePath` and object storage; no HTTP fetch |
| `resolveLocalFilePath` | ✅ Safe | Path traversal guard via `path.resolve` + `startsWith` check |
| `isUrlSafeForFetch` | ✅ Safe | HTTPS-only; hostname checked against Replit domains + `storage.googleapis.com` |
| `stripeClient` | ✅ Safe | Fetches Replit connector hostname only (auto-set env var) |
| `email.ts` | ✅ Safe | Fetches Replit connector hostname only |

## IDOR Review

| Endpoint | Ownership Check | Status |
|---|---|---|
| `GET /api/conversations/:id` | `conv.userId !== userId` | ✅ |
| `POST /api/conversations` (attachments) | `validateAttachmentsBatch` before DB insert | ✅ |
| `POST /api/conversations/:id/messages` | `conv.userId !== userId` + `validateAttachmentsBatch` on attachments | ✅ |
| `POST /api/conversations/:id/cancel` | `conv.userId !== userId` | ✅ |
| `POST /api/conversations/:id/retry` | `conv.userId !== userId` + `validateAttachmentsBatch` on stored attachments | ✅ |
| `DELETE /api/conversations/:id` | `conv.userId !== userId` | ✅ |
| `PATCH /api/conversations/:id/rename` | `conv.userId !== userId` | ✅ |
| `GET /uploads/:filename` | `file_uploads` ownership lookup | ✅ |
| `POST /api/uploads/extract-text` | ACL check + local file ownership | ✅ |
| `/objects/*` | `canAccessObjectEntity` ACL | ✅ |
| `POST /api/stripe/sync-credits` | `session.metadata.userId !== userId` | ✅ |
| `GET /api/admin/*` | `isAdmin(req)` guard | ✅ |
| `imageUrlToBase64` (defense-in-depth) | userId-based ownership/ACL check | ✅ |

## Secrets & Logging Review

- No API keys, auth tokens, or Stripe secrets are logged
- Stripe catch blocks log `error.message` only (not full error objects)
- User IDs and conversation IDs in logs are appropriate for operational debugging
- `securityLog` redacts PII (emails) via structured event types
- Client-facing errors are generic (no SQL, paths, or internal details)

## XSS Review

- All API responses use `res.json()` — no HTML rendering on server
- React (frontend) auto-escapes JSX output
- CSP blocks script loading from unauthorized sources
- `object-src: 'none'`, `base-uri: 'self'`, `form-action: 'self'` provide defense-in-depth
- User input is never interpolated into HTML on the server

---

## Rate Limiting Summary

| Endpoint | IP Limit | Per-User Limit | Notes |
|---|---|---|---|
| All `/api/*` | 100/15min | — | Global baseline |
| Create conversation | 5/min | 5/min | + concurrent limit (3) |
| Add message | 5/min | 5/min | |
| Retry | 3/min | 3/min | |
| Cancel | 3/min | — | |
| Extract text | 10/min | 10/min | |
| Direct upload | 10/min | 10/min | |
| Support | — | 3/min + 10/day | Daily limit resets at midnight |
| Support upload | 10/min | 10/min | |
| Stripe recover-credits | 5/min | 2/min | |
| Stripe sync-credits | 5/min | 3/min | |
| Stripe portal/setup | 5/min | — | |
| Account deletion | 3/min | — | + step-up auth |

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
- [ ] Uploading > 10 files per minute triggers upload rate limit (429)

### File Upload Validation
- [ ] Uploading a renamed `.exe` → `.png` file is rejected (magic byte mismatch)
- [ ] Uploading a file with double extension (e.g., `test.pdf.exe`) is rejected
- [ ] Uploading an SVG, HTML, or JS file is rejected (blocked extension)
- [ ] Uploading a valid PNG, JPEG, PDF, DOCX succeeds
- [ ] Downloaded PDFs have `Content-Disposition: attachment`
- [ ] Downloaded images have `Content-Disposition: inline`

### Billing Race Conditions
- [ ] Cancelling an already-completed debate returns 409
- [ ] Retrying a debate that's currently processing returns 409
- [ ] Double-clicking cancel doesn't produce duplicate refunds
- [ ] recover-credits with an already-recovered session doesn't double-count

### Account Deletion
- [ ] DELETE `/api/user` without `{ confirmation: "DELETE" }` returns 400
- [ ] DELETE `/api/user` with a stale session (>10 min) returns 403 RECENT_AUTH_REQUIRED
- [ ] Frontend shows re-auth flow on RECENT_AUTH_REQUIRED

### Sensitive Data Caching
- [ ] GET `/api/auth/user` response includes `Cache-Control: no-store`
- [ ] GET `/api/user/usage` response includes `Cache-Control: no-store`
- [ ] GET `/api/stripe/payment-method` response includes `Cache-Control: no-store`

### Security Headers
- [ ] Response includes `X-Content-Type-Options: nosniff`
- [ ] Response includes `Strict-Transport-Security` header (production)
- [ ] Response includes `Content-Security-Policy` header (not report-only)
- [ ] Response includes `Permissions-Policy` header
- [ ] Error responses (500) return generic message, no stack trace

---

## Recommendations (Future Work)

1. **CSP nonces** — Replace `'unsafe-inline'` when Clerk supports nonce-based script loading
2. **True step-up auth** — Upgrade to Clerk reverification when @clerk/express supports it
3. **Worker isolation** — Move document parsing to a separate worker process
4. **Redis-backed rate limiting** — For horizontal scaling beyond a few instances
5. **CAPTCHA on support form** — Prevent automated abuse
6. **File ownership backfill** — Migrate pre-`file_uploads` uploads from conversation attachment metadata
7. **Support attachment retention** — Scheduled job to delete support-purpose uploads after 30 days
8. **DNS-level SSRF protection** — Custom HTTP agent validating resolved IPs before connecting
9. **Dependency upgrades** — `@google-cloud/storage` chain low-severity issues when safe major version available
