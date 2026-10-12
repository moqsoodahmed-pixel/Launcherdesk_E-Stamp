# API Reference (v1)

Base URL: `/api/v1`. All endpoints except `/auth/login`, `/auth/login/verify-otp`, `/auth/refresh`,
`/auth/forgot-password`, `/auth/reset-password` require `Authorization: Bearer <accessToken>`.

## Auth — `/auth`
| Method | Path | Description |
|---|---|---|
| POST | `/login` | Step 1: email+password. Returns tokens directly if OTP still valid within window, else a `challengeToken`. |
| POST | `/login/verify-otp` | Step 2: `{ otpToken, code }` → tokens |
| POST | `/refresh` | Rotates refresh token, returns new access+refresh tokens |
| POST | `/logout` | Revokes the given refresh token |
| GET | `/me` | Current authenticated user |
| POST | `/forgot-password` | Does not reveal whether the email exists |
| POST | `/reset-password` | `{ resetToken, code, newPassword }`; invalidates all existing sessions |
| POST | `/change-password` | Authenticated. `{ currentPassword, newPassword }` (min 8 chars, must differ). Wrong current password → 400. Clears `mustChangePassword`, ends all other sessions (tokenVersion bump + refresh tokens revoked), returns a fresh token pair. Rate-limited 5 / 15 min per user. Audit: `PASSWORD_CHANGED`. |

## Assistant scoping (balance-ledger flow)
Master Admin acts on every organization. An Assistant Master Admin acts **only** on organizations whose
`assignedAssistantId` is them (none assigned = sees none). One helper (`apps/api/src/utils/orgAccess.js`)
enforces this on: `/organizations` list/detail/edit/super-admin provisioning, `/wallet/:organizationId/*`
(balance, transactions, manual credit), `POST /payments/:id/credit-balance`, `GET /payments` (+ detail,
verify, order creation), `GET /payments/credit-summary`, `GET /orders` (+ summary, detail, process, sync,
retry) and `GET /estamps` (+ detail, modify, cancel). Lists are narrowed (a foreign `organizationId` filter
returns nothing); acting on an unassigned organization returns 403 (404 for single orders/requests/payments,
so ids are not confirmed).

## Organizations — `/organizations` (Master/Assistant Master Admin only, assistant-scoped)
`POST /` create (optional `assignedAssistantId`, Master Admin only; an assistant creating a client is
assigned to it) · `GET /` list · `GET /:id` detail (now includes `assignedAssistant` and
`wallet.{balance,reservedBalance,availableBalance}`) · `PATCH /:id/status` (Master Admin only) ·
`PATCH /:id/estamp-service` (Master Admin only) ·
`PATCH /:id/assigned-assistant` `{ assistantId | null }` (Master Admin only): target must be an active
Assistant Master Admin; audited as `ORG_MODIFIED`, the assistant is notified

## Users — `/users` (tenant-scoped)
`POST /` create (role must be strictly below creator's authority) · `GET /` list (scoped to caller's org,
or filterable by `organizationId` for internal roles) · `PATCH /:id/status` activate/deactivate

