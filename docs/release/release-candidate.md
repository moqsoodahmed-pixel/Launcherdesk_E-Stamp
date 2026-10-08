# Release Candidate — LauncherDesk E-Stamp

Status date: 2026-10-08. This document is the Phase 40 final code-freeze record for the LauncherDesk
E-Stamping SaaS MERN monorepo. It was produced by re-running the real test suites and build in this
environment and re-reading the source files it makes claims about — it does not carry forward any
claim from an earlier phase without independently re-verifying it this session.

## Release Candidate name

**LauncherDesk E-Stamp — Release Candidate (Phase 40 code freeze)**

## Current State

- **Product completeness** (carried forward from Phase 39, re-confirmed this phase to still be accurate):
  19 of 20 original modules COMPLETE; System Settings remains PARTIAL because the
  `BULK_ESTAMP_MAX_FILE_SIZE_MB` system setting is stored and editable at runtime but the server's actual
  multer upload limit is wired from the `BULK_ESTAMP_MAX_FILE_SIZE_MB` **environment variable** at process
  start, not from the live database setting — this gap is honestly disclosed in the Settings UI itself
  (`apps/web/src/pages/settings/SystemSettingsPage.jsx`) and locked in by a frontend test. Zero P0/P1/P2
  defects. Two inert P3 findings only (see Deferred Items).
- **Tests** (actually run this session, not carried forward):
  - Backend: 639/639 passed (32 test files, `vitest run` in `apps/api`).
  - Frontend: 184/184 passed (20 test files, `vitest run` in `apps/web`).
  - Total: 823/823 passed.
  - Build: `npm run build --workspace=apps/web` — **PASS** (clean Vite production build, no source maps
    emitted; one non-blocking advisory about a >500kB JS chunk, informational only).
- **Security status**: no real secrets found committed anywhere in the repository (only third-party
  `node_modules` test fixtures/docs matched secret-shaped patterns). All production-sensitive environment
  variables (`MONGODB_URI`, `JWT_SECRET`, `JWT_REFRESH_SECRET`) fail closed (throw on startup) if unset with
  `NODE_ENV=production`. All provider integrations (Razorpay payments, Brevo email, Cloudinary file storage,
  the E-Stamp provider factory) fail closed in production rather than silently falling back to a mock/dev
  adapter. No new P0/P1/P2 issue was found this phase.

## Code Freeze statement

This codebase is frozen for release as of this document's status date. No application code was modified
during this phase's audit (Phase 40 found no P0/P1 release blocker requiring a fix — see Final Pre-Deployment
section of the accompanying Phase 40 report for the full verification trail). The only new artifact added by
this phase is this document itself.

## Known Deferred Items

The following are intentionally deferred and were confirmed, this phase, to remain correctly deferred —
none has been silently resolved, reopened, or worked around:

- **Real E-Stamp provider integration** — `RealEStampProvider` remains an honest, unimplemented placeholder.
  This is an external blocker: it requires a vendor integration specification that does not exist in this
  environment. The provider factory (`apps/api/src/services/estamp-providers/index.js`) refuses to run in
  production with `ESTAMP_PROVIDER=mock` (or unset), so no fabricated certificate can ever be issued.
- **`BULK_ESTAMP_MAX_FILE_SIZE_MB` runtime wiring** — stored/editable as a System Setting, but the live
  multer upload limit is still sourced from the environment variable at process start, not the DB value.
  Disclosed honestly in-product; not a hidden gap.
- **Audit export** — not implemented.
- **Report export** — not implemented.
- **Refund workflow** — not implemented; no "automatic refund" capability exists or is claimed anywhere.
- **`uuid` dependency advisory** — a production runtime dependency; the flagged buffer-bounds issue concerns
  a code path (`v3`/`v5`/`v6` generation with a caller-supplied buffer) this app's `uuid.v4()` usage never
  exercises. Deferred per existing documented justification in `docs/production-readiness.md` §14.
  Requires a breaking major-version upgrade; not performed.
- **`react-router` / `react-router-dom` dependency advisory** — a production runtime dependency; the flagged
  CVEs concern an open-redirect in `<Link>`/`useNavigate` and SSR-hydration deserialization, neither of which
  this app's client-side-only routing usage exercises. Deferred per the same existing documented
  justification. Requires a breaking major-version upgrade; not performed.
