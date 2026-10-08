# Render + Cloudflare Pages + MongoDB Atlas Runbook — Phase 41

Status date: 2026-10-08. This is the **platform-specific companion** to
`docs/deployment/staging-deployment.md` (Phase 36), which remains the source of truth for
architecture, the full environment-variable catalogue, CORS/trust-proxy rationale, provider
fail-closed behavior, logging/rollback/secret-rotation policy, and the E-Stamp provider blocker.
This document does not repeat that content — it gives the exact, copy-pasteable settings for the
three specific platforms named in this phase's brief: **Render** (backend), **Cloudflare Pages**
(frontend), **MongoDB Atlas** (database), and **Cloudflare DNS**.

**This document was produced without any real deployment occurring.** No Render service, Cloudflare
Pages project, Atlas cluster, or DNS zone exists yet. Every command/setting below is derived from
reading this repository's actual `package.json` files and source (`apps/api/src/config/env.js`,
`apps/api/src/config/db.js`, `apps/api/src/app.js`, `apps/web/src/api/client.js`) in this session —
nothing here is generic boilerplate copied from Render/Cloudflare's own docs without checking it
against this codebase.

---

## 0. Prerequisites before starting

- A way to get this code onto Render/Cloudflare Pages. Both platforms deploy from a **Git
  repository** (GitHub/GitLab/Bitbucket) by default. **This working copy is not a git repository**
  (`git` was not initialized here — confirmed by the environment this runbook was written in). The
  human running this runbook must first push this exact frozen codebase to a Git remote that Render
  and Cloudflare Pages can connect to, or use each platform's manual/CLI deploy path instead
  (Render: Deploy Hooks + a tarball/image; Cloudflare Pages: `wrangler pages deploy <dist-dir>` with
  a Cloudflare API token). Neither a `wrangler` CLI nor any Render CLI/API token is present in this
  sandbox, so this step could not be performed here.
- Real secrets for every provider below (MongoDB Atlas connection string, fresh JWT secrets,
  Razorpay test-mode keys, Brevo API key, Cloudinary credentials). Per the SECRETS RULE for this
  phase: **none of these exist in this sandbox and none are fabricated here.** Every placeholder
  below is literally `<PLACEHOLDER>` — fill in real values only on the real platform's secret
  storage, never in this repo.

---

## 1. MongoDB Atlas

1. Create a project and a cluster (tier is the human's operational/cost decision — not specified
   here). Enable authentication (on by default in Atlas).
2. **Network access**: restrict Atlas's Network Access list to the specific egress IP(s) of the
   Render service created in §2, **not** `0.0.0.0/0`. Render's outbound IPs are visible on the
   Render service's **Connect** tab once the service exists (static outbound IPs are a paid-plan
   feature on Render — confirm your Render plan includes them; if not, Atlas's IP allowlist must
   either be broadened with compensating controls or you must use Render's "Static Outbound IP"
   add-on). This is a platform-pairing detail that must be confirmed live; it cannot be verified
   from this sandbox.
3. Create a database user with a strong, generated password (not reused from any `.env` in this
   repo) scoped to the application database only.
4. Build the connection string in the shape `apps/api/src/config/db.js` expects: `db.js` calls
   `mongoose.connect(env.MONGODB_URI)` with no extra options object, so any standard Atlas
   `mongodb+srv://` connection string works as-is — e.g.
   `mongodb+srv://<user>:<password>@<cluster-host>/<db-name>?retryWrites=true&w=majority`. This
   becomes the `MONGODB_URI` value set on Render in §4.
5. No migration framework exists in this codebase (confirmed in Phase 36, re-confirmed this phase —
   no migration directory, no `dropDatabase`/destructive calls outside test files). Mongoose creates
   declared schema indexes automatically on first connection; verify your Atlas tier doesn't disable
   auto-index-creation.
6. Enable Atlas's automated encrypted backups before go-live (no in-app backup logic exists in this
   repo — it is purely an infrastructure responsibility).
7. Run the one-time seed script **after** the backend is deployed and connected (see §6), not before.

---

## 2. Render (backend — `apps/api`)

