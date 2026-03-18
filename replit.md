# Council (by CouncilAI)

## Overview

Council is a web application that enables users to ask questions and receive synthesized answers from multiple AI models working together. The system queries multiple language models through OpenRouter, collects their individual responses, has them cross-examine each other, and then uses a "lead model" (GPT-4o) to synthesize a final verdict. This creates a multi-stage deliberation process for more thoughtful AI responses.

Users can customize their council by selecting from 37 available models including GPT-5.4, GPT-5.4 Pro, GPT-5.2, Claude Opus 4.6, Claude Sonnet 4.5, o3, o4-mini, Grok 4, Llama, Gemini, DeepSeek, and Kimi K2.5. Each model displays its specialty and cost tier to help users make informed choices. Default council: GPT-4o, Claude 3.5 Sonnet, Gemini 2.5 Flash.

### Brand & Copy Guidelines
- Product name: "Council" (short for CouncilAI)
- Three deliberation stages: **The Hearing** → **Cross-Examination** → **The Verdict**
- The final answer display is called "The Verdict"
- The synthesizing model is called the "Lead Model" in UI (backend still uses "chairman" internally)
- The expandable section showing all model responses is called "Behind the Verdict" with sub-tabs: "Individual Opinions", "Cross-Examination", "Performance Rankings"
- Toggle text: "Show full deliberation" / "Hide full deliberation"

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React with TypeScript
- **Routing**: Wouter (lightweight client-side routing)
- **State Management**: TanStack React Query for server state
- **Styling**: Tailwind CSS with shadcn/ui component library, custom SCSS in `client/src/styles/carbon.scss`
- **Animations**: Framer Motion for smooth transitions
- **Icons**: Carbon Icons (`@carbon/icons-react`) for UI, Lucide for secondary icons
- **Build Tool**: Vite with hot module replacement

The frontend follows a pages-based structure with reusable components. The main user flows are:
1. Home page for starting new conversations
2. Chat page for multi-turn conversations with the council
3. Credits page for purchasing credit packs
4. Profile page for account settings and billing
5. Affiliate page for the Refgrow affiliate program dashboard

### Backend Architecture
- **Framework**: Express.js with TypeScript
- **API Design**: RESTful endpoints under `/api/`
- **Database ORM**: Drizzle ORM with PostgreSQL
- **AI Integration**: OpenRouter API (accessed via OpenAI-compatible client)

The backend implements a council deliberation pattern:
1. User submits a query
2. Three council models generate initial responses in parallel (The Hearing)
3. Each model reviews the others' responses (Cross-Examination)
4. A lead model synthesizes the final answer (The Verdict)

### Authentication & Authorization
- **Clerk Auth**: Authentication via `@clerk/express` (backend) and `@clerk/react` (frontend)
- **Backend middleware**: `clerkMiddleware()` runs on all routes; `isAuthenticated` middleware (in `server/replit_integrations/auth/replitAuth.ts`) uses `getAuth(req).userId` and syncs Clerk user data to the local `users` table
- **Frontend**: `<ClerkProvider>` wraps the app in `App.tsx`; `useAuth()` hook combines Clerk's `useUser()` with a DB fetch for credits/subscription data; `ClerkTokenSync` component sets up the token getter for `authFetch`
- **Auth token propagation**: All API calls use `authFetch()` from `client/src/lib/clerk-token.ts` which automatically attaches Clerk's JWT `Authorization: Bearer <token>` header. The `ClerkTokenSync` component (rendered inside `ClerkProvider`) wires `useAuth().getToken` to the module-level token getter.
- **Sign-in/Sign-up**: Uses Clerk's modal components (`<SignInButton mode="modal">`, `<SignUpButton mode="modal">`) — no redirect-based auth flow
- **Runtime key delivery**: `CLERK_PUBLISHABLE_KEY` is served at runtime via `GET /api/config` (not baked at Vite build time) to ensure production deployments always use the correct environment-specific key. The build script sets `VITE_CLERK_PUBLISHABLE_KEY="__RUNTIME__"` as a sentinel; `App.tsx` detects this and fetches the key from the server.
- **Environment variables**: Clerk keys are resolved per-environment in `server/index.ts`: in production (`NODE_ENV=production`), uses `CLERK_PROD_PUBLISHABLE_KEY` and `CLERK_PROD_SECRET_KEY` secrets; in development, hardcoded `pk_test_`/`sk_test_` dev keys override any global secrets
- **Prompt-first flow**: Unauthenticated users can type a prompt; on submit, prompt/models/chairman are saved to localStorage, Clerk sign-in modal opens, and after login the prompt auto-submits via `PendingPromptHandler`

