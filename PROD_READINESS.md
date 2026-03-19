# Production Readiness Assessment

## Startup Safety

### Advisory Lock Protection

All startup jobs that mutate shared state are protected by Postgres advisory locks (`pg_try_advisory_lock`), which prevents duplicate execution across multiple instances.

| Job | Lock ID | Criticality | Failure Behavior |
|-----|---------|-------------|------------------|
| App Migrations | 100 | Critical | Crashes process on failure |
| Stripe Init | 101 | Critical | Crashes process on failure |
| Stuck Conversation Recovery | 102 | Non-critical | Logs error, continues startup |
| Analytics Backfill | 103 | Non-critical | Logs error, continues startup |
| Credit Expiration Cron | 42 | Non-critical | Skips cycle if locked |

When a lock is already held by another instance, the job is silently skipped with a log message. This is safe because only one instance needs to run migrations, init, and recovery.

### Operational Tradeoff: In-Process Startup Jobs

Startup jobs (migrations, Stripe init, recovery, analytics backfill) run inside the web server process rather than in separate worker entrypoints. This is an intentional tradeoff:

**Why this approach:**
- Simpler deployment: single process to manage
- Advisory locks prevent duplicate execution across instances
- Critical jobs (migrations, Stripe) crash the process on failure, preventing a misconfigured instance from serving traffic

**Residual risks:**
- Startup time increases slightly due to sequential job execution
- A long-running migration blocks the web server from accepting traffic until complete
- In a multi-instance deployment, only one instance runs each job; others skip and proceed

**Mitigation path (future):**
- Extract startup jobs to a separate `scripts/startup.ts` entrypoint that runs before the web server starts
- Use Replit's deployment lifecycle hooks to run migrations before the web process

### Removed: process.exit Suppression

The `process.exit` monkey-patch that suppressed non-zero exits has been removed. Fatal failures now crash the process as expected, enabling proper health check failures and container restart.

### Removed: Startup Credit Correction

The one-off `correctDoubleRefundCredits` function no longer runs on every boot. It has been extracted to `scripts/fix-double-refund-credit-correction.ts` and must be intentionally invoked with `npx tsx scripts/fix-double-refund-credit-correction.ts`.

## Required Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| DATABASE_URL | Yes | PostgreSQL connection string |
| CLERK_SECRET_KEY | Yes | Clerk authentication secret |
| CLERK_PUBLISHABLE_KEY | Yes | Clerk authentication publishable key |
| STRIPE_SECRET_KEY | Yes | Stripe API secret key |
| OPENROUTER_API_KEY | Yes | OpenRouter API key for AI models |
| RESEND_API_KEY | No | Resend email API key |
| PORT | No | Server port (default: 5000) |

For production deployments, also set:
- `CLERK_PROD_SECRET_KEY` and `CLERK_PROD_PUBLISHABLE_KEY` (overrides dev keys when `NODE_ENV=production`)

## Multi-Instance Safety

| Concern | Status | Mechanism |
|---------|--------|-----------|
| Database migrations | Safe | Advisory lock 100 |
| Stripe initialization | Safe | Advisory lock 101 |
| Conversation recovery | Safe | Advisory lock 102 |
| Analytics backfill | Safe | Advisory lock 103 |
| Credit expiration cron | Safe | Advisory lock 42 |
| Rate limiting | In-memory | Not shared across instances (see Task #74) |
| CSRF origin check | Safe | Stateless origin validation |
| Session management | Safe | Clerk JWT-based, stateless |
