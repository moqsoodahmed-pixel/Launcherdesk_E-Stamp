# Audit controls (Phase 15)

This maps the LauncherDesk E-Stamping `AuditLog` system's actual engineering controls to the six audit/security
control-objective categories commonly referenced by security frameworks. It describes **what this codebase
implements today**, citing the real mechanism for each claim. See `SECURITY.md` at the repository root for the
full technical-control list and the honest, explicit statement that none of this constitutes certification.

## 1. Access control

Every audit endpoint is gated by the `Permission.AUDIT_VIEW` permission (`requirePermission`), not a hardcoded
role check. `Role.MASTER_ADMIN` holds every permission implicitly (the all-permissions rule); `SUPER_ADMIN` and
`ADMIN` hold `audit.view` by default for their own organization (`packages/shared/src/permissions.js`);
`Role.ASSISTANT_MASTER_ADMIN` only ever holds it via an explicit, revocable per-user grant from Master Admin -
never auto-granted, matching every other Assistant-oversight permission in this codebase. `GET /audit/mine` has
no permission gate at all, because it is hard-scoped to the caller's own `actorId` and is therefore inherently
tenant-safe.

## 2. Accountability

`recordAudit` (`apps/api/src/services/audit.service.js`) is the single, centralized write path used by every
mutating/sensitive action across the codebase (53+ call sites at last count). Every record captures `actorId`,
`actorRole`, `actorType` (`USER` or `SYSTEM` - see below), `organizationId`, `action`, `entityType`/`entityId`,
`ip`, `userAgent`, and a free-form `metadata` object. System-generated events (the `lockExpiredRequests` cron,
provider/payment webhooks) are recorded with `actorId: null` and `actorType: "SYSTEM"` - never a fabricated
human identity.

## 3. Data protection

Audit `metadata` is deliberately never allowed to carry secrets: passwords, OTP codes, JWTs, refresh tokens,
Razorpay signatures, or signed document URLs are never written to an `AuditLog` document anywhere in the
codebase (verified by direct review of every `metadata:` call site, and guarded by an automated regression test
in `apps/api/tests/audit.test.js` that exercises a representative slice of the highest-risk flows - OTP failure,
login failure, and a payment webhook - and asserts none of the resulting records contain secret-shaped
substrings). `ip`/`userAgent` are captured from the request as Express provides them; this deployment does not
set `app.set("trust proxy", ...)`, so `req.ip` is the direct socket address, never a spoofable
`X-Forwarded-For` header - a real limitation if this app is ever placed behind a reverse proxy, at which point
`trust proxy` would need to be configured correctly for the actual deployment topology (not attempted in this
phase, since getting it wrong is itself a spoofing vector).

## 4. Change traceability

Every state-changing action that matters to an investigation - user/organization management, role/permission
changes, E-Stamp request/order lifecycle transitions (including the two gaps closed in this phase: the
`lockExpiredRequests` cron's per-request `ESTAMP_REQUEST_LOCKED` entries, and confirming `OTP_FAILED` was
already correctly wired), article versioning, settings changes - is recorded through the same `recordAudit`
path with an `entityType`/`entityId` pair, making a specific record's full history reconstructable by querying
`GET /audit` with that entity's filters.

## 5. Financial traceability

Payment order creation, signature verification (success and failure), and the Razorpay webhook path all record
audit entries (`PAYMENT_VIEWED`, `PAYMENT_VERIFIED`) with non-secret metadata (amount, result, status) - never
the signature itself. Wallet balance changes (`BALANCE_CHANGED`) and E-Stamp provider balance
view/refresh/usage actions are audited identically, giving a queryable trail for any financial dispute or
reconciliation.

## 6. Incident investigation

`GET /audit` supports validated filtering by `action` (whitelisted against the `AuditAction` enum), `actorId`,
`actorRole`, `actorType`, `entityType`, `entityId`, and a bounded date range (`dateFrom`/`dateTo`, capped at the
same 366-day maximum used elsewhere in this codebase), plus a whitelisted sort (`createdAt`, `action`,
`actorRole`, `actorType`, `entityType` - never a client-supplied raw sort field) and bounded pagination (max
100/page). Tenant isolation is enforced server-side: a tenant actor's `organizationId` query parameter is
always ignored in favor of their own session-derived organization, and an Assistant Master Admin holding
`audit.view` must explicitly name exactly one organization - there is no silent global fallback for anyone
other than Master Admin.

## Immutability

No route (`PATCH`/`PUT`/`DELETE`) exists anywhere in `apps/api/src` for an `AuditLog` document, and no code
calls `AuditLog.updateOne`/`updateMany`/`deleteOne`/`deleteMany`/`findByIdAndUpdate`/`findByIdAndDelete`
(grep-verified). **What this guarantees**: no application code path exists to modify or delete an audit
record once written. **What this does NOT guarantee**: there is no database-level enforcement (e.g. a
restricted database user without update/delete grants on this collection) and no cryptographic tamper-evidence
(hash chaining). Both are infrastructure/design decisions requiring further work under real deployment
constraints and are explicitly deferred, not implemented, in this phase.

## Disclaimer

This document describes engineering controls implemented in the codebase. It does **not** constitute, and must
never be represented as, ISO 27001, GDPR, or SOC 2 (or any other) certification or attestation. Achieving any
such certification requires an accredited external auditor, a formal ISMS, documented operational processes,
and time-bound evidence collection - see `SECURITY.md`'s "Operational gaps" section for the full list of what
remains outside a codebase's ability to provide.
