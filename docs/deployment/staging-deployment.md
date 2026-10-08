# Staging Deployment Guide — Phase 36

Status date: 2026-10-08. This document prepares LauncherDesk E-Stamping for its **first real staging
deployment**. It does not describe a deployment that has happened — no cloud target, reachable staging
database, or live third-party credentials exist in this environment. Every infrastructure detail below that
is not yet known is written as an explicit `<PLACEHOLDER>` and marked **REQUIRED INPUT** or **BLOCKED**. This
document supersedes nothing in `docs/deployment.md` or `docs/production-readiness.md` — it is the staging-
specific companion to those, written after re-verifying their claims against current source in this phase.

## 1. Architecture

- Monorepo (npm workspaces): `apps/api` (Express/Mongoose REST API) + `apps/web` (Vite/React SPA) +
  `packages/*` (shared validation/config/shared code).
- `apps/api` is a single stateless Node process (`node src/server.js`) that connects to one MongoDB
  database. It has one in-process background job (a `setInterval`-driven modification-window lock sweep) and
  one in-memory rate limiter store — both are single-instance-safe only (see §16, §"Known limitations").
- `apps/web` builds to static assets (`npm run build --workspace=apps/web`) served by any static host/CDN;
  it talks to the API over HTTPS using a build-time-baked `VITE_API_BASE_URL`.
- External dependencies: MongoDB (data), Cloudinary (file storage — production-required, fails closed if
  unconfigured), Razorpay (payments — production-required, fails closed if unconfigured), Brevo (transactional
  email — production-required, fails closed if unconfigured), and a real E-Stamp provider (**not yet
  available — see §19**, the one genuine external blocker).
- No Dockerfile, container orchestration config, CI/CD pipeline, or hosting-provider config (Render/Railway/
  AWS/EC2/Nginx/Cloudflare/PM2) exists in this repository. A local-only `docker-compose.yml` exists purely to
  run a MongoDB container for development — it is not a deployment artifact and must not be treated as one.

```
<STAGING_FRONTEND_DOMAIN> --HTTPS--> apps/web static build (CDN/static host)
                                            |
                                            | VITE_API_BASE_URL (build-time)
                                            v
<STAGING_API_DOMAIN> --HTTPS--> reverse proxy/LB (TLS termination) --> apps/api (Node, PORT)
                                            |
                        +-------------------+-------------------+
                        v                   v                   v
                  MongoDB (Atlas or   Cloudinary (files)   Razorpay / Brevo /
                  equivalent)                              E-Stamp provider (HTTPS APIs)
```

## 2. Prerequisites (REQUIRED INPUT — not available in this environment)

| Item | Status |
|---|---|
| Hosting platform for `apps/api` (container host, VM, PaaS) | **DEPLOYMENT TARGET REQUIRED** — not specified by the project owner; this phase deliberately does not guess or create provider-specific config. |
| Static hosting/CDN for `apps/web` | **DEPLOYMENT TARGET REQUIRED** |
| Managed MongoDB cluster reachable from the API host | **BLOCKED** — no reachable staging/production MongoDB exists in this sandbox. |
| DNS for `<STAGING_API_DOMAIN>` / `<STAGING_FRONTEND_DOMAIN>` | **BLOCKED** — no real domains available. |
| TLS/SSL certificates | **BLOCKED** — depends on the domain + hosting choice above. |
| Reverse proxy / CDN topology (to decide Express `trust proxy` setting) | **REQUIRED INPUT** — see §7. |
| Razorpay live/test API credentials + webhook secret | **BLOCKED** — no confirmed live credentials in this sandbox. |
| Brevo API key + verified sender identity | **BLOCKED** — same. |
| Cloudinary account credentials | **BLOCKED** — same. |
| Real E-Stamp provider specification + credentials | **BLOCKED** — see §19; this is an external-provider dependency, not a code gap. |

None of the above can be filled in from inside this sandbox. The remaining sections assume a human with real
infra access will supply these values when performing the actual deployment.

## 3. Required environment variables

