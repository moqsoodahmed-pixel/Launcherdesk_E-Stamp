"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordAudit = recordAudit;
const models_1 = require("../models");
const logger_1 = require("../utils/logger");
// Central place every module MUST call to record an auditable event.
// Never pass passwords, OTP codes, tokens or payment secrets in metadata.
async function recordAudit(params) {
    try {
        await models_1.AuditLog.create({
            actorId: params.actorId,
            actorRole: params.actorRole,
            // Backward-compatible: every existing call site keeps working
            // unmodified. If a caller doesn't explicitly say, a null actorId
            // is inferred as a system-generated event (true for every call
            // site in this codebase today - see AuditLog.js's actorType
            // comment) and anything else defaults to "USER".
            actorType: params.actorType || (params.actorId == null ? "SYSTEM" : "USER"),
            organizationId: params.organizationId ?? null,
            action: params.action,
            entityType: params.entityType,
            entityId: params.entityId,
            ip: params.req?.ip,
            userAgent: params.req?.headers["user-agent"],
            metadata: params.metadata,
        });
    }
    catch (err) {
        // Audit failures must never crash the primary request flow, but must be loud in logs.
        logger_1.logger.error("Failed to write audit log", { action: params.action });
    }
}
