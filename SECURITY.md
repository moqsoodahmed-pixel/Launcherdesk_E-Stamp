# Security & Compliance — LauncherDesk E-Stamping (Phase 1, extended Phase 19, re-verified Phase 20)

## Status

LauncherDesk E-Stamping is **not** ISO 27001 certified, **not** GDPR certified, and **not** SOC 2 Type II
certified/attested. Those certifications require an accredited external auditor, a formal ISMS, documented
operational processes, and time-bound evidence — none of which a codebase alone can provide. This document
describes the **technical controls implemented in Phase 1** that support those objectives, and the
**operational work still required** before any certification/attestation could reasonably be pursued.

## Implemented technical controls

| Control | Implementation |
|---|---|
| Password storage | Argon2id via the `argon2` package (`AuthService.hashPassword`) |
| Multi-factor auth | Email OTP required at login when the 24h (configurable) re-verification window has lapsed |
| OTP handling | 6-digit codes, SHA-256 hashed at rest, single-use, expiring, attempt-limited, resend-cooldown limited, never logged, never returned in API responses |
| Session security | Short-lived JWT access tokens + rotating opaque refresh tokens (hashed at rest), `tokenVersion` bump invalidates all sessions on password reset |
| Least privilege / RBAC | 5-tier role hierarchy + fine-grained `Permission` enum, enforced via `authenticate` / `requireRole` / `requireMinLevel` / `requirePermission` middleware |
| Tenant isolation | Every tenant-owned document carries `organizationId`; `requireOrganizationAccess` middleware derives the allowed org **only from the authenticated session**, never from client input; verified in `tests/tenant-isolation.test.ts` |
| Encryption in transit | Intended to run behind HTTPS/TLS in any real deployment (not implemented at the app layer — see "Operational gaps" below) |
| Secrets management | All secrets via environment variables (`.env`, never committed); `.env.example` ships placeholders only |
| Input validation | Zod schemas on every mutating endpoint (`packages/validation`) |
| Injection protection | `express-mongo-sanitize` strips Mongo operator injection from request input |
| Security headers | `helmet` applied globally |
| Rate limiting | Purpose-specific limiters for login, OTP verify, password reset, token refresh, Razorpay order/verify, bulk upload/confirm, document upload, provider sync/retry, and a global API limiter for everything else (see Phase 19 below) |
| Account lockout | Failed-login counter with a temporary lock window |
| Audit logging | Append-only `AuditLog` model; no update/delete route or code path is exposed for it anywhere in the app; never stores passwords/OTP/secrets; gated by a dedicated `audit.view` permission (never a hardcoded role) with server-enforced tenant scoping; see `docs/audit-controls.md` for the full control mapping |
| Assistant Master Admin oversight | Every sensitive Assistant Master Admin action fans out a `Notification` to all Master Admins (`notifyAllMasterAdmins`), in addition to the audit log entry |
| Payment integrity | Razorpay signature is verified **server-side only**; wallet credit is idempotent on a unique key so a duplicated webhook/callback cannot double-credit |
| Wallet integrity | Atomic, conditional MongoDB updates (`$inc` + balance guard) prevent negative balances and race-condition double-spend; verified in `tests/wallet.test.ts` |
| 20-minute modification window | Enforced against a server-stored `modificationDeadline` timestamp; the frontend countdown is display-only and cannot extend or bypass it; verified in `tests/modification-window.test.ts` |
| File handling | MIME-type allowlist, size limit, private-by-default Cloudinary storage, signed short-lived download URLs, no public-by-default access |
| Error handling | Stack traces and internal error details are stripped from API responses in production |
| Log hygiene | Winston logger auto-redacts any field whose key contains `password`, `otp`, `code`, `token`, `secret`, `signature`, or `authorization` |
| No public Master Admin registration | Master Admin can only be created via the guarded `seed.ts` script, gated on an environment variable being set |
| JWT algorithm pinning | `jwt.verify`/`jwt.sign` explicitly pin `HS256` (never rely on library defaults) — defense-in-depth against algorithm-confusion/downgrade attacks |
| Upload content-signature check | Executable/script byte signatures (`MZ`, ELF, Mach-O, shebang) are rejected regardless of the client-declared `Content-Type`, closing the "rename `virus.exe` to `virus.pdf`" MIME-allowlist bypass |
| Bulk spreadsheet dimension guard | A parsed workbook's declared row/column range is checked against a generous ceiling before the row array is materialized, as a defense-in-depth measure against a pathologically-shaped (e.g. zip-bomb-style) `.xlsx` |
| Bounded pagination | Every list endpoint caps a client-supplied `limit` (`Math.min(100, …)` or tighter) so no query can be forced to load an unbounded result set |