Source of truth: `apps/api/src/config/env.js` (re-read this phase, confirmed unchanged) and `.env.example` at
the repo root. See §13 for the full staging env template. Full categorized table is in the final report (see
the handback to the orchestrating task); the short version:

- **Required in all environments**: `MONGODB_URI`, `JWT_SECRET`, `JWT_REFRESH_SECRET` — `env.js`'s `required()`
  helper throws at startup in `NODE_ENV=production` if any of these three are unset (Phase 34 fail-closed
  fix, re-verified present this phase, unchanged).
- **Required only in production** (fail closed if missing, never silently mocked): `RAZORPAY_KEY_ID` +
  `RAZORPAY_KEY_SECRET` (payments), `BREVO_API_KEY` (email), `CLOUDINARY_CLOUD_NAME` + `CLOUDINARY_API_KEY` +
  `CLOUDINARY_API_SECRET` (file storage), `ESTAMP_PROVIDER` (must not be `mock`/unset).
- **Optional / sensible defaults**: `PORT`, `JWT_ACCESS_EXPIRY`, `JWT_REFRESH_EXPIRY`, `OTP_*`,
  `REQUEST_MODIFY_WINDOW_MINUTES`, `DOCUMENT_MAX_FILE_SIZE_MB`, `BULK_ESTAMP_MAX_ROWS`,
  `BULK_ESTAMP_MAX_FILE_SIZE_MB`, `ESTAMP_PROVIDER_LOW_BALANCE_THRESHOLD`.
- **Development/seed only**: `SEED_MASTER_ADMIN_EMAIL`, `SEED_MASTER_ADMIN_PASSWORD`, `SEED_DEMO_ORG_NAME`,
  `DEV_FIXED_OTP_CODE` (the latter is read but intentionally never honored outside dev — see `otp.service.js`).
- **Frontend build-time**: `VITE_API_BASE_URL` — baked into the static bundle at `npm run build`, not read at
  runtime; must point at the real staging API origin **before** building.

## 4. MongoDB setup

- Use a managed cluster (e.g. MongoDB Atlas or equivalent) with authentication enabled and network access
  restricted to the API host's egress IP(s) — **REQUIRED INPUT**, no cluster exists in this sandbox.
- Mongoose creates declared schema indexes automatically on first connection in this codebase's current
  setup (verified by reading model files under `apps/api/src/models` — index declarations exist on schema
  fields, no separate migration/index-creation script exists). Some managed-cluster configurations disable
  auto-index-creation in production; verify this against your chosen provider before first connect.
- No destructive migration exists. This phase re-confirmed by grepping `apps/api/src` for `dropDatabase`,
  `deleteMany`, and `collection.drop` — **zero matches outside test files**. Startup never destroys data.
- `apps/api/src/scripts/seed.js` (re-read this phase) is **not** auto-run on startup — it is only invoked via
  `npm run seed --workspace=apps/api`, and it refuses to run at all unless `SEED_MASTER_ADMIN_PASSWORD` is
  explicitly set (`process.exit(1)` otherwise). It is additionally idempotent: if a `MASTER_ADMIN` user
  already exists, it skips seeding and disconnects. This makes it safe from accidental re-invocation but it
  must still never be pointed at a production `MONGODB_URI` for routine use — run it once, against staging,
  deliberately, then rotate the seeded password immediately (the seeded account already forces a password
  change on first login).
- No backup/restore automation ships in this repo (infrastructure-layer responsibility) — enable your
  MongoDB host's automated encrypted backups before go-live.

## 5. Backend deployment

- Start command: `npm run start --workspace=apps/api` → `node src/server.js` (confirmed from
  `apps/api/package.json`).
- Set `NODE_ENV=production` for the deployed process — this gates every fail-closed behavior described in §3
  and verified in §18 of the final report (JWT/Mongo secret requirement, Cloudinary/Razorpay/Brevo/E-Stamp
  fail-closed refusal).
- Run under a process manager/orchestrator with restart-on-crash and a health check against `GET /health`
  (see §11) — no process-manager config ships in this repo; choice is left to the real hosting platform
  (**DEPLOYMENT TARGET REQUIRED**).
