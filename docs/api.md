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
