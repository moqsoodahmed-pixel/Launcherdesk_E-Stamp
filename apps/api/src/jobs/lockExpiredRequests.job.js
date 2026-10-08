"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runLockExpiredRequestsJob = runLockExpiredRequestsJob;
const estamp_request_service_1 = require("../services/estamp-request.service");
const logger_1 = require("../utils/logger");
// Backend-authoritative enforcement of the 20-minute modify/cancel window.
// Run this on an interval (e.g. via a simple setInterval in server.ts for
// Phase 1, or a proper scheduler/cron in production).
async function runLockExpiredRequestsJob() {
    const count = await estamp_request_service_1.EStampRequestService.lockExpiredRequests();
    if (count > 0)
        logger_1.logger.info(`Locked ${count} expired E-Stamp request(s)`);
}