- TLS must be terminated in front of this process (load balancer/reverse proxy/CDN) — the Express app itself
  does not terminate TLS.

## 6. Frontend deployment

- Build command: `npm run build --workspace=apps/web` (root script alias: `npm run build:web`) → `vite
  build`, output in `apps/web/dist`. Verified this phase: 957 modules transformed, output is `index.html` +
  one CSS + one JS bundle, no source maps emitted.
- `VITE_API_BASE_URL` (verified in `apps/web/src/api/client.js`) must be set to
  `https://<STAGING_API_DOMAIN>/api/v1` **before** running the build — it is compiled into the bundle, not
  read at runtime. The code's own fallback (`http://localhost:5000/api/v1`, used only when the env var is
  unset) must never reach a staging/production build; this is a build-pipeline discipline requirement, not an
  application-code defect, since the fallback only fires in local dev.
- Serve the built static assets from any static host/CDN — no specific provider is assumed or configured by
  this repo.

## 7. CORS configuration / trust proxy

- CORS (`apps/api/src/app.js`, re-read this phase): a single configured origin, `FRONTEND_URL`, with
  `credentials: true` — **never** a wildcard. For staging, set `FRONTEND_URL=https://<STAGING_FRONTEND_DOMAIN>`
  exactly (scheme + host, no trailing slash, no wildcard subdomain).
- **Trust proxy**: Express's `app.set('trust proxy', ...)` is intentionally **not configured** anywhere in
  this codebase (confirmed by grep — no `trust proxy` reference exists). This was a deliberate Phase 34
  decision because the real reverse-proxy/CDN topology was unknown at the time, and it remains correct to
  leave unset here for the same reason. **Action required at real deployment time**: whoever deploys this
  behind a reverse proxy/load balancer/CDN must set `app.set('trust proxy', ...)` to a value matching the real
  topology (e.g. `1` for a single trusted reverse proxy, or a specific CIDR/IP list) — otherwise
  `express-rate-limit` and any IP-based logic will see the proxy's IP instead of the real client IP. Do not
  set this to `true` (trust all proxies) without understanding the spoofing risk it introduces.

## 8. Razorpay configuration

- Variables: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` (checkout/order API credentials), separately
  `RAZORPAY_WEBHOOK_SECRET` (HMAC secret Razorpay signs webhook payloads with — configured in the Razorpay
  Dashboard under Webhooks, distinct from the key secret above).
- Frontend checkout key: the frontend does not hold a separate Razorpay key in this codebase as currently
  written — order creation happens server-side (`POST /api/v1/payments/razorpay/order`,
  `payment.routes.js`), and only the resulting order/checkout parameters are returned to the client. Confirm
  this still matches your integration's checkout flow before go-live.
- Webhook endpoint: `POST /api/v1/payments/webhook` (exact route, read from `payment.routes.js`). It is
  registered **before** the router's `authenticate` middleware (intentionally not behind session auth, since
  Razorpay calls it server-to-server) and is verified against `RAZORPAY_WEBHOOK_SECRET` inside
  `payment.controller.js`'s `razorpayWebhook` handler.
- Raw-body handling: `apps/api/src/app.js` registers `express.json({ limit: "2mb", verify: (req,_res,buf) =>
  { req.rawBody = buf } })` globally, capturing the exact raw bytes alongside the parsed body — required
  because Razorpay's HMAC signature is computed over the raw payload bytes, which re-serializing the parsed
  JSON cannot reliably reproduce. Verified this phase: this mechanism is unchanged and still wired.
- Environment separation: use Razorpay **test mode** credentials for staging, **live mode** credentials only
  for production — never share one Razorpay webhook secret across both environments, and register a separate
  webhook endpoint URL per environment in the Razorpay Dashboard pointing at each environment's own
  `https://<...DOMAIN>/api/v1/payments/webhook`.
- Missing-config behavior: confirmed fail-closed — `services/payment-providers/index.js`'s
  `getPaymentProvider()` throws `PAYMENT_PROVIDER_NOT_CONFIGURED` in production when credentials are absent,
  falling back to `MockPaymentProvider` only outside production.

