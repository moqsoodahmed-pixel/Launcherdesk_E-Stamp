# Phase 1 Scope — What's Real, What's Scaffolded

## Language/stack note
This edition is plain JavaScript throughout: the backend is CommonJS Node/Express (`.js`, `require`/`module.exports`),
the frontend is ESM React/Vite (`.jsx`/`.js`, `import`/`export`). There is no TypeScript, no `tsc` build step, and
no type-checking anywhere in the toolchain — `node src/server.js` runs the backend directly, and `vite dev`/`vite build`
runs the frontend directly.

## Fully implemented (real logic, tested where noted)
- Authentication: password hashing (argon2id), JWT + rotating refresh tokens, 24h-configurable OTP
  re-verification, account lockout, forgot/reset password without user enumeration
- RBAC: 5-tier role hierarchy + permission system, enforced server-side on every route
- Multi-tenant isolation: `organizationId` on every tenant resource, session-derived (never client-supplied)
  — tested in `tests/tenant-isolation.test.js`
- Wallet/ledger: atomic credit/debit, idempotent, race-condition-safe — tested in `tests/wallet.test.js`
- E-Stamp request state machine + 20-minute modification/cancellation window (server-authoritative) —
  tested in `tests/modification-window.test.js`
- Article/calculation engine: data-driven rules (FIXED/PERCENTAGE/SLAB), versionable — tested in
  `tests/calculation.test.js`
- Audit logging: append-only, redacted, covers every action listed in the spec
- Assistant Master Admin activity → Master Admin notification fan-out
- Razorpay payment flow with mandatory server-side signature verification
- File upload validation (MIME allowlist, size limit) with private-by-default storage

## Implemented with a DEV mock adapter (real interfaces/services, no live third-party call)
- **Brevo email**: if `BREVO_API_KEY` is unset, `EmailService` logs instead of sending.
- **Razorpay**: if `RAZORPAY_KEY_ID` is unset, `PaymentService` issues a mock order id and treats signature
  verification as auto-valid (dev-only path, clearly marked).
- **Cloudinary**: if `CLOUDINARY_CLOUD_NAME` is unset, `FileService` creates a `FileAsset` record with a
  mock public ID instead of uploading.
- **E-Stamp provider**: `MockEStampProvider` is the only adapter shipped — no real government/vendor E-Stamp
  API documentation or credentials were available. It returns `PENDING` and never fabricates certificate
  numbers, seals, QR codes, or any official security element.

## Frontend: built out vs. placeholder
Fully built: Login (with OTP step), Dashboard (real data), Create E-Stamp Request, My Requests list,
Request detail (with server-authoritative countdown + cancel).

Placeholder shell (backend API fully exists — see `docs/api.md` — UI wiring is the remaining work):
Organizations, Assistant Master Admins, Users, Orders, Articles (management UI), Payments, Wallet/Balance UI,
Reports, Notifications, Audit Logs, Settings, Bulk E-Stamp Request, File Upload/Download UI, Company
Profile, About, Profile.

## Explicitly deferred to Phase 2 (per the original spec's Phase 1 boundary)
- CSV/Excel/PDF report export (the `/reports/summary` endpoint returns JSON aggregates now)
- Bulk E-Stamp request file parsing/validation UI (backend file upload + FileAsset model already support
  storing the uploaded template; the parse/validate/confirm pipeline itself is not yet implemented)
- Real E-Stamp provider integration (pending vendor credentials/API docs)
- Terms / No-Refund Policy content management UI (module is architected but not built out)
- Any mobile app, chatbot, CRM, or other functionality explicitly excluded from Phase 1 in the original spec