## Phase 19 — Production Security & Hardening audit

A full audit of the existing platform (all prior phases' code, not a redesign). Full findings, severities,
and fixes are recorded in the Phase 19 completion report; summarized here:

- **JWT algorithm pinning** (`middleware/authenticate.js`, `services/auth.service.js`): `jwt.verify`/`jwt.sign`
  now explicitly pass `algorithms: ["HS256"]` / `algorithm: "HS256"` instead of relying on the `jsonwebtoken`
  library's default behavior.
- **Rate limiter gaps closed**: `POST /auth/refresh`, Razorpay order-creation/verification, bulk E-Stamp
  upload/confirm, document upload, and E-Stamp provider sync/retry previously relied solely on the
  600-request/15-minute global limiter. Each now has its own generously-sized, purpose-specific limiter
  (`middleware/rateLimiters.js`) so legitimate bulk/report usage is never throttled while credential-guessing
  and resource-exhaustion abuse against these higher-cost endpoints is blunted.
- **Upload MIME-allowlist bypass closed**: the declared `Content-Type` of an uploaded file is client-controlled
  and was the *only* check; `utils/fileSignature.js` now also rejects known executable/script byte signatures
  regardless of the declared type, in both the document-upload path (`file.service.js`) and the bulk
  spreadsheet-upload path (`bulk-estamp.service.js`).
- **Bulk spreadsheet dimension guard added** (`bulk-estamp.service.js`): a cheap pre-materialization check on
  the parsed workbook's declared row/column range, ahead of the existing (still-enforced) precise row-count
  check.
- **Unbounded pagination closed**: `estamp-request`, `wallet`, and `organization` list endpoints previously
  passed a client-supplied `limit` straight into MongoDB's `.limit()` with no ceiling; all three now clamp to
  the same `Math.min(100, …)` pattern already used elsewhere (order/payment/user/notification/audit
  controllers).
- **Seed-script log hygiene**: the demo/seed account bootstrap script no longer echoes the four non-Master-Admin
  seeded accounts' plaintext temporary passwords into the runtime log stream (they remain documented in the
  script source itself, and every one of them forces a password change on first login).
- **Authorization, tenant isolation, injection defenses, webhook signature verification, and wallet
  concurrency were all re-audited and found sound** — no route was found missing its permission/role gate, no
  IDOR was found across any tenant-owned resource, no mass-assignment/prototype-pollution gap was found in any
  controller, and both the Razorpay and E-Stamp provider webhook handlers still verify signatures correctly
  with idempotent, replay-safe handling. These are documented, not re-built.
