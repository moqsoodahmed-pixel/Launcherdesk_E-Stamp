# Database Schema Reference

All models are in `apps/api/src/models/`. Every model uses Mongoose timestamps (`createdAt`/`updatedAt`)
unless noted. Enums come from `@launcherdesk/shared` so they can't drift between backend and frontend.

| Model | Key fields | Notes |
|---|---|---|
| `User` | email (unique), passwordHash, role, organizationId, permissions[], tokenVersion, lastOtpVerifiedAt | organizationId is `null` for internal roles |
| `Organization` | name, contactEmail, status, isEstampServiceEnabled | status ∈ PENDING_APPROVAL/ACTIVE/RESTRICTED/SUSPENDED/DEACTIVATED |
| `OTP` | userId, purpose, codeHash (sha256), challengeToken (unique), expiresAt, attempts | TTL-indexed cleanup 1h after expiry; raw code never stored |
| `RefreshToken` | userId, tokenHash (sha256), tokenVersion, expiresAt, revokedAt | TTL-indexed on expiresAt |
| `Article` / `ArticleVersion` | stateCode+articleCode (unique), currentVersion / calculationRule (FIXED/PERCENTAGE/SLAB/CUSTOM) | Versionable — new rules append a version, never mutate history |
| `Wallet` | organizationId (unique), balance, version | One wallet per organization |
| `WalletTransaction` | organizationId, type, amount, balanceBefore/After, idempotencyKey (unique) | Append-only ledger |
| `Payment` | organizationId, razorpayOrderId (unique), status | Signature stored `select: false` |
| `EStampRequest` | requestNumber (unique), organizationId, status, modificationDeadline | State machine-governed status |
| `EStampOrder` | orderNumber (unique), requestId (unique), status, downloadStatus | 1:1 with EStampRequest |
| `FileAsset` | organizationId, cloudinaryPublicId, fileType, isPrivate | Private by default |
| `EStampDocument` | orderId (unique), downloadHistory[] | Tracks every download with actor/IP/UA |
| `Notification` | recipientId, type, isRead | Used for both user notifications and Master Admin activity feed |
| `AuditLog` | actorId, actorRole, action, organizationId?, metadata | Append-only; no delete/update route exists anywhere |
| `SystemSetting` | key (unique), value | Configurable operational values (OTP interval, modify window, etc.) |

## Indexing notes
- `User`: compound `(organizationId, role)` for fast tenant-scoped listing.
- `EStampRequest`: compound `(organizationId, createdAt)` and `(organizationId, status)`.
- `WalletTransaction`: unique on `idempotencyKey`, compound `(organizationId, createdAt)`.
- `AuditLog`: `(actorId, createdAt)` and a general `createdAt` index for the global Master Admin view.
