"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = require("./app");
const db_1 = require("./config/db");
const env_1 = require("./config/env");
const logger_1 = require("./utils/logger");
const lockExpiredRequests_job_1 = require("./jobs/lockExpiredRequests.job");
const credentialVault_1 = require("./utils/credentialVault");
async function main() {
    await (0, db_1.connectDB)();
    const app = (0, app_1.createApp)();
    app.listen(env_1.env.PORT, () => {
        logger_1.logger.info(`LauncherDesk E-Stamping API listening on port ${env_1.env.PORT} [${env_1.env.NODE_ENV}]`);
    });
    // Phase 1: simple in-process interval. Replace with a proper job
    // scheduler (e.g. node-cron / BullMQ) if running multiple instances.
    setInterval(() => {
        (0, lockExpiredRequests_job_1.runLockExpiredRequestsJob)().catch((err) => logger_1.logger.error("lockExpiredRequests job failed", { message: err.message }));
    }, 60 * 1000);
    // Temporary-password reveal: warn once at startup if disabled, and purge
    // values older than 7 days every hour (also checked lazily on read).
    (0, credentialVault_1.isEnabled)();
    setInterval(() => {
        (0, credentialVault_1.purgeExpiredTemporaryPasswords)().catch((err) => logger_1.logger.error("purgeExpiredTemporaryPasswords job failed", { message: err.message }));
    }, 60 * 60 * 1000);
}
main().catch((err) => {
    logger_1.logger.error("Fatal startup error", { message: err.message });
    process.exit(1);
});
