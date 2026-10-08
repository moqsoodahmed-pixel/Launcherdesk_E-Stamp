# LauncherDesk E-Stamping — Phase 1 (JavaScript Edition)

A multi-tenant SaaS platform for managing E-Stamp requests across client organizations. This is the plain
**JavaScript** edition: **Vite + React (.jsx)** on the frontend, **Node.js + Express (.js)** on the backend —
no TypeScript, no build/type-check step required to run either app.

Suggested production URL: `https://launcherdesk.com/estamping`

## Stack

- **Frontend**: React 18, Vite, Tailwind CSS, React Router, Axios, React Hook Form + Zod, Recharts — all `.jsx`/`.js`
- **Backend**: Node.js, Express, Mongoose, JWT, Argon2id, Helmet, CORS, rate limiting — all `.js` (CommonJS)
- **Database**: MongoDB
- **Integrations**: Brevo (email), Razorpay (payments), Cloudinary (files) — each behind a backend service
  with a DEV mock fallback if no credentials are configured

## Quick start

### Prerequisites
- Node.js 20+
- MongoDB 7 (local install, or `docker-compose up -d`)

### Setup

```bash
git clone <this-repo>
cd launcherdesk-estamping
npm install

cp .env.example apps/api/.env
# Edit apps/api/.env - at minimum set MONGODB_URI, JWT_SECRET, JWT_REFRESH_SECRET,
# and SEED_MASTER_ADMIN_PASSWORD.

docker-compose up -d      # starts MongoDB on localhost:27017
npm run seed:api          # creates the first Master Admin + demo org/users
npm run dev:api           # http://localhost:5000
npm run dev:web           # http://localhost:5173 (second terminal)
```

Seeded demo accounts (see console output after seeding for exact values):
- Master Admin — email/password from `SEED_MASTER_ADMIN_EMAIL` / `SEED_MASTER_ADMIN_PASSWORD`
- Assistant Master Admin — `assistant@launcherdesk.local` / `ChangeMe!Assistant1`
- Super Admin — `superadmin@democlient.local` / `ChangeMe!SuperAdmin1`
- Admin — `admin@democlient.local` / `ChangeMe!Admin1`
- User — `employee@democlient.local` / `ChangeMe!User1`

All seed accounts except Master Admin have `mustChangePassword: true`. These are synthetic dev-only
credentials — never use them in a deployed environment.

## Project structure

```
launcherdesk-estamping/
├── apps/
│   ├── web/     React (.jsx) + Vite + Tailwind frontend
│   └── api/     Express (.js) + Mongoose backend
├── packages/
│   ├── shared/      Role hierarchy, permissions, enums (CommonJS, shared by the backend & its tests)
│   ├── validation/  Zod schemas used by the backend
│   └── config/      Shared non-secret default configuration
├── docs/        Architecture, database, API, roles/permissions, security, deployment, scope docs
└── docker-compose.yml   Local MongoDB
```

**Note on `packages/`:** the backend consumes these as CommonJS workspace packages (`require("@launcherdesk/shared")`,
etc.) via npm workspaces. The frontend does **not** import them directly — the one schema it needs
(`createEStampRequestSchema`) is duplicated as a small local ES module at
`apps/web/src/schemas/estampRequest.schema.js`, kept in sync by hand with `packages/validation/src/index.js`.
This keeps the Vite build a clean, dependency-free ESM bundle with zero CommonJS/ESM interop friction — if you
add more shared validation used by both apps, either keep duplicating the specific schema (simple, explicit)
or convert `packages/validation` to a dual-format package (more setup, not needed for Phase 1's scope).

## Available scripts (run from repo root)

| Script | Description |
|---|---|
| `npm run dev:api` | Run the backend with nodemon (auto-restart on change) |
| `npm run dev:web` | Run the Vite dev server |
| `npm run build:web` | Build the frontend to `apps/web/dist` |
| `npm run test:api` | Run the backend test suite (Vitest + in-memory MongoDB) |
| `npm run seed:api` | Seed Master Admin, a demo organization, and one user per role |

The backend has no build step — `node src/server.js` (or `npm start` inside `apps/api`) runs it directly.

## Environment variables

See `.env.example` at the repo root for the full list with comments. Copy it to `apps/api/.env`. Every
external integration (Brevo, Razorpay, Cloudinary, the E-Stamp provider) has a DEV mock fallback that logs a
warning and continues, so the app runs end-to-end even with no real credentials configured — see
`docs/phase-1-scope.md` for exactly what's mocked and why.

## Testing

```bash
npm run test:api
```

Covers: wallet double-credit/double-spend prevention, tenant isolation between organizations, the 20-minute
modification/cancellation window, OTP expiry/single-use, the stamp duty calculation engine, and
role/permission defaults. The DB-backed tests use `mongodb-memory-server`, which downloads a MongoDB binary
on first run — needs normal outbound internet access the first time you run it.

## Documentation

See `docs/` — architecture, database schema, API reference, roles/permissions matrix, security, deployment
notes, and Phase 1 scope (what's fully built vs. a documented extension point for Phase 2).
