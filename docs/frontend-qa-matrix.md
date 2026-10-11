# Frontend QA matrix

One row per route in `apps/web/src/App.jsx`. Built by reading each page and the
matching `apps/api/src/routes/v1/*.routes.js` + controller (Phase 2, fix/phase-2-pages).
Every API response is `{ success, data, message }`; pages unwrap `res.data.data`.

Roles key: **MA** Master Admin · **AMA** Assistant Master Admin (only explicitly granted
permissions) · **SA** Super Admin · **AD** Admin · **US** User.

Status: **works** · **empty-by-data**
(works, but shows nothing until data exists).

| Route | Page file | API endpoints | Permission (route guard = API) | Roles that see it | Status | Notes |
|---|---|---|---|---|---|---|
| `/login` | auth/LoginPage.jsx | POST /auth/login, POST /auth/login/verify-otp | public | all | works | Returns to the attempted URL (`next` / router state); open-redirect safe. |
| `/forgot-password` | auth/ForgotPasswordPage.jsx | POST /auth/forgot-password | public | all | works | Never redirected to login by a stale session. |
| `/reset-password` | auth/ResetPasswordPage.jsx | POST /auth/reset-password | public | all | works | Browser autofill disabled on code/password fields. |
| `/change-password` | auth/ChangePasswordPage.jsx | POST /auth/change-password | authenticated | all | works | Forced (and the only reachable screen) while `mustChangePassword`; logout available. |
| `/dashboard` | dashboard/DashboardPage.jsx → role dashboards | GET /reports/dashboard, /reports/requests, /reports/financial, /reports/recent-activity, /reports/provider, GET /settings/ESTAMP_PROVIDER_LOW_BALANCE_THRESHOLD; USER: GET /estamps, GET /orders | report.view (USER dashboard: estamp.view / order.view) | all | works | Each panel loads, fails and retries on its own. Tiles shown only with permission. AMA waits for a full 24-char org id. |
| `/estamps/requests` | estamps/RequestsListPage.jsx | GET /estamps `{page,limit,status,stateCode,search,dateFrom,dateTo}` → `{items,total}` | estamp.view | MA, AMA*, SA, AD, US | works | Debounced search; error + Retry. |
| `/estamps/requests/new` | estamps/NewRequestPage.jsx | GET /wallet/balance, GET /articles/states, GET /articles?stateCode, POST /estamps/calculate, POST /estamps | estamp.create + tenant role | SA, AD, US | works | Internal roles blocked (no org wallet). Submit disabled on insufficient balance; wallet link only with wallet.view. Goes to request detail after submit. |
| `/estamps/requests/:id` | estamps/RequestDetailPage.jsx | GET /estamps/:id, GET /orders/:orderId, PATCH /estamps/:id, POST /estamps/:id/cancel | estamp.view (edit: estamp.modify, cancel: estamp.cancel) | MA, AMA*, SA, AD, US | works | m:ss countdown; Edit/Cancel close at 0 and are hidden without permission. |
| `/estamps/bulk` | estamps/BulkEStampPage.jsx | GET /bulk-estamps `{page,limit}`, GET /bulk-estamps/template (blob) | estamp.bulk_create | MA (view), SA, AD | works / empty-by-data | Template downloads with auth. Create hidden for internal roles. |
| `/estamps/bulk/new` | estamps/BulkUploadWizard.jsx | POST /bulk-estamps/upload, GET /bulk-estamps/:id, POST /bulk-estamps/:id/confirm | estamp.bulk_create + tenant role | SA, AD | works | Row-by-row validation errors; structural failure keeps the batch (4xx details now kept in production). |
| `/estamps/bulk/:batchId` | estamps/BulkBatchDetailPage.jsx | GET /bulk-estamps/:id, POST …/confirm, POST …/cancel | estamp.bulk_create | MA, SA, AD | works | 404 → not found; other errors → Retry. Polls while PROCESSING. |
| `/estamps` | estamps/EStampsPage.jsx | GET /orders `{eStampStatus:ISSUED,page,limit,sortBy,sortDir,search,stateCode,dateFrom,dateTo}`, GET /articles/states, GET /files/estamp/:orderId/download | estamp.view (Download: estamp.download) | MA, AMA*, SA, AD, US | empty-by-data | Issued orders only; debounced search, state and date filters, pagination. Download fetches the signed URL as a blob. Read-only for every role. Empty until the provider issues an E-Stamp (mock provider today). |
| `/organizations` | organizations/OrganizationsListPage.jsx | GET /organizations | client.view + internal role | MA, AMA* | works | |
| `/organizations/new` | organizations/CreateOrganizationPage.jsx | POST /organizations | client.manage + internal role | MA, AMA* | works | |
| `/organizations/:id` | organizations/OrganizationDetailPage.jsx | GET /organizations/:id, PATCH /organizations/:id, PATCH …/status (MA only), POST …/super-admin | client.view + internal role | MA, AMA* | works | Status buttons MA-only; empty phone omitted when provisioning. |
| `/assistant-admins` | assistants/AssistantAdminsPage.jsx | GET /users?role=ASSISTANT_MASTER_ADMIN, POST /users/assistant-admins, PATCH /users/:id/status, PATCH /users/:id/permissions | MASTER_ADMIN role | MA | works | Temp password shown once (dismissible). Permissions modal sends the full set (grants and revokes). Clear 403/409/429 messages. |
| `/users` | users/UsersListPage.jsx | GET /users `{page,limit,search,role,status}`, PATCH /users/:id/status | user.view | MA, SA, AD | works | URL drives role filter/title/button; only manageable roles offered; tenant-scoped by the API. |
| `/users/new` | users/CreateUserPage.jsx | POST /users | user.create | MA, SA | works | Role from `?role=`, limited to creatable roles. |
| `/users/:id` | users/EditUserPage.jsx | GET /users/:id, PATCH /users/:id, PATCH /users/:id/role | user.view (edit: user.manage) | MA, SA, AD | works | Read-only for ADMIN; empty phone omitted; no reload flash; Retry. |
| `/orders` | orders/OrdersListPage.jsx | GET /orders, GET /orders/summary | order.view | MA, AMA*, SA, AD, US | works / empty-by-data | Status cards filter the table; summary failure doesn't hide the table; Retry. |
| `/orders/:id` | orders/OrderDetailPage.jsx | GET /orders/:id, POST /orders/:id/process\|sync, GET /files/estamp/:id/download | order.view | MA, AMA*, SA, AD, US | works | Actions gated by server `availableActions`; Retry. |
| `/estamp-provider` | provider/EStampProviderPage.jsx | GET /estamp-provider/balance, /usage, POST /balance/refresh | estamp_provider.view | MA | works | |
| `/articles` | articles/ArticlesPage.jsx | GET /articles, POST /articles, PATCH /articles/:id/status, POST /articles/:id/versions | article.view (write: article.manage) | all | works / empty-by-data | Only FIXED/PERCENTAGE offered; amount required. |
| `/payments` | wallet/PaymentsListPage.jsx | GET /payments `{page,limit,organizationId,status,search,dateFrom,dateTo}` | payment.view | MA, AMA*, SA | works / empty-by-data | End date now inclusive. |
| `/payments/:id` | wallet/PaymentDetailPage.jsx | GET /payments/:id | payment.view | MA, AMA*, SA | works | Malformed id → 404 (was 500). |
| `/wallet` | wallet/WalletPage.jsx | GET /wallet[/:org]/balance, /transactions, GET /payments, GET /reports/financial, POST /payments/razorpay/order, POST /payments/razorpay/verify | wallet.view | MA, AMA*, SA | works | Key from API, script lazy + retryable; never credits client-side; failed sections cleared on org switch. |
| `/reports` | reports/ReportsPage.jsx | GET /reports/dashboard, requests, orders, financial, organizations, bulk, provider | report.view | MA, AMA*, SA, AD | works | One "unavailable" message when REPORTS_ENABLED=false (503); org id validated. No exports exist. |
| `/notifications` | notifications/NotificationsPage.jsx | GET /notifications, PATCH /notifications/:id/read, POST /notifications/read-all | authenticated | all (via bell "View all"; MA also in sidebar) | works / empty-by-data | Links: orders, payments, bulk batches. |
| `/audit` | audit/AuditLogsPage.jsx | GET /audit `{page,limit,action,entityType,organizationId,dateFrom,dateTo}` | audit.view | MA, AMA*, SA, AD | works | Full action list; debounced filters; metadata redacted. |
| `/audit/mine` | audit/MyActivityPage.jsx | GET /audit/mine | authenticated | all (sidebar "My Activity") | works | Retry added. |
| `/policies` | policies/PolicyPage.jsx | GET /policies/:type/current, GET /policies/acknowledgements/mine, POST /policies/acknowledge | authenticated | all | empty-by-data | Shows "no published policy" until one is published — see below. |
| `/policies/manage` | policies/PolicyAdminPage.jsx | GET /policies/:type/history, POST /policies, POST /policies/:id/publish | policy.view (create/publish: policy.manage) | MA, AMA* | works | |
| `/settings` | settings/SystemSettingsPage.jsx | GET /settings, PATCH /settings/:key | settings.view | MA, AMA* | works | |
| `/organization/profile` | organizations/CompanyProfilePage.jsx | GET /profile/organization | SUPER_ADMIN role | SA | works | Read-only own organization; 404 → "No company linked". |
| `/about` | about/AboutPage.jsx | — | authenticated | SA | works | Static; support email and description are constants at the top of the file. |
| `/profile` | profile/ProfilePage.jsx | GET /auth/me, PATCH /profile, POST /auth/change-password | authenticated | all | works | Email/role read-only. Password change reuses the shared ChangePasswordForm. |
| `/` | — | — | — | — | works | Redirects to `/dashboard`. |
| `*` | NotFoundPage.jsx | — | — | all | works | Real 404 page. |

\* AMA only when that permission has been explicitly granted.

## Policies: getting the first ones live

A fresh `npm run seed:api` creates a published placeholder per type, but only on an empty
database (it stops once a Master Admin exists). For an existing database:

1. `npm run seed:policies --workspace=apps/api` creates a **DRAFT** v0.1 for every policy type
   that has no version yet. The text says "DRAFT - REPLACE BEFORE LAUNCH". Nothing is published.
2. As Master Admin: Manage Policies → pick the type → New draft (a new version number, e.g. `1.0`)
   with the approved legal text → Publish. Until then `/policies` shows its empty state.

## Known gaps (not fixed in Phase 2)

- No server-side check stops a `mustChangePassword` user calling other APIs directly; only the UI enforces the forced change.
- Assistant Master Admins without global report access must paste an organization id (no picker).
- Audit metadata is redacted in the UI only; there is no server-side redaction.

`/files/upload` and `/files/download` were removed in Phase 3: they duplicated Orders (upload) and E-Stamps (download).