Create a **Web Service** (not a Static Site, not a Background Worker) from the Git repository,
with these exact settings:

| Render setting | Value | Source |
|---|---|---|
| **Root Directory** | `apps/api` | Monorepo layout confirmed via root `package.json` workspaces (`apps/*`, `packages/*`) |
| **Environment** | Node | `apps/api/package.json` has no `engines` field and the repo has no `.nvmrc`/`.node-version` — **the human must explicitly pick a Node version in the Render dashboard** (Node 20 LTS is the safe recommendation; this sandbox's own Node is v24.11.1, which is newer than typical LTS and was not validated as the deployment target — do not assume it without confirming compatibility). |
| **Build Command** | `npm install` (run from `apps/api` with Root Directory set above) — note this is an **npm workspaces monorepo**: Render's root-directory build runs `npm install` which, run from a workspace subfolder, will not correctly resolve the `@launcherdesk/config`, `@launcherdesk/shared`, `@launcherdesk/validation` workspace packages (`"*"` version in `apps/api/package.json`). **The build command must instead run from the monorepo root**: set Root Directory to the repo root and use Build Command `npm install --workspaces` (or `npm ci`) followed by nothing else (no separate backend build step exists — `apps/api` ships source directly, there is no transpile step for the API). |
| **Start Command** | `npm run start --workspace=apps/api` (run from repo root) — confirmed from `apps/api/package.json`: `"start": "node src/server.js"`. If Root Directory is instead set to `apps/api` directly (not recommended per the workspace-resolution note above, unless Render's own npm-workspaces monorepo support — a relatively recent Render feature — is confirmed to handle hoisting correctly for this repo), the Start Command would be plain `npm start` or `node src/server.js`. |
| **Health Check Path** | `/health` | Confirmed in `apps/api/src/app.js`: returns `{ status: "ok"\|"degraded", env, db }`, HTTP 200 always — configure Render's health check to fail on `"degraded"` in the body if Render supports body inspection; otherwise at minimum confirm the endpoint responds, and pair it with Atlas-side connectivity monitoring since `"degraded"` won't surface as a non-2xx. |
| **Port** | No fixed value — the app reads `process.env.PORT` (confirmed: `apps/api/src/config/env.js` → `PORT: parseInt(process.env.PORT || "5000", 10)`, and `server.js` calls `app.listen(env.PORT, ...)`). Render automatically injects its own `PORT` env var at runtime, and **no code change is needed** — this was explicitly checked as the kind of freeze-reopening blocker this phase was told to watch for, and it is not one. |
| **Auto-Deploy** | Human's choice; recommend off or "on push to a protected deploy branch only" for a frozen release candidate. |

### Render-specific `trust proxy` recommendation

Render terminates TLS and proxies all inbound HTTP traffic through its own edge layer, so the
Express app always sees Render's proxy as the immediate peer, not the real client IP — this is
standard for any PaaS behind a managed edge/load balancer. `apps/api/src/app.js` does not currently
call `app.set('trust proxy', ...)` anywhere (confirmed by grep, consistent with the Phase 34/36
finding that this was deliberately left unset pending a known topology).

- **Recommended value for Render specifically: `app.set('trust proxy', 1)`** — trusting exactly one
  hop, matching Render's single reverse-proxy edge in front of the web service. This is the
  commonly-documented configuration for Express apps on single-hop PaaS edges (Render/Heroku-style
  topologies), and is **safe to document as a recommendation** here because it only affects how
  `express-rate-limit` and any `req.ip`-based logic resolve the client IP — it does not touch
  business logic, wallet/payment/tenant-isolation code, or any frozen application behavior.
- **This has not been verified live against a real Render service in this session** — no Render
  account/credential exists in this sandbox to confirm empirically that Render's edge adds exactly
  one `X-Forwarded-For` hop in all configurations (e.g. if a custom CDN is layered in front of Render
  too, the hop count changes). The human deploying this must confirm the actual hop count against
  their real topology (e.g. by logging `req.headers['x-forwarded-for']` temporarily, or consulting
  current Render documentation at deploy time) before relying on rate-limiting/IP-based behavior in
  production.
- Setting this requires a one-line code change (`app.set('trust proxy', 1)` in `apps/api/src/app.js`)
  that was **not made in this phase** — it is deployment-environment configuration, not a code-freeze
  blocker (the app functions correctly without it; only IP-based rate-limiting accuracy is affected),
  so per this phase's freeze policy it is documented here for the human to apply at actual deploy
  time rather than reopening the freeze for it now.

---

## 3. Cloudflare Pages (frontend — `apps/web`)

Create a Cloudflare Pages project connected to the same Git repository:

| Cloudflare Pages setting | Value | Source |
|---|---|---|
| **Root directory** | `apps/web` is where the build runs conceptually, but because this is an **npm workspaces monorepo** (shared packages `@launcherdesk/shared`/`@launcherdesk/validation` at `"*"` versions), set **Root directory to the repository root** so npm can resolve the workspace packages, same reasoning as the Render build above. |
| **Build command** | `npm install --workspaces && npm run build:web` (root script, confirmed in root `package.json`: `"build:web": "npm run build --workspace=apps/web"`, which runs `vite build`). |
| **Build output directory** | `apps/web/dist` — confirmed this phase: a fresh `npm run build:web` run produced exactly `dist/index.html`, `dist/assets/*.css`, `dist/assets/*.js` (one CSS bundle, one JS bundle ~938 kB / 253 kB gzipped, no source maps). |
| **Node version** | Same caveat as Render: no `.nvmrc`/`engines` field exists in this repo. Set Cloudflare Pages' `NODE_VERSION` build environment variable explicitly (e.g. `20`) rather than relying on its default, since none is pinned here. |
| **Environment variable (build-time only)** | `VITE_API_BASE_URL=https://<RENDER_BACKEND_URL>/api/v1` — confirmed in `apps/web/src/api/client.js`: `axios.create({ baseURL: import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api/v1" })`. This is a **Vite build-time** variable, baked into the static bundle — it must be set in Cloudflare Pages' build environment variables **before** the build runs, not supplied at serve time. The `http://localhost:5000` fallback must never reach a staging/production build; confirm this variable is actually set by checking the deployed bundle's network calls target the Render URL, not localhost. |

### Order of operations (URL interdependency)

Render and Cloudflare Pages each need the other's URL, which creates a two-step bootstrap:

1. Deploy the Render backend first (with a placeholder/unset `FRONTEND_URL` is acceptable
   temporarily, since nothing calls it until the frontend exists) and note its assigned
   `https://<service-name>.onrender.com` URL (or custom domain, once DNS in §5 is set up).
2. Set `VITE_API_BASE_URL` in Cloudflare Pages to that Render URL + `/api/v1`, then build/deploy the
   frontend; note the resulting `https://<project-name>.pages.dev` URL (or custom domain).
3. **Go back to Render and set `FRONTEND_URL`** to the exact Cloudflare Pages origin (scheme + host,
   no trailing slash, no wildcard) — confirmed in `apps/api/src/app.js`: `cors({ origin:
   env.FRONTEND_URL, credentials: true })` is a single exact-match origin, never a wildcard. Redeploy
   the Render service for the new `FRONTEND_URL` to take effect (env var changes require a restart).
   Skipping this step means the deployed frontend's API calls will be rejected by CORS.

---

## 4. Environment variables to set on Render (names only — no values)

Source of truth: `apps/api/src/config/env.js`, cross-checked against `.env.staging.example`
(confirmed still accurate this phase).

**Required — fail closed in production if unset:**
`NODE_ENV` (must be `production`), `MONGODB_URI`, `JWT_SECRET`, `JWT_REFRESH_SECRET`

**Required for production functionality — fail closed (not silently mocked) if unset:**
`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `BREVO_API_KEY`,
`CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`

**Required, platform-specific:**
`FRONTEND_URL` (set after Cloudflare Pages URL is known — see §3 ordering above)
`PORT` is **not** set manually — Render injects its own.

**Blocked / must remain `mock` until a real provider exists (do not set otherwise):**
`ESTAMP_PROVIDER` (leave as `mock` or unset — setting anything else does not enable real issuance,
it only changes which "not implemented" error path is hit), `ESTAMP_API_BASE_URL`,
`ESTAMP_API_KEY`, `ESTAMP_API_SECRET`, `ESTAMP_API_TIMEOUT_MS`, `ESTAMP_PROVIDER_WEBHOOK_SECRET`

**Optional, sensible defaults exist (set only to override):**
`JWT_ACCESS_EXPIRY`, `JWT_REFRESH_EXPIRY`, `OTP_EXPIRY_MINUTES`, `OTP_MAX_ATTEMPTS`,
`OTP_RESEND_COOLDOWN_SECONDS`, `OTP_REVERIFY_INTERVAL_HOURS`, `REQUEST_MODIFY_WINDOW_MINUTES`,
`EMAIL_PROVIDER`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`, `EMAIL_FROM`, `EMAIL_FROM_NAME`,
`DOCUMENT_MAX_FILE_SIZE_MB`, `BULK_ESTAMP_MAX_ROWS`, `BULK_ESTAMP_MAX_FILE_SIZE_MB`,
`ESTAMP_PROVIDER_LOW_BALANCE_THRESHOLD`

**Must explicitly be unset in staging/production:**
`DEV_FIXED_OTP_CODE` (dev convenience only — never honored in production code, but keep it unset
for clarity)

**One-time seed script only — not a runtime env var, set only when deliberately running
`npm run seed --workspace=apps/api` against the new Atlas database:**
`SEED_MASTER_ADMIN_EMAIL`, `SEED_MASTER_ADMIN_PASSWORD`, `SEED_DEMO_ORG_NAME`

## Environment variables to set on Cloudflare Pages (names only)

`VITE_API_BASE_URL` (build-time only — see §3) and `NODE_VERSION` (build environment pin).

---

## 5. Cloudflare DNS

Not configured in this sandbox (no domain name exists to point here). When a real domain is
available:

1. Add the domain to Cloudflare (if not already a Cloudflare-managed zone).
2. For the frontend: either use the default `*.pages.dev` subdomain or add a **custom domain** to
   the Cloudflare Pages project (Pages project settings → Custom domains) — Cloudflare manages the
   CNAME/DNS record automatically when the zone is on the same Cloudflare account.
3. For the backend: add a `CNAME` (or Render's recommended record type, confirm against Render's own
   custom-domain instructions at setup time) pointing the API subdomain (e.g. `api.<domain>`) at the
   Render service's provided target hostname. Verify the certificate Render issues/manages for the
   custom domain before registering any webhook URLs (Razorpay) against it — a webhook cannot be
   reliably registered against a domain without a valid TLS certificate.
4. After both custom domains are live, update `FRONTEND_URL` (Render) and `VITE_API_BASE_URL`
   (Cloudflare Pages, rebuild required) to the final custom domains instead of the platform-default
   subdomains, and re-register the Razorpay webhook URL against the final API domain.

---

## 6. Post-deploy sequence (summary)

1. Provision Atlas (§1) → get `MONGODB_URI`.
2. Deploy Render backend (§2) with all required env vars from §4 except `FRONTEND_URL` (temporary).
3. Confirm `GET https://<render-url>/health` returns `{ status: "ok", db: "connected" }`.
4. Deploy Cloudflare Pages frontend (§3) with `VITE_API_BASE_URL` pointed at the Render URL.
5. Set `FRONTEND_URL` on Render to the Cloudflare Pages URL; redeploy/restart Render.
6. Run `npm run seed --workspace=apps/api` once, against the new Atlas database, with a freshly
   generated `SEED_MASTER_ADMIN_PASSWORD` — then rotate that password immediately after first login
   (the seeded account already forces a password change).
7. Register the Razorpay webhook (`POST https://<render-url>/api/v1/payments/webhook`) in the
   Razorpay Dashboard using **test-mode** credentials for staging.
8. Work through the smoke-test checklist in `docs/deployment/staging-deployment.md` §13 against the
   now-real URLs.
9. Apply the `trust proxy` setting discussed in §2 above if IP-based rate-limiting accuracy matters
   for this environment, verifying the real hop count first.

Everything in this section is a **sequence for a human with real credentials to execute** — none of
it was executed in this phase.
