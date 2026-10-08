"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PolicyAcknowledgement = exports.Policy = exports.PolicyType = exports.PolicyStatus = void 0;
const mongoose_1 = require("mongoose");
// Phase 16 - Terms/Privacy/Refund policy versioning mechanism. This is a
// SOFTWARE MECHANISM only - no approved legal content has been supplied
// anywhere in this repository (repo-wide search confirmed nothing). Actual
// `content` values must never be invented legal text - see policy.service.js
// and the seed script for the explicit placeholder convention used instead.
var PolicyType;
(function (PolicyType) {
    PolicyType["TERMS"] = "TERMS";
    PolicyType["PRIVACY"] = "PRIVACY";
    PolicyType["REFUND"] = "REFUND";
})(PolicyType || (exports.PolicyType = PolicyType = {}));
var PolicyStatus;
(function (PolicyStatus) {
    PolicyStatus["DRAFT"] = "DRAFT";
    PolicyStatus["PUBLISHED"] = "PUBLISHED";
    PolicyStatus["SUPERSEDED"] = "SUPERSEDED";
    PolicyStatus["ARCHIVED"] = "ARCHIVED";
})(PolicyStatus || (exports.PolicyStatus = PolicyStatus = {}));
const policySchema = new mongoose_1.Schema({
    // No separate field-level index here - the {type:1,version:1} compound
    // index below already serves type-only lookups (leftmost prefix), and a
    // bare {type:1} index would collide in name ("type_1") with the partial
    // unique index further down that also indexes {type:1}.
    type: { type: String, enum: Object.values(PolicyType), required: true },
    version: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true },
    // Plain text ONLY - rendered as plain React text content on the frontend
    // (never dangerouslySetInnerHTML). No HTML/Markdown parsing anywhere in
    // this feature, so there is no HTML/script injection surface to sanitize
    // in the first place.
    content: { type: String, required: true },
    status: { type: String, enum: Object.values(PolicyStatus), required: true, default: PolicyStatus.DRAFT },
    publishedAt: { type: Date, default: null },
    effectiveAt: { type: Date, default: null },
    supersededAt: { type: Date, default: null },
    publishedBy: { type: mongoose_1.Schema.Types.ObjectId, ref: "User", default: null },
    createdBy: { type: mongoose_1.Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });
// No two versions of the same policy type can collide.
policySchema.index({ type: 1, version: 1 }, { unique: true });
// THE concurrency-safety guarantee: at most one PUBLISHED document per policy
// type, enforced at the database level via a partial unique index (this
// codebase's established idiom for "atomic claim" safety - see
// bulk-estamp.service.js/estamp-request.service.js's findOneAndUpdate claims
// and their unique-index backstops; no Mongo transactions/sessions are used
// anywhere in this codebase, and this phase does not introduce them either).
policySchema.index({ type: 1 }, { unique: true, partialFilterExpression: { status: PolicyStatus.PUBLISHED } });
exports.Policy = (0, mongoose_1.model)("Policy", policySchema);
const policyAcknowledgementSchema = new mongoose_1.Schema({
    userId: { type: mongoose_1.Schema.Types.ObjectId, ref: "User", required: true },
    // Nullable - internal actors (Master Admin / Assistant Master Admin) have
    // no organization at all, unlike every tenant user.
    organizationId: { type: mongoose_1.Schema.Types.ObjectId, ref: "Organization", default: null },
    policyId: { type: mongoose_1.Schema.Types.ObjectId, ref: "Policy", required: true },
    // Denormalized so a query never needs to join back to Policy just to know
    // what was accepted.
    policyType: { type: String, enum: Object.values(PolicyType), required: true },
    policyVersion: { type: String, required: true },
    acceptedAt: { type: Date, required: true },
    ip: { type: String },
    userAgent: { type: String },
    context: { type: String, enum: ["LOGIN", "WALLET_FUNDING", "ESTAMP_REQUEST", "GENERAL"], default: "GENERAL" },
}, { timestamps: true });
// Both userId and policyId are ALWAYS present on every record - unlike the
// sparse-index trap this codebase hit in Phase 11/12 (a unique index over a
// field that can be null/absent silently only enforces uniqueness among the
// documents that HAVE the field, letting multiple nulls collide-free past
// it), there is no null-collision risk here: this index is unique and NOT
// sparse, and correctly so. This is what makes re-submission of the
// identical acceptance idempotent (E11000 on a duplicate -> the service
// returns the existing record, mirroring createRequest's idempotencyKey
// handling elsewhere in this codebase).
policyAcknowledgementSchema.index({ userId: 1, policyId: 1 }, { unique: true });
exports.PolicyAcknowledgement = (0, mongoose_1.model)("PolicyAcknowledgement", policyAcknowledgementSchema);
