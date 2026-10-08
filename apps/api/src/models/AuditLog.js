"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuditLog = void 0;
const mongoose_1 = require("mongoose");
const auditLogSchema = new mongoose_1.Schema({
    actorId: { type: mongoose_1.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    actorRole: { type: String, required: true },
    // Phase 15 - additive, backward-compatible actor classification. Every
    // pre-existing record implicitly WAS a human-attributed action (the only
    // "system" signal before this was the magic string "SYSTEM_WEBHOOK" in
    // actorRole), so defaulting to "USER" is directionally correct for old
    // data without a migration. Lets the audit LIST API filter on
    // actorType=SYSTEM cleanly instead of matching a growing list of
    // magic actorRole strings. actorRole itself is left untouched/unremoved
    // for the same system events, since other code/tests may already depend
    // on "SYSTEM_WEBHOOK" appearing there.
    actorType: { type: String, enum: ["USER", "SYSTEM"], default: "USER", index: true },
    organizationId: { type: mongoose_1.Schema.Types.ObjectId, ref: "Organization", default: null, index: true },
    action: { type: String, required: true, index: true },
    entityType: { type: String },
    entityId: { type: String },
    ip: { type: String },
    userAgent: { type: String },
    metadata: { type: mongoose_1.Schema.Types.Mixed },
}, { timestamps: { createdAt: true, updatedAt: false } });
auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ actorId: 1, createdAt: -1 });
exports.AuditLog = (0, mongoose_1.model)("AuditLog", auditLogSchema);
