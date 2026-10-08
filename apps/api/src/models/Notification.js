"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Notification = void 0;
const mongoose_1 = require("mongoose");
const shared_1 = require("@launcherdesk/shared");
const notificationSchema = new mongoose_1.Schema({
    recipientId: { type: mongoose_1.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    recipientRole: { type: String, required: true },
    type: { type: String, enum: Object.values(shared_1.NotificationType), required: true },
    // IN_APP is implicit for every row here (this collection IS the in-app
    // notification store); EMAIL/BOTH record that an email was also
    // dispatched for this same event (see email.service.js's own EmailLog
    // for the email's own delivery status - this field is just a marker).
    channel: { type: String, enum: ["IN_APP", "EMAIL", "BOTH"], default: "IN_APP" },
    title: { type: String, required: true },
    message: { type: String, required: true },
    metadata: { type: mongoose_1.Schema.Types.Mixed },
    // Structured deep-link target ONLY - never a raw URL. The frontend
    // constructs a known-safe route from (entityType, entityId) itself; it
    // never renders a client- or notification-supplied URL directly.
    entityType: { type: String },
    entityId: { type: mongoose_1.Schema.Types.ObjectId },
    relatedActorId: { type: mongoose_1.Schema.Types.ObjectId, ref: "User" },
    organizationId: { type: mongoose_1.Schema.Types.ObjectId, ref: "Organization" },
    isRead: { type: Boolean, default: false, index: true },
    readAt: { type: Date },
    // Idempotency: "<businessEventKey>:<recipientId>" - set only for
    // notifications created in response to a (possibly retried) business
    // event, so a duplicated webhook/sync/retry can never fan out a second
    // in-app notification for the same event to the same recipient. Sparse
    // because ad-hoc/one-off notifications don't need this guarantee.
    eventKey: { type: String },
}, { timestamps: { createdAt: true, updatedAt: false } });
notificationSchema.index({ recipientId: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ eventKey: 1 }, { unique: true, sparse: true });
exports.Notification = (0, mongoose_1.model)("Notification", notificationSchema);