- **Browser/live QA** — not performed in this sandbox (no browser automation or real infra exists here, per
  Phases 35/36).
- **Real staging deployment** — not performed (see `docs/deployment/staging-deployment.md`).
- **Production deployment** — not performed.

### Note on dependency advisories beyond the above

Running `npm audit` in both workspaces this phase surfaced additional advisories beyond the `uuid` /
`react-router` pair documented in `docs/production-readiness.md` (e.g. `vite`/`esbuild`/`vitest`/`tinypool`
in both workspaces, plus `nodemon`/`chokidar`/`braces` in `apps/api` and `tailwindcss`'s
`postcss-selector-parser`/`fast-glob` chain in `apps/web`). All of these are **devDependencies** — local
dev server, test-runner, and CSS/JS build tooling — none of which ship into the production backend process
or the static frontend build artifact (`apps/web/dist` was confirmed this phase to contain only
`index.html`, one CSS file, and one JS bundle). This is normal advisory-database drift over time (new CVEs
published against dev tooling since Phase 19/39's snapshot), not a change in this repository's shipped code
or a new production exposure. No upgrade was performed, per this phase's explicit instruction not to upgrade
dependencies solely because advisories exist. A future phase may wish to refresh the advisory count/identity
language in `docs/production-readiness.md` §14 to reflect this drift.

## External Blockers

- **Real E-Stamp provider integration** (the primary blocker) — requires a vendor integration specification
  (API contract, authentication scheme, certificate/issuance format) that has not been supplied. No
  provider API has been invented or guessed at any point in this project.
- Managed MongoDB cluster, hosting platform, DNS/TLS, and live Razorpay/Brevo/Cloudinary credentials — none
  exist in this sandbox (confirmed again this phase; see `docs/deployment/staging-deployment.md` §2 for the
  full prerequisites table, not duplicated here).

## Deployment Prerequisites

See **`docs/deployment/staging-deployment.md`** (Phase 36) for the complete, still-accurate prerequisites
list, required environment variables, architecture diagram, and known limitations. This document does not
duplicate that content — it only points to it.

## Final Pre-Deployment Checks (checklist)

Before any real deployment is attempted, confirm each of the following has been done with real values/real
infrastructure (none of this has been done in this sandbox):

- [ ] All production environment secrets generated fresh (never reused from any developer `.env` or this
      repository) — `JWT_SECRET`, `JWT_REFRESH_SECRET`, `MONGODB_URI`, `SEED_MASTER_ADMIN_PASSWORD`.
- [ ] Managed MongoDB cluster provisioned, reachable, and network-restricted to the API host's egress IP(s).
- [ ] Hosting platform selected and provisioned for `apps/api` (container/VM/PaaS) and `apps/web` (static
      host/CDN).
- [ ] Domain(s) registered and DNS configured for the API and frontend origins; TLS certificates issued and
      installed (or terminated at a managed load balancer/CDN).
- [ ] Razorpay live (or test, for staging) API credentials and webhook secret configured; webhook endpoint
      registered with Razorpay.
- [ ] Brevo API key configured and sender identity verified.
- [ ] Cloudinary account credentials configured.
- [ ] Real E-Stamp provider credentials and endpoint configured (blocked until a vendor spec exists).
- [ ] Browser/live QA performed against the deployed environment (not simulated — this sandbox has no
      browser automation).
- [ ] Cross-tenant QA performed against the deployed environment with at least two real client organizations.
- [ ] Mobile QA performed against the deployed environment on real or emulated mobile devices.
- [ ] Smoke test of the full E-Stamp lifecycle (Request → Calculate → Wallet Debit → Order → Lock → Process →
      Provider → Issued/Failed → Certificate → Download) performed against the deployed environment with real
      infrastructure.

**This document does not mean the application has been deployed.** No deployment, hosting setup, DNS/TLS
configuration, or live provider integration has been performed as part of this phase or any phase before it
in this sandbox. This document records that the codebase is frozen and verified ready for that future,
separate deployment effort.
