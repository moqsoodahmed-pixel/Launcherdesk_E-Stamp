"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmailLog = void 0;
const mongoose_1 = require("mongoose");
// Lightweight internal record of outbound emails - NOT the message content.
// Purpose: (1) idempotency (a business event that's retried must not send
// the same email twice - enforced via a unique index on eventKey), and
// (2) an honest delivery-status trail (SENT means "accepted by the
// provider", never "delivered/opened" - this project has no delivery-
// confirmation webhook). Never stores OTP codes, reset tokens, passwords,
// or provider credentials - only the template name and recipient/subject.
const emailLogSchema = new mongoose_1.Schema({
    // "<eventKey>:<recipientEmail>" when an eventKey is supplied (business
    // events), or null for one-off sends with no dedup requirement (e.g. an
    // ad-hoc OTP resend, which already has its own resend-cooldown).
    eventKey: { type: String },
    template: { type: String, required: true },
    to: { type: String, required: true },
    subject: { type: String, required: true },
    status: { type: String, enum: ["QUEUED", "SENT", "FAILED"], required: true },
    provider: { type: String },
    errorMessage: { type: String }, // safe, human-readable only - never a raw provider payload/secret
    sentAt: { type: Date },
}, { timestamps: true });
// Sparse: only business-event-driven sends set eventKey, and only those need
// the duplicate-send guarantee.
emailLogSchema.index({ eventKey: 1 }, { unique: true, sparse: true });
exports.EmailLog = (0, mongoose_1.model)("EmailLog", emailLogSchema);
