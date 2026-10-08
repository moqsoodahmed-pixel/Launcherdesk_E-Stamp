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

## Organizations — `/organizations` (Master/Assistant Master Admin only)
`POST /` create · `GET /` list · `GET /:id` detail · `PATCH /:id/status` (Master Admin only) ·
`PATCH /:id/estamp-service` (Master Admin only)

## Users — `/users` (tenant-scoped)
`POST /` create (role must be strictly below creator's authority) · `GET /` list (scoped to caller's org,
or filterable by `organizationId` for internal roles) · `PATCH /:id/status` activate/deactivate

## Wallet — `/wallet`
`GET /balance` · `GET /transactions` (own org) · `GET /:organizationId/balance` and
`POST /:organizationId/credit` (internal roles only — manual credit, goes through the same atomic service
as Razorpay credits)

## Payments — `/payments`
`POST /razorpay/order` create order · `POST /razorpay/verify` server-verifies signature, then credits wallet
idempotently

## Articles — `/articles`
`GET /` list (query: `stateCode`, `search`) · `GET /:id` detail · `POST /` create (Master Admin only) ·
`POST /:id/versions` add a new calculation rule version (Master Admin only)

## E-Stamp Requests — `/estamps`
`POST /` create (runs calculation → debits wallet → creates request+order, all-or-nothing) ·
`GET /` list (USER role sees only their own) · `GET /:id` detail · `POST /:id/cancel` (only within the
20-minute window, backend-enforced)

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
