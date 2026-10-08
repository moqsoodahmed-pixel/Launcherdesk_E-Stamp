# Role & Permission Matrix

## Hierarchy (Level 1 = highest authority)

| Level | Role | Belongs to |
|---|---|---|
| 1 | MASTER_ADMIN | Our company (internal) |
| 2 | ASSISTANT_MASTER_ADMIN | Our company (internal) |
| 3 | SUPER_ADMIN | Client organization (owner) |
| 4 | ADMIN | Client organization |
| 5 | USER | Client organization (employee) |

`organizationId` is `null` for internal roles and required for tenant roles. This is enforced at the model
level (`User.organizationId`) and checked by `requireOrganizationAccess` on every tenant-scoped route.

## Default permissions by role

| Permission | Master Admin | Asst. Master Admin | Super Admin | Admin | User |
|---|:---:|:---:|:---:|:---:|:---:|
| client.view / client.manage | ✅ | ✅ | ❌ | ❌ | ❌ |
| user.view / user.create / user.manage | ✅ | ❌ | ✅ | user.view only | ❌ |
| estamp.create | ✅ | ❌ | ✅ | ✅ | ✅ |
| estamp.view | ✅ | ✅ | ✅ | ✅ | ✅ (own only) |
| estamp.modify / estamp.cancel | ✅ | ❌ | ✅ | ✅ (modify) | ❌ |
| estamp.upload / estamp.download | ✅ | ✅ | download only | download only | download only |
| article.view | ✅ | ✅ | ✅ | ✅ | ✅ |
| article.manage | ✅ | ❌ | ❌ | ❌ | ❌ |
| payment.view | ✅ | ❌ | ✅ | ❌ | ❌ |
| wallet.view / wallet.manage | ✅ | view + manage | view | ❌ | ❌ |
| order.view / order.manage | ✅ | view | view | view | view |
| report.view | ✅ | ✅ | ✅ | ✅ | ❌ |
| audit.view | ✅ | ❌ (only `/audit/mine`) | ❌ | ❌ | ❌ |
| settings.view / settings.manage | ✅ | ❌ | ❌ | ❌ | ❌ |

Exact default sets live in `packages/shared/src/permissions.js` (`DEFAULT_ROLE_PERMISSIONS`).

**Important distinction (Assistant Master Admin is NOT combined, it is overridden):** For every role except
`ASSISTANT_MASTER_ADMIN`, effective permissions = role defaults **plus** any extra grants stored on
`User.permissions`. For `ASSISTANT_MASTER_ADMIN`, effective permissions = **only** whatever is stored on
`User.permissions` — the table above is merely the *starting template* applied when Master Admin creates a
new Assistant Master Admin (`POST /api/v1/users/assistant-admins`). Master Admin can subsequently grant or
**revoke** any individual permission via `PATCH /api/v1/users/:id/permissions` (a full overwrite, not a
merge). This is deliberate: it is the only way a permission, once granted, can later be taken away from an
Assistant Master Admin. The single implementation of this rule is `getEffectivePermissions()` in
`packages/shared/src/permissions.js`, used by `middleware/authenticate.js`.

## Explicit "must not" rules enforced

- Super Admin / Admin / User can never read or write another organization's data — enforced by
  `requireOrganizationAccess`, which derives the organization strictly from the session.
- Only Master Admin can create/modify Articles or their calculation rules.
- Only Master Admin can view the global Audit Log (`GET /api/v1/audit`); Assistant Master Admin can see only
  their own activity (`GET /api/v1/audit/mine`).
- A creator can only create a user whose role is strictly below their own authority level
  (`ROLE_LEVEL` check in `user.controller.ts`) — an Admin cannot create another Admin or a Super Admin, etc.
- Master Admin registration has no public endpoint; it is only created via the guarded seed script.
- Assistant Master Admin accounts can likewise only be created by Master Admin
  (`POST /api/v1/users/assistant-admins`) — the generic `POST /api/v1/users` endpoint's schema only accepts
  `SUPER_ADMIN | ADMIN | USER`, so it can never be used to mint an internal admin account of either kind.
- Only Master Admin can call `PATCH /api/v1/users/:id/permissions`; an Assistant Master Admin cannot reach
  this route under any permission, so it can never grant itself (or another Assistant Master Admin) more
  access — and the controller additionally refuses a caller editing their own record as defense in depth.

## Assistant Master Admin oversight

Every Assistant Master Admin action listed in the Phase 1 spec (login, client CRUD, balance changes,
uploads/downloads, order/user changes, etc.) is:
1. Written to `AuditLog` (`actorRole: ASSISTANT_MASTER_ADMIN`).
2. Fanned out as a `Notification` to every active Master Admin (`notification.service.ts`,
   `notifyAllMasterAdmins`), so it is visible in near-real-time, not just retrievable after the fact.