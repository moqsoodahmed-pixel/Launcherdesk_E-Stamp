# Production Readiness — Phase 20 Final QA

Status date: 2026-09-28. This document is the final release-readiness gate for LauncherDesk E-Stamping,
produced at the end of a 20-phase incremental build. It is evidence-based: every claim below was verified by
reading current source and/or running the test suite/build in this repository, not carried forward from
earlier phase reports without re-checking.

## 1. Release status

**Conditionally ready for production**, gated on the items in §5 (secret rotation) and the one genuine
external blocker in §11 (no real E-Stamp provider integration exists). There are **zero P0 defects** found in
this phase's audit — no authentication bypass, no tenant-isolation failure, no secret leakage, and no
payment/wallet integrity failure was found anywhere in the current codebase. Application code itself (auth,
RBAC, tenant isolation, wallet/payment integrity, audit logging, input validation) is in good shape after 19
prior hardening phases and this phase's independent re-verification of all of it.

## 2. What's production-ready

- Authentication (Argon2id passwords, email OTP step-up, JWT access + rotating hashed refresh tokens,
  `tokenVersion` invalidation, pinned `HS256`).
- RBAC + tenant isolation: every `Permission` enum value has at least one real enforcement site (route-level
  `requirePermission` or an equivalent inline controller check); every route accepting a resource `:id` either
  scopes its query by `organizationId`/ownership or is restricted to internal (Master/Assistant Master Admin)
  roles by design. See §7 for the full audit method and result.
- Wallet integrity: atomic `$inc` + balance guard, idempotency-keyed transactions, verified race-safe under
  concurrent credit/debit.
- E-Stamp request lifecycle state machine, 20-minute modification window (server-enforced, not
  client-trusted), bulk upload sharing the exact same creation/modification/cancellation code path as a
  single request (now proven end-to-end through order processing, not just at creation — see §9).
- Document handling: SHA-256 checksums of real bytes, sanitized filenames, private Cloudinary storage,
  5-minute signed download URLs, executable-signature upload denylist.
- Payment integrity: Razorpay signature verified server-side only (both the client-return path and a
  dedicated webhook path), idempotent wallet credit.
- Audit logging: append-only, no update/delete path exists anywhere in the app, actor-typed (`USER`/`SYSTEM`),
  gated by `AUDIT_VIEW`.
- Settings/feature-flag system: registry-validated, permission-gated, four live settings + three feature
  flags actually wired (see §12 for the one known, deliberate exception).
- Rate limiting, bounded pagination, upload size/dimension guards, security headers (`helmet`), NoSQL
  injection stripping (`express-mongo-sanitize`), CORS pinned to a single configured origin (never `*`).
- Frontend production build (`npm run build:web`) succeeds cleanly with no source maps emitted (see §14).

## 3. What's blocked

- Real E-Stamp certificate issuance. `RealEStampProvider` is an honest, unimplemented placeholder (see §11).
- Any claim of ISO 27001 / GDPR / SOC 2 Type II certification — these require external audit/ISMS/operational
  processes this repository cannot provide; see `SECURITY.md`'s "Operational gaps" section (unchanged by this
  phase, still accurate).