## 9. Brevo configuration

- Variables: `BREVO_API_KEY` (required for production email), `BREVO_SENDER_EMAIL` / `BREVO_SENDER_NAME`
  (sender identity, has defaults), optional `EMAIL_FROM` / `EMAIL_FROM_NAME` overrides, and `EMAIL_PROVIDER`
  (currently informational only — provider selection is actually driven by whether `BREVO_API_KEY` is set,
  per a comment in `env.js`).
- Missing-config behavior: without `BREVO_API_KEY`, non-production environments fall back to a dev-only mock
  that logs a warning instead of sending mail (OTP codes/reset tokens are never logged in either mode, per
  the logger's redaction list — see §10 of the final report). In production, a missing `BREVO_API_KEY` causes
  email sends to fail closed with a configuration error rather than silently mocking delivery.
- Sender identity (`BREVO_SENDER_EMAIL`) must be a domain/sender verified in the Brevo account before
  staging use, or sends will be rejected by Brevo itself (outside this codebase's control).

## 10. Cloudinary configuration

- Variables: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`.
- Confirmed this phase (re-reading `apps/api/src/services/file.service.js`): Phase 34's fail-closed fix is
  intact — without `CLOUDINARY_CLOUD_NAME`, production throws `FILE_STORAGE_NOT_CONFIGURED`
  (`ApiError.internal`) rather than silently falling back to the dev mock adapter (which would otherwise
  return a `mock-storage.local` placeholder URL as if it were a real, durably-stored document). Non-production
  environments may still use the mock adapter when unconfigured.
- Production file storage does not depend on local ephemeral disk — uploads go to Cloudinary; no alternate
  local-filesystem storage path exists in the production code path (confirmed by reading `file.service.js`
  end to end).

## 11. Webhook configuration (summary — see §8 for Razorpay detail)

- Razorpay: `POST /api/v1/payments/webhook`, HMAC-verified with `RAZORPAY_WEBHOOK_SECRET`, raw-body capture
  already wired (see §8). Must be reachable over HTTPS from Razorpay's infrastructure — i.e. the staging API
  domain must have a valid, non-self-signed TLS certificate before registering the webhook URL in Razorpay's
  dashboard.
- E-Stamp provider webhook: the codebase defines a `verifyWebhookSignature()` method on the provider
  interface (`services/estamp-providers/RealEStampProvider.js`), currently an honest placeholder that throws
  `ESTAMP_PROVIDER_NOT_CONFIGURED` — no real provider webhook route, signature scheme, or endpoint exists yet.
  Do not invent one; see §19.

## 12. Health checks

- `GET /health` (`apps/api/src/app.js`) exists and was re-verified this phase to return only safe
  information: `{ status: "ok"|"degraded", env: NODE_ENV, db: "connected"|"disconnected"|"connecting"|
  "disconnecting"|"unknown" }`. No secrets, env var values beyond `NODE_ENV`, filesystem paths, or stack
  traces are present in the response. `status` degrades to `"degraded"` when Mongoose's connection
  `readyState` is not `1` (connected) — a load balancer/uptime monitor should treat `"degraded"` as unhealthy,
  not just a non-2xx HTTP status (the route always returns HTTP 200; the health signal is in the body).
  No code change was needed here — it already meets the safety bar (Step 5 of this phase's brief).

## 13. Smoke-test checklist (to run against a REAL staging environment — not executable in this sandbox)

1. `GET https://<STAGING_API_DOMAIN>/health` returns `status: "ok"`, `db: "connected"`.
2. Frontend loads at `https://<STAGING_FRONTEND_DOMAIN>` and its network calls target
   `https://<STAGING_API_DOMAIN>/api/v1` (confirm no `localhost` call appears in the browser network tab).
3. Run `npm run seed --workspace=apps/api` once against the staging database with a fresh
   `SEED_MASTER_ADMIN_PASSWORD`; confirm login with the seeded Master Admin succeeds and forces a password
   change.
4. Log in, verify OTP step-up works (confirm a real email is received via Brevo — do not rely on
   `DEV_FIXED_OTP_CODE`, which must be unset in staging).
5. Create a demo organization + user, confirm tenant-isolation: a tenant user cannot see another
   organization's data.
6. Upload a test document; confirm it lands in Cloudinary (not a `mock-storage.local` URL) and the signed
   download URL works and expires.
7. Create a Razorpay test-mode order, complete a test payment, confirm the wallet credits exactly once
   (idempotency) and the webhook delivery shows as succeeded in the Razorpay Dashboard.
8. Attempt an E-Stamp issuance: with `ESTAMP_PROVIDER` unset/`mock` this must be refused outright in
   production (`NODE_ENV=production`) — confirm the refusal, do not expect real issuance (see §19).
9. Confirm error responses in staging do not include a stack trace (set `NODE_ENV=production` and check a
   deliberately-triggered 500 response body).
10. Confirm rate limiting responds with 429 after exceeding the configured threshold on a sensitive endpoint
    (e.g. login).

This checklist has **not** been executed — this sandbox has no reachable staging environment and no browser
automation tool. It is prepared for a human to run once real infrastructure exists.

## 14. Rollback procedure

- **Application/frontend rollback**: keep the previous build artifact (API: previous deployed commit/image;
  frontend: previous `dist/` build or previous CDN deployment) available and redeployable. No deployment
  automation exists in this repo, so rollback is "redeploy the previous artifact" at whatever hosting platform
  is eventually chosen.
- **Database rollback**: **no migration system exists in this codebase** (confirmed — Mongoose does not run
  schema migrations at connect time; no migration framework/directory was found). There is therefore no
  scripted "undo migration" step. Database safety for rollback purposes means: take a point-in-time backup
  immediately before any deploy that changes how data is read/written, and restore from that backup if a
  rollback is needed — never attempt a destructive in-place "undo" against live data.
- **Environment rollback**: keep the previous environment variable set (minus any intentionally-rotated
  secret) recoverable from your secret manager's version history.
- **Secret rotation on rollback**: if a rollback follows a suspected secret compromise, rotate
  `JWT_SECRET`/`JWT_REFRESH_SECRET` (this invalidates all existing sessions/refresh tokens — by design, via
  the `tokenVersion` mechanism), Razorpay/Brevo/Cloudinary credentials, and `SEED_MASTER_ADMIN_PASSWORD` (if
  ever reused) rather than only redeploying old code.
- **Webhook rollback considerations**: if rolling back to a version with a different webhook contract, update
  the Razorpay Dashboard webhook URL/secret accordingly before traffic resumes, and expect any webhook
  deliveries during the rollback window to need manual reconciliation (no automatic replay mechanism exists
  in this codebase).

## 15. Secret rotation

Recommended approach: every secret below is supplied via the deployment platform's own environment/secret
management system (e.g. a cloud provider's secrets manager) at deploy time — **never** hardcoded in source,
never committed, never left in a shared `.env` file on a production host.

| Secret | Rotation trigger |
|---|---|
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | Suspected compromise, or routine periodic rotation. Rotating invalidates all sessions (users must log in again) — by design via `tokenVersion`. |
| `MONGODB_URI` credentials | Suspected compromise, staff offboarding with prior access, routine periodic rotation per your managed-cluster provider's guidance. |
| `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` | Suspected compromise; update both the API's env var and the Razorpay Dashboard side together. |
| `BREVO_API_KEY` | Suspected compromise, or Brevo account access changes. |
| `CLOUDINARY_API_SECRET` | Suspected compromise, or Cloudinary account access changes. |
| `SEED_MASTER_ADMIN_PASSWORD` | Treat as already-potentially-exposed after first use; rotate immediately after first production/staging login (the seeded account already forces a password change). |
| E-Stamp provider credentials | Not applicable yet — no real provider credentials exist (see §19). Rotate per the eventual provider's own guidance once integrated. |

## 16. Logging

- Confirmed this phase (`apps/api/src/utils/logger.js`): a redaction filter (`REDACT_KEYS = ["password",
  "otp", "code", "token", "secret", "signature", "authorization"]`, case-insensitive substring match on log
  metadata keys) replaces matching values with `"[REDACTED]"` before they reach any log sink. This covers
  passwords, OTP codes, JWTs/refresh tokens, Razorpay/Brevo/Cloudinary secrets, and authorization headers by
  construction (the key-name match, not a hardcoded list of specific secret values).
  `MONGODB_URI`/E-Stamp credentials are never logged by any call site found in this codebase (no log call
  references `env.MONGODB_URI`, `env.ESTAMP_API_KEY`, or `env.ESTAMP_API_SECRET`).
  - `errorHandler.js` additionally never includes `err.stack` or `err.details` in the client-facing response
    body when `NODE_ENV=production` (confirmed this phase — see §10 of the final report).
- Ship Winston's output to your log aggregation platform of choice — no specific platform is configured in
  this repo; confirm your platform's own ingestion does not re-introduce unredacted fields from elsewhere in
  the pipeline (e.g. a reverse proxy's own access logs capturing full request bodies).

## 17. Monitoring

No monitoring/alerting integration exists in this repository (no APM agent, no uptime-check config, no
dashboard-as-code). At minimum for staging:
- Point an uptime monitor at `GET /health` and alert on non-`"ok"` `status` or non-2xx HTTP response.
- Monitor Razorpay webhook delivery failures from the Razorpay Dashboard directly (no in-app alerting exists
  for this).
- `ESTAMP_PROVIDER_LOW_BALANCE_THRESHOLD` (optional env var / live `SystemSetting`) drives an internal
  low-balance alert once a real E-Stamp provider's balance API exists — currently dormant since no real
  provider balance endpoint exists yet.

## 18. Known blockers (summary)

See §2 for the full infra prerequisite table. In one line each:
- No deployment target (hosting for API or frontend) has been chosen — **DEPLOYMENT TARGET REQUIRED**, by
  design not guessed in this phase.
- No reachable staging/production MongoDB exists in this sandbox.
- No confirmed live Razorpay/Brevo/Cloudinary credentials exist in this sandbox.
- No real E-Stamp provider integration exists (see §19) — the one genuine **external, non-code** blocker.
- No browser automation tool is available in this sandbox, so the smoke-test checklist (§13) could not be
  executed end-to-end; it is prepared, not run.

## 19. E-Stamp provider dependency

**NOT READY — official provider specification required.** `services/estamp-providers/RealEStampProvider.js`
is an intentional, honest placeholder: every method (`issueEStamp`, `checkStatus`, `verifyWebhookSignature`,
`getBalance`, `getUsage`) throws a clear `ESTAMP_PROVIDER_NOT_CONFIGURED`/`notImplemented` error rather than
fabricating a response. `getEStampProvider()` (`services/estamp-providers/index.js`) refuses outright to use
the mock provider when `NODE_ENV=production`. Based on reading this placeholder interface, the following
information is still required from the eventual real provider before it can be implemented — none of it is
guessed or assumed here:

- Real provider name/vendor and official API base URL (`ESTAMP_API_BASE_URL` is reserved but empty).
- Authentication scheme (API key + secret as currently reserved in env vars assumes a simple scheme; the real
  provider may require OAuth, mutual TLS, or a signing scheme instead — unknown).
- Request/response payload shapes for stamp issuance and status-check calls.
- The provider's status vocabulary (to map onto this application's own E-Stamp request state machine).
- Certificate retrieval mechanism (does the provider return a document inline, a signed download URL, or
  require a separate retrieval call?).
- Webhook signature scheme (`ESTAMP_PROVIDER_WEBHOOK_SECRET` is reserved but its HMAC/signing algorithm is
  unknown) and the webhook payload shape itself.
- Balance/usage API shape and units (`getBalance`/`getUsage` are reserved methods with no known response
  contract).
- Sandbox/test-mode credentials and environment separation conventions (test vs. live), analogous to
  Razorpay's test/live mode split.

This is an external-provider blocker, not a code defect, and this phase did not implement, guess, or stub out
any provider-specific HTTP calls — per explicit instruction.
