# Deployment Preparation Notes

This repository targets local development today; no Dockerfile, CI pipeline, or hosting configuration ships
in this repo (verified as of Phase 20 — see `docs/production-readiness.md` for the full, evidence-based
release-readiness gate, including a categorized environment-variable list, secret-rotation guidance, and the
final blocker classification). Before deploying anywhere:

1. **TLS**: terminate HTTPS at a load balancer / reverse proxy (Nginx, Caddy, or your cloud provider's LB) —
   the Express app itself does not terminate TLS.
2. **Environment variables**: set every value in `.env.example` with real production secrets via your
   platform's secret manager, never in source control.
3. **MongoDB**: use a managed cluster (Atlas or equivalent) with authentication enabled, network restricted
   to the API's egress IPs, and automated backups.
4. **CORS**: `FRONTEND_URL` must be set to the exact production frontend origin.
5. **Rate limiting**: the in-process limiters in `middleware/rateLimiters.ts` are per-instance; if you run
   multiple API instances behind a load balancer, replace with a shared-store limiter (e.g. Redis-backed).
6. **Background job**: the 20-minute-window lock job currently runs via `setInterval` in `server.ts`. If you
   run more than one API instance, move this to a single dedicated worker or a distributed lock so it doesn't
   run redundantly (harmless, but wasteful) across instances.
7. **Logging**: ship Winston output to your log aggregation platform; confirm redaction rules
   (`utils/logger.ts`) match your compliance requirements before enabling verbose logging in production.
8. **Cloudinary**: switch delivery to authenticated/private URLs consistently; review the signed-URL expiry
   (`file.service.ts`, currently 5 minutes) against your UX needs.
9. **Razorpay webhooks**: a dedicated server-to-server webhook endpoint (`POST /api/v1/payments/webhook`,
   verified against `RAZORPAY_WEBHOOK_SECRET`, deliberately not behind session auth) exists alongside the
   client-returned-signature verification path — both are implemented as of this phase.
10. **Process management**: run under a process manager (PM2, systemd, or a container orchestrator) with
    restart-on-crash and health checks against `GET /health` (as of Phase 20 this also reports live MongoDB
    connection state as `db`, and `status` degrades to `"degraded"` when the database is not connected — a
    load balancer/uptime monitor should treat `"degraded"` as unhealthy, not just a non-2xx status code).
11. **E-Stamp provider**: `ESTAMP_PROVIDER` must be set to a real, implemented provider before production use.
    Left as `mock`/unset, the app refuses to start serving E-Stamp issuance in `NODE_ENV=production` rather
    than silently fabricating certificates (see `services/estamp-providers/index.js`). No real provider
    integration exists in this codebase yet — see `docs/production-readiness.md`'s "External Dependencies"
    section.