- Multi-instance horizontal scaling without additional infrastructure: rate limiting is in-memory/per-process
  (`express-rate-limit`'s default store), and the modification-window lock job runs via `setInterval` in a
  single process — both documented, pre-existing, non-blocking for a single-instance deployment.

## 4. Required environment variables

Source: `.env.example` and `apps/api/src/config/env.js` (the single source of truth — every variable below is
actually read there). No secret values are reproduced anywhere in this document.

| Variable | Classification | Notes |
|---|---|---|
| `NODE_ENV` | REQUIRED | Must be `production` in production — gates several fail-closed behaviors below. |
| `PORT` | OPTIONAL | Defaults to 5000. |
| `FRONTEND_URL` | REQUIRED | Sole allowed CORS origin — must be the exact production frontend origin. |
| `MONGODB_URI` | REQUIRED | No default is safe in production; `env.js` only falls back to `localhost` in non-production. |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | REQUIRED, PRODUCTION-SENSITIVE | `env.js` throws at startup in production if either is missing. Must be high-entropy and unique per environment; never reused across environments. |
| `JWT_ACCESS_EXPIRY` / `JWT_REFRESH_EXPIRY` | OPTIONAL | Sensible defaults (`15m` / `7d`). |
| `OTP_*` (4 vars) | OPTIONAL | OTP expiry/attempts/cooldown/reverify interval; sensible defaults. |
| `REQUEST_MODIFY_WINDOW_MINUTES` | OPTIONAL | Now also a live-adjustable `SystemSetting` (Phase 17); the env value is only the bootstrap default. |
| `EMAIL_PROVIDER` | OPTIONAL | Informational; actual selection is driven by whether `BREVO_API_KEY` is set. |
| `BREVO_API_KEY` | REQUIRED FOR PRODUCTION EMAIL | Missing in production fails email sends closed with a clear error, not a silent mock. |
| `BREVO_SENDER_EMAIL` / `BREVO_SENDER_NAME` / `EMAIL_FROM` / `EMAIL_FROM_NAME` | OPTIONAL | Sender identity; has defaults. |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` | REQUIRED FOR PRODUCTION PAYMENTS | Missing in production fails payment endpoints closed, never falls back to the mock provider. |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | REQUIRED FOR PRODUCTION DOCUMENT STORAGE | Governs private storage + signed URLs. |
| `DOCUMENT_MAX_FILE_SIZE_MB` | OPTIONAL | Single source of truth for both `FileService` and its multer limit. Default 10. |
| `ESTAMP_PROVIDER` | REQUIRED FOR PRODUCTION E-STAMP ISSUANCE | Must NOT be `mock`/unset in production — `getEStampProvider()` throws outright if it is. No real provider is implemented yet (see §11); this variable cannot honestly be set to anything that works in production today. |
| `ESTAMP_API_BASE_URL` / `ESTAMP_API_KEY` / `ESTAMP_API_SECRET` / `ESTAMP_API_TIMEOUT_MS` / `ESTAMP_PROVIDER_WEBHOOK_SECRET` | RESERVED FOR REAL PROVIDER | Read by `RealEStampProvider`'s intended future implementation; currently unused because that class is a placeholder. |
| `ESTAMP_PROVIDER_LOW_BALANCE_THRESHOLD` | OPTIONAL | Also a live `SystemSetting`; unset disables the alert. |
| `BULK_ESTAMP_MAX_ROWS` / `BULK_ESTAMP_MAX_FILE_SIZE_MB` | OPTIONAL (env-only, see §12) | Registered in the Settings API but NOT yet read live from it by the enforcement code — see the known-gap note in §12. |
| `SEED_MASTER_ADMIN_EMAIL` / `SEED_MASTER_ADMIN_PASSWORD` / `SEED_DEMO_ORG_NAME` | DEVELOPMENT/SEED ONLY | `SEED_MASTER_ADMIN_PASSWORD` gates whether `seed.js` will run at all; never set this to a real production credential value you intend to keep using — rotate immediately after first login (the account already forces a password change). |
| `VITE_API_BASE_URL` | REQUIRED (frontend build-time) | Baked into the built frontend bundle at `build:web` time; must point at the real production API origin before building for deployment. |

## 5. Secret rotation checklist

**Rotation is required before this codebase is used against a shared or production environment.** The
developer's local `apps/api/.env` (gitignored, never committed — confirmed `.gitignore` covers `.env` at any
depth) currently contains what are, by inspection of length/entropy alone (values were not read or printed),
real, strong 64-character `JWT_SECRET`/`JWT_REFRESH_SECRET` values and a 20-character
`SEED_MASTER_ADMIN_PASSWORD` — exactly the situation Phase 19 previously flagged, and unchanged as of this
phase. No Razorpay/Cloudinary/Brevo/E-Stamp credentials are currently populated in that file.

Before any shared/production deployment:
- [ ] Generate fresh `JWT_SECRET` / `JWT_REFRESH_SECRET` values for the production environment specifically —
      never reuse a value that has ever existed in a developer's local `.env`.
- [ ] Generate a fresh `SEED_MASTER_ADMIN_PASSWORD` for the production seed run only, and rotate it again
      immediately after the first production login (the account already forces a password change on first
      login, but the seed-time value itself should still be treated as already-potentially-exposed).
- [ ] Obtain and set real `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET`/`RAZORPAY_WEBHOOK_SECRET`,
      `CLOUDINARY_*`, and `BREVO_API_KEY` values through your platform's secret manager, never committed to
      source control or left in a shared `.env` file.
- [ ] Do not set `ESTAMP_PROVIDER` to anything other than `mock` until a real provider is actually
      implemented (see §11) — setting it prematurely would not issue real certificates, it would just throw.
- [ ] Store every production secret in a proper secrets manager (AWS Secrets Manager, HashiCorp Vault, or
      equivalent), not a `.env` file on a production host.

## 6. Database checklist

- [ ] Use a managed MongoDB cluster (Atlas or equivalent) with authentication enabled and network access
      restricted to the API's egress IPs — this application trusts whatever `MONGODB_URI` points at and
      performs no network-layer filtering of its own.
- [ ] Enable TLS-in-transit to the database (infrastructure-layer, not application-layer).
- [ ] Confirm the indexes documented in `docs/database.md` exist (Mongoose creates them automatically on
      first connection in this codebase's current setup; verify this behavior against your chosen deployment
      process, since some managed-cluster configurations disable auto-index-creation in production for
      safety).
- [ ] Enable automated, encrypted backups (see §8) — MongoDB backup/restore infrastructure is not part of
      this repository (no backup scripts or cron jobs ship here) and must be provisioned at the
      infrastructure/platform layer.

## 7. Authorization / tenant-isolation audit summary

Method: every `Permission` value declared in `packages/shared/src/permissions.js` (30 total) was
cross-referenced against every `requirePermission(...)` call site across all 17 `routes/v1/*.routes.js`
files, plus every inline `req.user.permissions.includes(...)` check in the controllers. Result: **zero
orphaned permissions** — every declared permission has at least one real enforcement site. This is the
specific bug class (a permission enum exists but no route ever checks it) that recurred at Phase 15
(`AUDIT_VIEW`) and Phase 17 (`SETTINGS_VIEW`/`SETTINGS_MANAGE`); it did not recur a third time. Two
permissions (`REPORT_FINANCIAL_VIEW`, `REPORT_GLOBAL_VIEW`) are deliberately enforced inline inside
`report.controller.js` rather than via route-level `requirePermission` (documented in `report.routes.js` —
`requirePermission` only supports a single permission per route, an AND not an OR, so a second/alternate gate
on the same route has to live in the controller). `notification.routes.js` has no dedicated permission gate
beyond `authenticate` — by design, since every query in `notification.controller.js` is unconditionally
scoped to `recipientId: req.user.id` (a user's own notifications), so there is no cross-tenant/cross-user
surface for a permission to gate in the first place.

Every route accepting an `:id`-shaped param was checked for how its underlying query is scoped:
- `order.controller.js`, `payment.controller.js`: `findById` followed immediately by an
  `isInternalActor(req) || doc.organizationId === req.user.organizationId` check, returning an identical 404
  for "doesn't exist" and "exists in another org" (no existence-probing side channel).
- `user.controller.js`: a shared `findScopedUser` helper enforces the same pattern for every user-targeting
  route.
- `bulk-estamp.controller.js`, `audit.controller.js`, `wallet.controller.js`: organizationId is resolved
  through a `resolveOrgId`/`resolveScope` helper that trusts only `req.user.organizationId` for tenant actors
  and an explicit, permission-gated override for internal actors — never a raw, unchecked client-supplied
  value.
- `organization.controller.js`: `Organization` documents themselves have no further "which org" scoping
  question to ask (they *are* the org) — access to this controller is restricted at the permission layer to
  `CLIENT_VIEW`/`CLIENT_MANAGE`, held only by Master Admin (always) and Assistant Master Admin (only if
  explicitly granted), never by any tenant role.
- `article.controller.js`: `Article`/`ArticleVersion` are platform-wide reference data, not tenant-owned, so
  no per-organization scoping applies by design — access is gated by `ARTICLE_VIEW`/`ARTICLE_MANAGE` only.

No new authorization or tenant-isolation defect was found. This audit built on, cross-referenced, and did not
have to re-derive Phase 19's existing route×permission×scope matrix (`apps/api/tests/security-hardening.test.js`).

## 8. Backup checklist

No backup automation exists in this repository (correctly — that is an infrastructure/platform-layer
responsibility, not an application-code one, and this repo ships no Dockerfile/CI/hosting config to place it
in). Before production:
- [ ] Enable your MongoDB host's automated, encrypted backup feature (e.g. Atlas continuous backups).
- [ ] Define and test a restore procedure, including restoring into a scratch environment and running
      `npm run test:api` against it as a sanity check that a restored database is structurally usable.
- [ ] Define a backup retention policy consistent with your data-retention obligations (see `SECURITY.md`'s
      operational-gaps list — a formal retention/deletion schedule is explicitly still an open item).

## 9. Deployment checklist

- [ ] Follow `docs/deployment.md` in full (TLS termination, environment variables via secret manager, CORS
      origin, rate-limiting store choice at scale, background-job singleton concerns at scale, log shipping,
      Cloudinary signed-URL review, process management, health checks, and — added this phase — the
      `ESTAMP_PROVIDER` production gate).
- [ ] Build the frontend with `VITE_API_BASE_URL` already pointed at the real production API origin (it is
      baked in at build time, not read at runtime) before running `npm run build:web`.
- [ ] Confirm `NODE_ENV=production` is set for the API process — several fail-closed behaviors (JWT secret
      requirement, mock-provider refusal, mock-payment refusal, mock-email failure) are gated on this value.

## 10. Rollback checklist

No deployment automation exists in this repository, so there is no scripted rollback mechanism to describe
here beyond ordinary practice: keep the previous build artifact/container image available, keep a
point-in-time database backup taken immediately before any migration-bearing deploy, and confirm the previous
version's `.env`/secret values remain valid (this app has no destructive, irreversible migration step baked
into its startup path — Mongoose does not run schema migrations at connect time in this codebase).

## 11. External dependencies / blockers

- **Real E-Stamp provider (EXTERNAL BLOCKER)**: confirmed again this phase — no provider API specification,
  Postman/Swagger/OpenAPI file, or vendor documentation exists anywhere in this repository (re-confirmed by a
  fresh repo-wide search, matching Phase 18's finding). `RealEStampProvider`
  (`apps/api/src/services/estamp-providers/RealEStampProvider.js`) fails loudly and honestly on every method
  rather than fabricating a response, and `getEStampProvider()`
  (`apps/api/src/services/estamp-providers/index.js`) refuses to silently fall back to the mock provider in
  `NODE_ENV=production`. This is not a code defect — it is a genuine external dependency this project cannot
  resolve without the real provider's specification and credentials. **This remains exactly as-is; it was not
  touched this phase**, per this phase's explicit instruction not to invent a real E-Stamp provider.
- **Secret rotation (pre-deployment checklist item, not a code defect)**: see §5.
- **Brevo / Razorpay / Cloudinary**: all three have a documented, honest mock/fail-closed distinction already
  in place (dev-only mock when unconfigured in non-production; fails closed, never silently mocks, in
  production). No code change needed; only real credentials need to be supplied before production use.

## 12. Known limitations

- **Bulk-settings live-wiring gap (P2, documented, non-blocking)**: `BULK_ESTAMP_MAX_ROWS` and
  `BULK_ESTAMP_MAX_FILE_SIZE_MB` are registered, validated, and admin-manageable through the Settings API
  (`apps/api/src/config/settingsRegistry.js`), but `bulk-estamp.service.js` (row-count check) and
  `bulk-estamp.routes.js` (multer's file-size limit, set once at module load) still read the static
  `env.BULK_ESTAMP_MAX_ROWS`/`env.BULK_ESTAMP_MAX_FILE_SIZE_MB` directly rather than the live,
  admin-adjustable `SystemSetting` value. **Re-confirmed unchanged this phase** by directly reading both
  files (see `apps/api/src/services/bulk-estamp.service.js:176,232` and
  `apps/api/src/routes/v1/bulk-estamp.routes.js:50`). This was identified and deliberately left as-is at
  Phases 17 and 19; per this phase's explicit instruction, it is again documented rather than silently fixed
  — the static env default is still safely enforced today (uploads are never unbounded), only an admin's live
  override currently has no effect on these two specific keys. Wiring it correctly would need multer's
  request-time size limit to be read dynamically (it is normally fixed at router-construction time) as well
  as the service's row-count check switching to `SettingsService.getSetting(...)` — a real, non-trivial change
  this phase deliberately did not make unprompted.
- **Real E-Stamp provider dependency**: see §11.
- **In-memory, per-process rate limiting**: correct for a single-instance deployment; would need a shared
  store (e.g. Redis-backed) if horizontally scaled — documented in `SECURITY.md`, unchanged this phase.
- **Modification-window lock job runs via `setInterval` in-process**: same single-instance caveat as above;
  documented in `docs/deployment.md`.
- **Minor documentation drift (non-blocking, noted for completeness)**: `docs/architecture.md` and
  `docs/database.md` still reference `.ts` file extensions in a few places (e.g. `wallet.service.ts`,
  `authorize.ts`); the actual codebase is plain CommonJS `.js` (per this project's established convention —
  `"use strict"` + `Object.defineProperty(exports, ...)` boilerplate throughout `apps/api/src`). This is a
  cosmetic documentation inaccuracy carried over from early phases, not a functional issue; left as-is this
  phase to avoid unrequested, low-value doc churn across files this phase's audit did not otherwise need to
  touch.

## 13. Final QA results

- **Test suite**: `npm run test:api` — **28 test files, 580 tests, all passing**, 0 failed, 0 skipped. This is
  the pre-existing baseline of 26 files / 578 tests plus 2 new Phase 20 tests
  (`tests/e2e-full-lifecycle.test.js`, `tests/bulk-estamp-order-continuation.test.js`) — no existing test was
  weakened, skipped, or deleted.
- **Web build**: `npm run build:web` — succeeds cleanly (`vite build`, 934 modules transformed, ~5-7s). One
  informational (non-error) warning about a >500KB JS chunk, a code-splitting suggestion, not a defect; no
  source maps are emitted (verified by inspecting `apps/web/dist/` directly — only `index.html`, one `.css`,
  one `.js`), so there is no source-map secret-exposure risk to review further.
- **`npm audit`**: 8 advisories, unchanged in count and identity from Phase 19 — `@vitest/mocker`/`esbuild`/
  `vite`/`vite-node` (dev-only test/build tooling, never shipped or reachable at runtime) and `react-router`/
  `uuid` (runtime deps, both requiring a breaking major-version bump; the flagged `react-router` CVEs concern
  `<Link>`/`useNavigate` open-redirect and SSR hydration deserialization, neither of which this app's
  client-side-only routing usage exercises; `uuid`'s advisory concerns a buffer-bounds edge case in
  `v3`/`v5`/`v6` generation with a caller-supplied buffer, a code path this app's `uuid.v4()` usage never
  takes). All 8 remain deferred with the same justification as Phase 19: no currently-reachable exploit path,
  fix requires an unrequested breaking upgrade.
- **Security regression re-verification**: all 6 Phase 19 fixes independently re-confirmed present in current
  source (not just re-read from the prior report) — see §7 and `SECURITY.md`'s new Phase 20 section for
  specifics and file references. No regression was found.
- **New code added this phase**: a two-line health-check improvement (`apps/api/src/app.js`'s `GET /health`
  now reports live MongoDB connection state, degrading `status` to `"degraded"` when disconnected — previously
  a bare static `{status:"ok"}`), plus the two new end-to-end test files. No other production code was
  changed.

---

*Cross-references: `SECURITY.md` (technical controls + Phase 20 re-verification section), `docs/deployment.md`
(deployment steps), `docs/database.md` (schema reference), `docs/architecture.md` (system design),
`docs/roles-permissions.md` / `docs/audit-controls.md` (RBAC and audit detail).*