- **Known, accepted residual items** (documented rather than changed, to avoid scope creep or behavior
  changes not requested by this hardening pass):
  - The Phase 17 `BULK_ESTAMP_MAX_ROWS` / `BULK_ESTAMP_MAX_FILE_SIZE_MB` admin-configurable Settings API
    values are validated and stored, but bulk-upload enforcement still reads the static `env.js` default
    directly rather than the live DB-effective value. The static default *is* enforced (uploads are not
    unbounded), but an admin's live override has no effect. Left as-is per this phase's explicit scope
    boundary (not a one-line fix — wiring it correctly touches a `multer` size limit set once at module-load
    time as well as the service's row-count check).
  - The account-lockout response (`429`, after 5 failed logins) is distinguishable from the generic `401`
    used for every other login failure, which is a narrow residual email-enumeration side channel. Changing
    this would mean weakening the lockout UX for legitimate locked-out users; left as an accepted trade-off.
  - `otpRequestLimiter` is defined but has no dedicated route to attach to (OTP issuance is folded into the
    `/login` and `/forgot-password` endpoints, both already covered by `loginLimiter`/`passwordResetLimiter`).
    Harmless dead code, kept for a future dedicated OTP-request endpoint.
- **Rate limiting is in-memory and per-process**: `express-rate-limit`'s default store is an in-memory map.
  This is correct for a single Node process; if this API is ever horizontally scaled across multiple
  instances without a shared store (e.g. Redis), each instance enforces its own independent counters, so the
  *effective* limit multiplies by instance count. Not a defect today (single-instance deployment), but
  documented here so it is not silently forgotten when scaling.

## Phase 20 — Final QA re-verification

Phase 20 (the final planned engineering phase) re-read every Phase 19 fix directly in current source rather
than trusting the Phase 19 report, specifically to catch any accidental regression introduced by a later
phase's changes. All six were confirmed still present and correct: `algorithms: ["HS256"]` /
`algorithm: "HS256"` in `middleware/authenticate.js` / `services/auth.service.js`; the executable-signature
denylist (`utils/fileSignature.js`) wired into both `file.service.js` and `bulk-estamp.service.js`; all five
Phase 19 rate limiters wired to their routes (`middleware/rateLimiters.js`); the three pagination caps;
the XLSX pre-parse dimension guard; and seed-script log hygiene. `npm audit` was re-run and found the same 8
advisories as Phase 19 (dev-tooling-only: vitest/esbuild/vite; and two runtime deps — `react-router`, `uuid` —
both requiring a breaking major-version bump with no currently-reachable exploit path in this app's usage),
nothing new. A full permission-orphan sweep (every `Permission` enum value in `packages/shared/src/permissions.js`
cross-referenced against every `requirePermission` call site and every inline permission check) found zero
remaining orphans — the "declared permission, no route ever checks it" bug class that recurred at Phases 15
and 17 did not recur a third time. See `docs/production-readiness.md` for the full Phase 20 report.

## Operational gaps that must be closed before certification/attestation

These are organizational and infrastructure requirements, not code:

- Formal Information Security Management System (ISMS) documentation and risk register (ISO 27001)
- Data Processing Agreements, a documented lawful basis for processing, and a Data Protection Impact
  Assessment for any personal data handled (GDPR)
- A named Data Protection Officer or equivalent responsible party, if required by applicable law
- Formal data retention and deletion schedules, and a working data subject access/erasure request process
- TLS termination and certificate management at the infrastructure layer (load balancer / reverse proxy)
- Centralized log retention, tamper-evidence (e.g. WORM storage or hash-chaining) for `AuditLog`, and a SIEM
  or equivalent monitoring pipeline
- Vulnerability scanning, dependency scanning, and a patch management cadence
- Penetration testing by an independent third party
- Business continuity / disaster recovery plan and tested backup/restore procedures for MongoDB
- Formal vendor risk assessments for Brevo, Razorpay, Cloudinary, and any E-Stamp provider ultimately used
- An accredited external auditor engagement for SOC 2 Type II (which additionally requires evidence
  collected over an observation period, not a point-in-time code review)
- A Web Application Firewall (WAF) and DDoS protection at the network edge — this application performs no
  network-layer filtering itself
- Network-level isolation of the MongoDB instance (private subnet/VPC, firewall rules, no public bind) —
  the application trusts whatever `MONGODB_URI` points at
- A dedicated secrets manager (e.g. AWS Secrets Manager, HashiCorp Vault) instead of `.env` files for
  production secret storage and rotation
- A distributed/shared rate-limiting store (e.g. Redis-backed) if this API is ever deployed across more than
  one process/instance — see the in-memory rate-limiting note above
- Encrypted backups and a tested restore procedure for MongoDB, and TLS-in-transit to the database itself
  (both infrastructure-layer, not application-layer, concerns)

## Reporting a vulnerability

If you find a security issue, do not open a public issue — contact the project owner directly with details
and reproduction steps.