### Security
- **Rate limiting** (`express-rate-limit`):
  - General API: 100 requests per 15 minutes per IP (applied to all `/api/` routes in `server/index.ts`)
  - Conversation creation/messages: 10 requests per minute per IP
  - Stripe checkout: 10 requests per minute per IP
- **Ownership checks**: All conversation endpoints verify `conv.userId === getUserId(req)` to prevent IDOR attacks (get, cancel, retry, status, addMessage)
- **Authenticated uploads**: `POST /api/uploads/request-url` requires `isAuthenticated`
- **Object download**: `GET /objects/:path` is intentionally public (UUID-based paths are unguessable; auth would break embedded image rendering in chat)
- **Legacy routes removed**: `/api/queries` endpoints deleted (were unauthenticated)

### Credits & Payments
- **Stripe integration**: Connected via `stripe-replit-sync` for automatic data syncing; checkout endpoint has Stripe API fallback if local DB sync tables are empty
- **Reserve-then-settle billing**: Both new conversations and follow-ups use a reserve-then-settle flow. On submit, `reserveAmount = ceil(estimatedCost * 1.05)` is deducted (5% reserve buffer). On completion, the actual cost is settled and any excess is refunded. Tracked via `reservedCredits` and `settled` columns on conversations table.
- **Per-call topology pricing**: Credit cost is computed via `estimateDebateCost()` which models each of the 7 pipeline calls individually: Stage 1 (3 council calls, 2500 output cap), Stage 2 (3 cross-exam calls, 2048 output cap), Stage 3 (chairman verdict, 3500 output cap). Uses UTIL=0.75 factor. Credits derived via `computeCreditCharge()` with 55% target margin, 8% failure buffer, min 3 credits, and UX-friendly rounding via `niceRound()`.
- **Reasoning model multipliers**: Models with `isReasoningModel: true` in `ModelConfig` carry a `reasoningTokenMultiplier` applied to output token costs: o1=3.0, o3=3.5, DeepSeek R1=2.5, all others=1.0.
- **Actual API cost tracking**: Each debate logs actual token usage (prompt_tokens, completion_tokens) from OpenRouter responses. Summed API cost stored in `conversations.actual_api_cost` column for margin analysis. Does not affect user charges.
- **No per-debate tier caps**: Users can spend credits freely as long as they have sufficient balance. `TIER_CAPS` constant and `TIER_CAP_EXCEEDED` enforcement removed.
- **Conversation summarization**: After turn 3 (4+ messages), a GPT-4o-mini summary is generated and stored in `conversations.contextSummary`. Subsequent follow-ups use the summary instead of raw history, keeping costs manageable.
- **Document context caps**: `MAX_TOTAL_CONTEXT = 200000` chars across all uploaded documents (distributed evenly per file). `MAX_TOTAL_RENDERED_IMAGES = 15` for scanned PDFs. Both in `processCouncilMessage()` in `server/routes.ts`.
- **Free tier**: 24 free credits on signup (3 debates at default council cost), locked to default "Starter Council" models
- **Credit packs** (one-time purchases, tiered per-credit pricing):
  - Explorer: 100 credits / $15.00 ($0.15/cr) — "Around 12-25 debates depending on models chosen. Great for trying AI Council."
  - Strategist: 325 credits / $39.00 ($0.12/cr, 20% savings) — "Around 40-80 debates depending on models chosen. For regular use." (Most Popular)
  - Visionary: 900 credits / $89.00 (~$0.099/cr, 34% savings) — "Around 110-225 debates depending on models chosen. For power users and teams." (Best Value)
- **Credit expiration**: Soft 60-day expiry from purchase date. 30-day warning email sent via Resend. On expiry, credits are zeroed and logged as a deduction. Purchasing new credits resets the timer.
- **Credit refund on failure/cancel**: When a council deliberation fails due to AI errors or timeouts, the deducted credits are automatically refunded via `storage.refundDebateCredits()`. User-initiated cancellations also trigger a full refund of reserved credits. Refunds are logged as "refund" type credit transactions. Retries don't deduct credits so no refund is needed.
  - Schema: `credits_purchased_at` (timestamp) and `credits_expiry_warned` (boolean) on users table
  - Cron: `server/cron.ts` runs daily check via setInterval (24h), started in `server/index.ts` after server listen
  - Emails: `server/email.ts` uses Resend connector integration for warning and expiry notification emails
