# Temporary password reveal

A Master Admin can see the **system-generated temporary password** of an account until the user sets
their own. A password a user chose is never stored reversibly and can never be shown.

## Key

`CREDENTIAL_ENCRYPTION_KEY`: 32 random bytes, base64-encoded. Generate one with:

```
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Set it **only in the Railway service variables** for the API (never commit it, never put it in a frontend
variable), then redeploy. `.env.example` contains an empty placeholder.

If the key is missing or not 32 bytes the feature is off:

- a warning is logged at startup (the API still starts);
- accounts are still created and the temporary password is shown once in the create/reset response;
- nothing is stored, every list shows `passwordState: "SET_BY_USER"`, and
  `GET /users/:id/temporary-password` answers 404 `CREDENTIAL_REVEAL_UNAVAILABLE`.

## What is stored

On the user document, both hidden from every query unless explicitly selected:

- `initialPasswordEnc { ciphertext, iv, tag, createdAt }`: AES-256-GCM, a random 12-byte IV per value, the
  user id as associated data, so a value copied onto another user does not decrypt;
- `tempPasswordExpiresAt`: `createdAt` + 7 days, used only to show `passwordState` in lists.

It is written whenever the system generates a temporary password: one-step organization onboarding
(Super Admin), Super Admin provisioning, `POST /users` (client users), Assistant Master Admin creation, vendor
creation and the Master Admin vendor **Reset password**. It is never written for a password the user typed.

## When it is purged

- the user changes their password (including the forced first-login change) or completes Forgot password;
- the account is deleted (vendor hard or soft delete);
- 7 days after it was generated: checked when it is read, and by an hourly job;
- the stored value can no longer be decrypted (wrong or rotated key, tampering).

Deactivating an account does **not** purge it.

## Who can see it

`GET /users/:id/temporary-password` is **MASTER_ADMIN only** (403 for every other role), for target roles
VENDOR, ASSISTANT_MASTER_ADMIN, SUPER_ADMIN, ADMIN and USER, never for a MASTER_ADMIN. Responses are
`Cache-Control: no-store`, rate-limited per actor (30 / 15 min), and every reveal is audited as
`CREDENTIAL_REVEALED` (actor + target id/role, never the password). The password never appears in a list
response, log line, audit entry, notification or email. In the UI it is fetched only on **Show** or **Copy**,
hidden again after 30 seconds and dropped when you leave the page.

## Rotating the key

1. Generate a new key (command above).
2. Replace `CREDENTIAL_ENCRYPTION_KEY` in Railway and redeploy.
3. Values encrypted with the old key can no longer be read; each is purged the first time someone tries to
   reveal it, and the rest expire within 7 days. Affected users keep their temporary password (it still works
   for login). If you need to hand one over again, use **Reset password** (vendors) or have the user use
   **Forgot password**.

To turn the feature off, remove the variable and redeploy; existing stored values stop being readable and
age out the same way.
