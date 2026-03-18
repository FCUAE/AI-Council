# Security Audit Report — AI Council

**Date:** March 18, 2026  
**Scope:** Full codebase security audit and hardening  
**Status:** All critical and high-priority issues fixed; medium and low items addressed or documented

---

## Security Scorecard

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

## Recommendations (Require Product Decisions)

1. **CAPTCHA on support form** — The support form and upload endpoints are publicly accessible. Consider adding CAPTCHA to prevent automated abuse.
2. **Auth on support upload** — Currently anonymous to support non-logged-in users. Consider requiring auth if abuse becomes an issue.
3. **CSP headers** — Content Security Policy is currently disabled to avoid breaking inline scripts. Consider adding a policy once all inline scripts are moved to external files.
4. **Dependency upgrades** — The `@google-cloud/storage` dependency chain has 5 low-severity issues requiring a major version change. Schedule evaluation during next major upgrade cycle.
5. **DNS-level SSRF protection** — While the SSRF check now uses an allowlist (only Replit domains and GCS), DNS rebinding attacks are theoretically possible if an attacker compromises a DNS record for an allowed domain. Full mitigation would require a custom HTTP agent that validates resolved IPs before connecting.