- **Dynamic credit cost**: Credits = max(1, ceil(totalApiCost / $0.05)) — COST_PER_CREDIT=$0.05 is the API cost per credit. Budget debates = 1 credit, default council = ~7 credits, premium mixes scale proportionally
- **Model pricing**: Each model has `apiCostInput`/`apiCostOutput` ($/M tokens) from OpenRouter; `COST_PER_CREDIT = 0.05` in `shared/models.ts` is the API cost threshold per credit
- **Model access**: Users who have purchased credits get full model customization
- **Credits page**: Dedicated `/credits` route (full page) replaces the old PricingModal popup; shows package selection (radio cards), order summary, promo code input, and Stripe pay button
- **Paywall**: When credits are insufficient or models are locked, user is navigated to `/credits` page
- **Stripe routes**: `/api/stripe/webhook`, `/api/stripe/create-checkout` (accepts `packSize`), `/api/stripe/create-portal`, `/api/stripe/sync-credits`, `/api/stripe/cancel-subscription`, `/api/stripe/payment-method` (GET, returns card info), `/api/stripe/invoices` (GET, returns charges/receipts), `/api/stripe/setup-payment` (POST, creates setup session for card update)
- **Checkout flow**: User → /credits page → select pack → Stripe Checkout (mode: payment) → redirect with `?checkout=success&credits=X` → sync credits
- **Refgrow affiliate program**: Tracking script loads on every page via `client/index.html`. Referral ID (`window.tolt_referral`) is passed as `client_reference_id` in Stripe checkout sessions. Authenticated users access the affiliate dashboard at `/affiliate` (embeds Refgrow widget with user's email). Sidebar has "Affiliate Program" link.

### Database Schema
- **users**: Auth users with `deliberationCount`, `debateCredits` (default 18), `subscriptionStatus`, `stripeCustomerId`, `stripeSubscriptionId`, `monthlyDebatesUsed`, `monthlyResetAt`, `creditsPurchasedAt`, `creditsExpiryWarned`, `totalApiCost` (numeric, cumulative API cost in dollars), `totalRevenue` (numeric, cumulative Stripe payments in dollars)
- **platform_analytics**: Daily snapshot table for platform-wide metrics (total API cost, tokens, credits charged, revenue, debate count, active users). Created via migration but populated on-demand via admin endpoint.
- **sessions**: Legacy table (no longer used — Clerk handles sessions)
- **conversations**: Stores chat sessions with title, status, optional custom model selection (models array), chairmanModel, and userId (scoped to user)
- **messages**: Individual messages within conversations (user or chairman role), can include file attachments
- **councilResponses**: AI model responses linked to messages, with stage tracking (initial, review, final)
- **credit_transactions**: Audit log for all credit changes — columns: `id`, `userId`, `type` (purchase/deduction/recovery/manual/refund), `amount` (+/-), `balanceAfter`, `description`, `stripeSessionId`, `conversationId`, `createdAt`. Has a BEFORE INSERT trigger (`trg_sync_credits`) that auto-updates `users.debate_credits` for non-deduction types. Deductions skip the trigger (handled atomically in routes). Manual credit adjustments: just INSERT a row with type='manual' and the user's balance updates automatically. Unique index on `stripe_session_id` prevents double-crediting. Table + trigger created on startup via `runAppMigrations()` in `server/index.ts`.
- **stripe.*** tables: Managed by `stripe-replit-sync` for products, prices, customers, subscriptions
- Legacy tables (queries, responses) exist for backward compatibility

### Model Configuration
- **shared/models.ts**: Central configuration for 37 available models with OpenRouter IDs, display names, specialties, cost tiers, and vision capabilities
- Vision-capable models (GPT-4o, Claude variants, Gemini) can analyze uploaded images
- Text-only models receive a note about attached images that vision models will describe

### Deliberation Prompt Design
- **Epistemic stances (Stage 1)**: Instead of generic "AI Council member" prompts, each of the 3 council models is assigned a distinct epistemic stance: First Principles Analyst (deconstructs assumptions), Pragmatic Implementer (focuses on real-world applicability), Evidence Auditor (audits factual claims, flags hallucination risk, checks evidence quality). Each response must include: thesis, assumptions, strongest alternative, failure modes, and confidence level. Stances are assigned round-robin by model index and inherited by fallback substitutions.
- **Structured cross-examination (Stage 2)**: Reviews follow a mandatory 4-part rubric: (1) strongest disagreement — quote and challenge a specific claim, (2) factual audit — flag claims that may be incorrect, unverifiable, or outdated, (3) weakest shared assumption — what all responses take for granted that may be wrong, (4) forced endorsement — endorse the best peer response and explain what it still gets wrong. System prompt enforces at least one substantive disagreement and factual audit responsibility.
- **Anti-averaging chairman (Stage 3)**: Chairman must choose a side, not average opinions. Exception: for design/optimization problems with multiple legitimate constraints, may construct a composite answer identifying which constraint came from which member. Required output structure: decision & rationale, dissent notes, conditions for reversal (including evidence gaps), confidence (with calibrated operational meaning), actionable implication. System prompt explicitly says "NEVER average or blend opinions."
- **Dynamic review truncation**: Review context scales with Stage 1 response length (3K–6K chars). Truncation preserves opening thesis + closing conclusions (middle truncation) rather than just cutting from the end.
- **Structured follow-up context**: Follow-up messages use XML-tagged context (`<previous_deliberation_summary>`, `<user_followup>`, `<instruction>`) instead of raw text prepend. Summary compression uses structured schema: `<decisions>`, `<contested_points>`, `<caveats>`, `<open_questions>`.
- **Chairman markdown**: Chairman verdicts use full markdown (headers, bold, bullets, code blocks, tables, blockquotes, horizontal rules). Both `VerdictText` (Chat.tsx) and `StyledVerdictText` (ChairmanCard.tsx) use a shared renderer from `client/src/lib/markdown-renderer.tsx` with theme-specific styling (light/dark). The shared renderer handles optional leading/trailing pipes in tables and spaced horizontal rule variants (`- - -`).

### Performance Optimizations
- **Progressive reviews**: Models start reviewing peers as soon as at least 1 other model has responded, instead of waiting for all models to finish first
- **Reduced token limits**: Initial responses capped at 4096 tokens, reviews at 2048 tokens, chairman at 4096 tokens (prevents massive walls of text)
- **0-chunk streaming fallback**: If streaming returns 0 chunks for any model (e.g., GPT-5.4 Pro), automatically retries with non-streaming mode
- **Reasoning token capture**: Stream handler captures `delta.reasoning_content` and `delta.reasoning` for thinking models

### UX Polish Features
- **Dynamic page titles**: Each route sets a contextual browser tab title (Home: branded tagline, Chat: conversation title, 404: "Page Not Found")
- **Copy-to-clipboard**: Verdict responses (ChairmanCard and ChatMessage) have a copy button with checkmark feedback
- **File upload validation**: 10MB size limit and file type checks with branded error messages before upload starts
- **Document content extraction**: Uploaded documents (PDF, DOCX, TXT, CSV, MD, JSON) have their text content extracted server-side via `server/documentParser.ts` (uses `pdf-parse` for PDFs, `mammoth` for DOCX, direct read for text files) and injected into AI prompts so models can analyze document contents. Per-file text capped at 200K chars; global context budget is 200K chars distributed evenly across files. Falls back to filename+URL reference if extraction fails. Visual-only PDFs (artwork, scanned docs) with no extractable text are rendered as images via `pdftoppm` (up to 3 pages, max 15 total) and sent to vision-capable models. Document context is also capped based on the smallest model context window (75% of window) to prevent overflow.
- **File upload limits**: Max 30 files per debate, 10MB per file. Files upload in parallel batches of 5 for speed. Uploaded files are automatically cleaned up after debate completion (UUID-pattern validation prevents accidental deletion).
- **Model context windows**: Each model has a `contextWindow` field in `shared/models.ts`. Document context is automatically truncated to fit within 75% of the smallest council model's context window.
- **Elapsed time display**: During deliberation, shows live elapsed seconds with "usually 30–90 seconds" hint
- **Stage-aware progress messages**: During processing, the UI shows stage-specific messages (hearing: "Your council members are independently analyzing..."; review: "Cross-examination in progress..."; verdict: "The Chairman is weighing all perspectives...") that rotate every 7 seconds, replacing the old generic "Did You Know" facts
- **Cycling status text**: Model cards show contextual rotating text per stage (hearing: "Analyzing…" → "Drafting…"; review: "Reading peer answers…" → "Writing critique…")
- **Branded error messages**: All backend/frontend errors use user-friendly copy instead of raw technical messages
- **Model chip tooltips**: "Click to change this council member" / "Click to change the lead model" on model/chairman chips; cost tier tooltips "Relative API cost: $ = budget, $$$$ = premium"
- **Profile page**: Read-only display of user info (from Clerk Auth), real Stripe payment method display, real billing history from Stripe charges/invoices with download links, in-app payment method update via Stripe setup sessions

### Key Design Decisions
- **Multi-model consensus**: Rather than relying on a single AI model, the system aggregates responses from multiple models to provide more balanced answers
- **Conversation-based architecture**: Supports multi-turn conversations where context is preserved across messages
- **Polling for real-time updates**: Client polls every 1.5-2 seconds when processing is ongoing, rather than using WebSockets
- **Shared schema**: TypeScript types are shared between client and server via the `shared/` directory
- **SIGHUP handler**: `server/index.ts` ignores SIGHUP signals to prevent the Replit workflow runner from killing the process during normal operation
- **Vite error logger**: `server/vite.ts` has a `process.exit(1)` in the custom Vite error logger — do not remove the SIGHUP handler or the server will crash

### LLM Streaming & Timeout Design
- **All LLM calls use streaming** via `streamLLMResponse()` helper, which uses the OpenAI SDK's `stream: true` option and accumulates chunks into a full response string.
- **Inactivity-based timeout**: Instead of a fixed wall timeout, a 5-minute inactivity timer resets each time a token chunk is received. This prevents false timeouts on slow-generating models like Opus (which can produce 20K+ character responses) while still catching truly stuck requests.
- **Vision fallback**: If a vision request fails, the system retries as text-only using a fresh streaming connection.
- **User cancel vs timeout**: Only `signal?.aborted` (user cancellation) throws "Request cancelled". Inactivity timeouts throw "Request timed out" and are treated as model failures, not cancellations.
- **Council resilience**: When a single model times out or fails, the council continues with the remaining successful models. Only explicit user cancellation (`signal.aborted`) stops the entire deliberation.

### LLM Reliability & Fault Tolerance
- **Automatic retry with exponential backoff**: Both `callLLM` and `callLLMWithVision` retry up to 3 times with exponential backoff (2s, 4s, 8s) on retryable errors (provider errors, timeouts, 503s, rate limits). Non-retryable errors (content filters, 401 auth) fail immediately. Constants: `LLM_MAX_RETRIES=3`, `LLM_RETRY_BASE_DELAY_MS=2000`.
- **Fallback model substitution**: If a model exhausts all retries, the system tries up to 2 fallback models from different providers (defined in `MODEL_FALLBACKS` in `shared/models.ts`). Fallbacks skip models already in the council or already failed. Substituted responses are tagged with `substitutedFor` in the database.
- **Cancel refund**: When a user cancels a debate, reserved credits are fully refunded (previously credits were lost on cancel).
- **Graceful shutdown**: On `SIGTERM`/`SIGINT`, the server stops accepting new connections but waits up to 30 seconds for in-flight debates to complete. After timeout, remaining processing conversations are marked as "error".
- **Startup recovery**: On server boot (after migrations), all conversations stuck in "processing" status are reset to "error" with credits refunded. This handles deployment-interrupted debates. Method: `storage.recoverStuckConversations()`.
- **Smart error UI**: Chat page differentiates error types — 404 shows "Session Not Found", 401/403 shows "Please Sign In Again" with refresh, network/500 shows "Something Went Wrong" with retry button. Conversations in error/cancelled state show the completed partial history with a "Retry This Debate" button.

## External Dependencies

### AI Services
- **OpenRouter**: Primary AI gateway for accessing 20+ language models including:
  - OpenAI: GPT-4o, ChatGPT-4o, GPT-4o Mini, o3, o3-mini
  - Anthropic: Claude Sonnet 4, Claude Sonnet 4.5, Claude 3.5 Sonnet/Haiku
  - xAI: Grok 4, Grok 4 Fast, Grok 3
  - Meta: Llama 4 Maverick, Llama 4 Scout, Llama 3.3 70B
  - Google: Gemini 2.5 Pro, Gemini 2.5 Flash, Gemini 2.5 Flash Lite
  - DeepSeek: DeepSeek R1, DeepSeek V3.1, DeepSeek V3
- Environment variables: `AI_INTEGRATIONS_OPENROUTER_BASE_URL`, `AI_INTEGRATIONS_OPENROUTER_API_KEY`

### Database
- **PostgreSQL**: Primary data store
- Environment variable: `DATABASE_URL`
- Migrations managed via Drizzle Kit (`db:push` command)

### Key npm Packages
- `openai`: OpenAI-compatible client for OpenRouter API
- `drizzle-orm` / `drizzle-zod`: Database ORM with Zod schema integration
- `@tanstack/react-query`: Async state management
- `zod`: Schema validation for API inputs/outputs
- Full shadcn/ui component library (Radix primitives + Tailwind)