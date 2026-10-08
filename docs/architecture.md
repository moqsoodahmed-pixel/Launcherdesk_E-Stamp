# Architecture

## High-level shape

```
apps/web  (React/Vite/TS)  ──HTTP──►  apps/api (Express/TS)  ──►  MongoDB
                                             │
                                             ├──► Brevo (email)
                                             ├──► Razorpay (payments)
                                             ├──► Cloudinary (files)
                                             └──► E-Stamp provider adapter (mock in Phase 1)
```

The frontend never talks to Brevo/Razorpay/Cloudinary/the E-Stamp provider directly, and never holds their
secrets. Every integration is a backend service behind an interface.

## Layering (backend)

```
routes/  →  controllers/  →  services/  →  models/ (Mongoose)
```

- **routes/**: wiring only — path, middleware chain, controller reference. No business logic.
- **controllers/**: parses the request, calls one or more services, shapes the HTTP response. No business logic.
- **services/**: all business logic lives here (wallet math, calculation engine, request state machine,
  OTP issuance/verification, audit recording, notification fan-out, payment verification, file validation).
- **models/**: Mongoose schemas only.

This separation is why, e.g., the wallet's atomic credit/debit logic, or the E-Stamp request's state machine,
can be unit-tested directly (see `apps/api/tests`) without spinning up HTTP.

## Multi-tenancy

Every tenant-owned collection (`User` for tenant roles, `EStampRequest`, `EStampOrder`, `Payment`,
`WalletTransaction`, `FileAsset`, `Notification`, `AuditLog`) carries an `organizationId`. The
`requireOrganizationAccess` middleware (`apps/api/src/middleware/authorize.ts`) is the single place that
derives "which organization can this request see" — and it derives that **only from `req.user`**, which
itself comes only from a verified JWT, never from any client-supplied field. Controllers then build every
Mongoose query using that resolved value, never a raw `req.params`/`req.body` organizationId for tenant roles.

Internal roles (Master Admin, Assistant Master Admin) are the deliberate exception — they operate across
organizations by design, but every sensitive read/write they perform is separately audit-logged and, for
Assistant Master Admin, fanned out as a notification to all Master Admins.

## Role hierarchy & permissions

See `docs/roles-permissions.md`. Two orthogonal checks are available and composed as needed:
- `requireRole` / `requireMinLevel` — coarse, role-identity based
- `requirePermission` — fine-grained, permission-string based (`estamp.create`, `wallet.manage`, etc.)

## E-Stamp request lifecycle

Implemented as an explicit state machine (`services/estamp-request.service.ts`) with an allow-list of valid
transitions (`ALLOWED_TRANSITIONS`), rather than status strings set ad hoc across the codebase. The
20-minute modification/cancellation window is enforced against a server-stored `modificationDeadline`
timestamp, checked on every mutating call — the frontend's countdown is cosmetic only.

## E-Stamp provider — adapter pattern

`services/estamp-providers/EStampProviderInterface.ts` defines the contract. `MockEStampProvider` is the only
implementation shipped in Phase 1 (no real provider credentials/API docs were available), clearly logged as
such and never fabricating certificate numbers, seals, or QR data. Swapping in a real provider later means
adding one new class and switching `ESTAMP_PROVIDER` in the environment — no controller/route changes needed.

## Wallet integrity

MongoDB atomic `findOneAndUpdate` with `$inc` (and a `balance: { $gte: amount }` guard on debits) avoids the
classic read-then-write race condition. Every credit/debit is additionally keyed by an `idempotencyKey` with
a unique index, so a retried webhook or duplicated client call cannot double-apply. See
`services/wallet.service.ts` and `tests/wallet.test.ts`.

## Extensibility for Phase 2

- New E-Stamp provider: implement `EStampProviderInterface`, register in `estamp-providers/index.ts`.
- New state's Article rules: create an `Article` + `ArticleVersion` document via the Master Admin API —
  no code change needed unless the rule type itself is new (`FIXED`/`PERCENTAGE`/`SLAB` cover common cases;
  `CUSTOM` is a placeholder for a future rule engine).
- New report/export format: `routes/v1/report.routes.ts` currently returns JSON aggregates; CSV/Excel/PDF
  export is a documented extension point (`docs/phase-1-scope.md`).