## Profile — `/profile` (any authenticated user, own data only)
`GET /organization` the caller's own organization (`name contactEmail contactPhone gstin address status
isEstampServiceEnabled createdAt`); the id comes only from the session, 404 if the user has no organization ·
`PATCH /` `{ name?, phone? }` edits the caller's own name (2-150 chars) and phone (empty string clears it,
otherwise 6-20 chars). Email, role and organization are never changed here. Audited as `USER_MODIFIED`;
never returns `passwordHash`.

## Wallet — `/wallet`
The balance is a ledger number per organization; real money goes to the company bank account via Razorpay.
`GET /balance` → `{ balance, reservedBalance, availableBalance }` (available = balance − reserved) ·
`GET /transactions` (own org; credits read "Balance added, payment <razorpay id>", debits
"E-Stamp request <number>") · `GET /:organizationId/balance` and `GET /:organizationId/transactions`
(internal, assistant-scoped) · `POST /:organizationId/credit` `{ amount, description }` (internal +
`wallet.manage`, assistant-scoped): manual credit for offline transfers or corrections; `description`
(3-500 chars) is **required**; audited `BALANCE_CHANGED`

## Payments — `/payments`
`POST /razorpay/order` create order · `POST /razorpay/verify` server-verifies the signature and marks the
payment `SUCCESS` + `balanceStatus: PENDING_CREDIT` — it does **not** credit the wallet (same for the
webhook); the assigned assistant (or every Master Admin if none) is notified · `GET /` list, new filter
`balanceStatus=PENDING_CREDIT|CREDITED` (CREDITED also matches legacy SUCCESS payments without the field) ·
`POST /:id/credit-balance` (Master Admin or the assigned assistant, `wallet.manage`): credits exactly
`payment.amount` with idempotency key `payment:<id>`, sets `balanceStatus: CREDITED`, `creditedAt`,
`creditedBy`, `walletTransactionId`; audited `BALANCE_CHANGED`; client payer + Super Admins notified, and
Master Admins if an assistant did it; 409 `ALREADY_CREDITED` if already credited, 409 `PAYMENT_NOT_PAID`
if not successful · `GET /credit-summary` (internal, `payment.view`, assistant-scoped):
`{ totalReceived, totalCredited, pendingAmount, pendingCount, pendingByOrganization[] }`

## Articles — `/articles`
`GET /` list (query: `stateCode`, `search`) · `GET /:id` detail · `POST /` create (Master Admin only) ·
`POST /:id/versions` add a new calculation rule version (Master Admin only)

## E-Stamp Requests — `/estamps`
`POST /` create (runs calculation → atomically **reserves** the amount against the available balance,
400 `INSUFFICIENT_BALANCE` if too low → creates request+order with `chargeStatus: RESERVED`) ·
`GET /` list (USER role sees only their own) · `GET /:id` detail · `PATCH /:id` modify within the window;
`considerationPrice` / `numberOfEStamps` may now change: the server recalculates and moves the reservation
by the difference (400 `INSUFFICIENT_BALANCE` on an unaffordable increase) · `POST /:id/cancel` (only
within the 20-minute window) releases the reservation (`chargeStatus: RELEASED`), costs nothing.
When the window ends the lock job converts the reservation into one DEBIT (idempotency key
`estamp-charge:<requestId>`, `chargeStatus: CHARGED`); a sweep on every tick charges anything left
reserved after a crash. If the balance cannot cover it, `chargeStatus: SHORTFALL`, the request is held
from processing (409 `CHARGE_PENDING`) and the assigned assistant is notified; it charges automatically
once the balance is corrected. No automatic refund after lock.
Legacy requests (debited at submit before this flow) have no `chargeStatus` and are treated as charged;
run `npm run migrate:balance-ledger --workspace=apps/api` once to make that explicit.

## Orders — `/orders`
`GET /` list, filterable by `status` and (internal roles) `organizationId`

### Fulfilment mode — `ESTAMP_FULFILMENT`
Env var (default value) and Settings key (a Master Admin override wins): `manual` (default) or `provider`.
The current mode is returned as `fulfilmentMode` on `GET /auth/me` and the login `user` object.
- **manual**: there is no external E-Stamp vendor. The organization's assigned Assistant Master Admin
  stamps outside the app and uploads the certificate. No E-Stamp provider is ever instantiated, so
  production does not need `ESTAMP_PROVIDER`. `POST /orders/:id/process|sync|retry`, `GET /reports/provider`
  and every `/estamp-provider/*` route answer **409 `MANUAL_FULFILMENT_ENABLED`**;
  `POST /orders/webhook/:provider` answers **410**.
- **provider**: the provider-integration flow exactly as before; the manual endpoints below answer
  409 `PROVIDER_FULFILMENT_ENABLED`.

### Manual fulfilment endpoints (manual mode; Master Admin or the organization's assigned assistant, `order.manage`; never a client role — 403 otherwise)
An order is fulfillable only when its request is `LOCKED`/`PROCESSING` **and** `chargeStatus: CHARGED` —
never inside the 20-minute window, `CANCELLED` or `SHORTFALL` (409 `WINDOW_OPEN` / `INVALID_STATE` /
`CHARGE_PENDING`).
- `GET /?queue=fulfil` — orders still to stamp (`CREATED`/`PROCESSING`), assistant-scoped; rows add
  `lockedAt` and `articleTitle`. Use `sortBy=createdAt&sortDir=asc` for oldest first. Clients: 403.
- `GET /fulfilment-summary` — `{ toFulfil, oldestLockedAt, oldestAgeMinutes, fulfilledToday }` in scope.
- `POST /:id/start` — `CREATED → PROCESSING`, request `LOCKED → PROCESSING`, records `fulfilledBy`/`startedAt`,
  audited; idempotent.
- `POST /:id/fulfil` (multipart: `file`, `stampReference` 3-100 chars, optional `notes`) — all-or-nothing:
  upload (same MIME allowlist, size limit and executable-signature check as `/files/upload`), certificate
  document, order `ISSUED`/`COMPLETED`/`downloadStatus: AVAILABLE` with `providerReference` = stamp reference,
  request `DOWNLOAD_AVAILABLE`. Any failure removes the uploaded file and leaves the order unchanged.
  Issued + certificate-available notifications/emails fire once per order. 409 `ALREADY_ISSUED` on repeat.
- `POST /:id/fail` `{ reason (5-500), refundBalance (boolean, required) }` — order and request `FAILED`,
  client notified. Only with `refundBalance: true`: ONE CREDIT reversing the charge
  (`referenceType: ESTAMP_REQUEST_REVERSAL`, idempotency key `estamp-refund:<requestId>`, reason in the
  description), audited `BALANCE_CHANGED`. Never refunds automatically.
- When a request locks and is charged, the assigned assistant (or every Master Admin) gets one
  "New order to fulfil <orderNumber>" notification.

### Vendor stage (manual mode; Master Admin or the assigned assistant, `order.manage`; never a client role)
See [vendor-workflow.md](vendor-workflow.md) for the status diagram.
- `GET /vendors` — active vendors for the dispatch picker, `{ items: [{ _id, name }] }` only.
- `POST /dispatch` `{ orderIds: [1..200], vendorId }` — per order, atomic and idempotent: only when the request is
  `LOCKED`/`PROCESSING` + `CHARGED`, the order is not `ISSUED`/`FAILED`, and `vendorStatus` is `NOT_SENT`/`REJECTED`.
  Sets `vendorStatus: SENT`, `eStampStatus: PROCESSING`, `vendorId`. Returns
  `{ results: [{ orderId, orderNumber, ok, reason?, alreadySent? }], sent, failed }`; reasons: `NOT_FOUND`,
  `NOT_LOCKED`, `NOT_CHARGED`, `ALREADY_ISSUED`, `ALREADY_FAILED`, `ALREADY_WITH_VENDOR`, `INVALID_STATE`,
  `CHANGED_CONCURRENTLY`. Re-sending to the same vendor is `ok` + `alreadySent`. Any order in an organization not
  assigned to the calling assistant → 403 for the whole call (nothing dispatched). Inactive vendor → 409
  `VENDOR_INACTIVE`. The vendor gets ONE in-app notification per distinct set of orders sent.
- `POST /:id/recall` — `SENT`/`ACCEPTED` only → `NOT_SENT` (vendor removed), audited `ORDER_RECALLED`; 409 otherwise.
- `GET /?queue=vendor-review` — orders with `vendorStatus: UPLOADED`; rows add `vendorName` and
  `pendingVendorUpload { _id, stampReference, notes, uploadedAt }`. `GET /?queue=fulfil&vendorStatus=…` filters the
  fulfilment queue by vendor stage (staff rows always carry `vendorStatus` and `vendorName`). Clients: 403.
- `GET /:id/vendor-upload[?uploadId=]` — `{ url (signed, 5 min), filename, contentType, fileSize, upload }` for the
  latest (or a given) vendor upload. Staff only.
- `POST /:id/vendor-approve` — runs the SAME issue step as `/fulfil` using the vendor's stored file: certificate
  document, `ISSUED`/`COMPLETED`/`AVAILABLE`, `providerReference` = stamp reference, request `DOWNLOAD_AVAILABLE`,
  issued + certificate-available notifications/emails once, `vendorStatus: APPROVED`. Idempotent
  (`alreadyApproved: true`, no second document or notification).
- `POST /vendor-approve-many` `{ orderIds: [1..200] }` — per-order `{ orderId, ok, alreadyApproved?, reason? }`.
- `POST /:id/vendor-reject` `{ reason (5-500) }` — `UPLOADED → REJECTED`, upload marked `REJECTED` with the reason,
  vendor notified.
- `POST /:id/fail` also works while the order is with a vendor; it clears the vendor stage (`NOT_SENT`, no vendor).
- `GET /:id` for staff adds `vendor { _id, name, email, isActive }` and actions `dispatch`, `recall`, `vendorReview`.
- Clients never receive `vendorId`, `vendorStatus`, `vendorUploads` or other vendor fields, vendor actions, or
  vendor audit entries (order detail history and `/audit`).
- `GET /estamps` for a USER now also includes every COMPLETED / DOWNLOAD_AVAILABLE request of their organization
  (released certificates are organization-wide), in addition to their own requests.

## Vendors — `/vendors` (MASTER_ADMIN only)
- `GET /` `?status=active|inactive&search=` → `{ items, total }`.
- `POST /` `{ name, email, phone? }` → 201 `{ user, tempPassword }` (temp password shown once, never emailed;
  `mustChangePassword: true`; welcome email tells the vendor to use **Forgot password**).
- `PATCH /:id/status` `{ isActive }` — deactivation ends live sessions immediately.

## Vendor — `/vendor` (VENDOR only; every lookup scoped to `vendorId = me`, anything else 404)
A VENDOR is fenced out of every other route (403), except `/auth/*`, `/notifications`, `PATCH /profile` and
policy acknowledgement. Vendors use the normal email + OTP login.
- `GET /orders` `?status=SENT|ACCEPTED|UPLOADED|REJECTED|APPROVED&batch=<bulkBatchId>&search=&page=&limit=` →
  `{ items, total, page, limit }`, oldest dispatch first.
- `GET /orders/summary` → `{ total, SENT, ACCEPTED, UPLOADED, REJECTED, APPROVED, oldestWaitingAt, oldestWaitingMinutes }`.
- `GET /orders/:id` — restricted projection: `orderNumber, bulkBatchId, bulkBatchNumber, stateCode, articleTitle,
  firstParty, secondParty, descriptionOfDocument, propertyDescription, considerationPrice, stampDuty,
  numberOfEStamps, organizationName, vendorStatus, dispatchedAt, acceptedAt, declined, declineReason, closed,
  documents[], uploads[]`. Never amounts charged, wallet, payments, contact details, users or other organizations.
- `GET /orders/:id/files/:fileId` — signed URL for one of the client's documents on that order, or the vendor's own upload.
- `POST /orders/:id/accept` — `SENT → ACCEPTED` (idempotent).
- `POST /orders/:id/upload` (multipart `file` PDF/PNG/JPG, `stampReference` 3-100, optional `notes`) — allowed while
  `SENT`/`ACCEPTED`/`REJECTED`/`UPLOADED`; the earlier pending upload becomes `SUPERSEDED` (file kept); same size limit
  and executable-signature check as every upload; rate-limited per vendor (150 / 15 min). Never issues anything.
- `POST /orders/:id/cannot-process` `{ reason (5-500) }` — `REJECTED` + `declined: true`, assistant notified; uploads
  blocked until re-dispatched.

## Files — `/files`
`POST /upload` (multipart, `file` field + `fileType`) · `GET /estamp/:orderId/download` (records download
history, notifies Master Admin if the actor was Assistant Master Admin)

## Notifications — `/notifications`
`GET /` list mine (+ `unreadCount`) · `PATCH /:id/read`

## Audit — `/audit`
`GET /` global log (Master Admin only) · `GET /mine` caller's own activity

## Settings — `/settings`
`GET /` list all · `PUT /` upsert one (Master Admin only)

## Reports — `/reports`
`GET /summary` organization-scoped counts/aggregates from real data (CSV/Excel/PDF export is a Phase 2
extension point, see `phase-1-scope.md`)

## Response shape

Success: `{ "success": true, "data": ..., "message"?: string }`
Error: `{ "success": false, "message": string, "code"?: string, "details"?: unknown }` (details omitted in production)
