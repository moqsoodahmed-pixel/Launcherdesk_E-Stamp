"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PolicyService = void 0;
const models_1 = require("../models");
const ApiError_1 = require("../utils/ApiError");
const audit_service_1 = require("./audit.service");
const shared_1 = require("@launcherdesk/shared");
const Policy_1 = require("../models/Policy");
const SAFE_PUBLIC_FIELDS = ["_id", "type", "version", "title", "content", "status", "publishedAt", "effectiveAt"];
function toPublicShape(doc) {
    if (!doc)
        return null;
    const out = {};
    for (const field of SAFE_PUBLIC_FIELDS) {
        out[field === "_id" ? "policyId" : field] = field === "_id" ? doc._id.toString() : doc[field];
    }
    return out;
}
exports.PolicyService = {
    // Creates a new DRAFT version of a policy type. {type,version} uniqueness
    // is backed by the unique index on Policy - a duplicate insert surfaces
    // as E11000, caught below and translated into a clean 409 (never a raw
    // 500), matching this codebase's convention elsewhere (e.g. Article's
    // {stateCode,articleCode} unique index).
    async createDraft({ type, version, title, content, createdBy, actorRole, req }) {
        if (!Object.values(Policy_1.PolicyType).includes(type)) {
            throw ApiError_1.ApiError.badRequest("Unknown policy type", "INVALID_POLICY_TYPE");
        }
        let draft;
        try {
            draft = await models_1.Policy.create({ type, version, title, content, createdBy, status: Policy_1.PolicyStatus.DRAFT });
        }
        catch (err) {
            if (err?.code === 11000) {
                throw ApiError_1.ApiError.conflict(`Policy ${type} version ${version} already exists`, "POLICY_VERSION_EXISTS");
            }
            throw err;
        }
        await (0, audit_service_1.recordAudit)({
            actorId: createdBy,
            actorRole: actorRole || "UNKNOWN",
            action: shared_1.AuditAction.POLICY_CREATED,
            entityType: "Policy",
            entityId: draft._id.toString(),
            metadata: { type: draft.type, version: draft.version },
            req,
        });
        return draft;
    },
    // Atomic supersede-then-publish. Never allows editing a
    // PUBLISHED/SUPERSEDED/ARCHIVED document's content/title/version - the
    // only legitimate way to change published content is a new DRAFT version.
    async publish(policyId, actorId, actorRole, req) {
        const draft = await models_1.Policy.findById(policyId);
        if (!draft) {
            throw ApiError_1.ApiError.notFound("Policy version not found");
        }
        if (draft.status !== Policy_1.PolicyStatus.DRAFT) {
            throw ApiError_1.ApiError.conflict("Only a DRAFT version can be published", "POLICY_NOT_DRAFT");
        }
        const now = new Date();
        // Step 1: supersede whatever is currently published for this type, if
        // anything. This is a best-effort precondition check, not the actual
        // safety guarantee - the partial unique index on Policy is.
        await models_1.Policy.findOneAndUpdate({ type: draft.type, status: Policy_1.PolicyStatus.PUBLISHED }, { status: Policy_1.PolicyStatus.SUPERSEDED, supersededAt: now });
        // Step 2: flip the target draft to PUBLISHED. If a concurrent publish
        // raced us between step 1 and here (both saw "nothing published" and
        // both tried to become the published one), the partial unique index
        // rejects the loser with E11000 - caught below as a clean conflict,
        // never a raw 500 and never two simultaneously-published versions.
        let published;
        try {
            published = await models_1.Policy.findOneAndUpdate({ _id: draft._id, type: draft.type, status: Policy_1.PolicyStatus.DRAFT }, { status: Policy_1.PolicyStatus.PUBLISHED, publishedAt: now, effectiveAt: now, publishedBy: actorId }, { new: true });
        }
        catch (err) {
            if (err?.code === 11000) {
                throw ApiError_1.ApiError.conflict("A newer version was published concurrently; refresh and retry", "POLICY_ALREADY_PUBLISHED");
            }
            throw err;
        }
        if (!published) {
            // Someone else already published/moved this exact draft out of DRAFT
            // between our read and our write.
            throw ApiError_1.ApiError.conflict("A newer version was published concurrently; refresh and retry", "POLICY_ALREADY_PUBLISHED");
        }
        await (0, audit_service_1.recordAudit)({
            actorId,
            actorRole: actorRole || "UNKNOWN",
            action: shared_1.AuditAction.POLICY_PUBLISHED,
            entityType: "Policy",
            entityId: published._id.toString(),
            // Safe metadata only - never the content itself.
            metadata: { type: published.type, version: published.version },
            req,
        });
        return published;
    },
    // Returns the single PUBLISHED document for this type, or null if none
    // exists yet - never fabricates one.
    async getCurrent(type) {
        if (!Object.values(Policy_1.PolicyType).includes(type)) {
            throw ApiError_1.ApiError.badRequest("Unknown policy type", "INVALID_POLICY_TYPE");
        }
        return models_1.Policy.findOne({ type, status: Policy_1.PolicyStatus.PUBLISHED });
    },
    async getCurrentPublicShape(type) {
        const current = await this.getCurrent(type);
        return toPublicShape(current);
    },
    // Full internal history (all statuses, including drafts) - authenticated
    // + POLICY_VIEW only.
    async getHistory(type, { page = 1, limit = 20 } = {}) {
        if (!Object.values(Policy_1.PolicyType).includes(type)) {
            throw ApiError_1.ApiError.badRequest("Unknown policy type", "INVALID_POLICY_TYPE");
        }
        const safePage = Math.max(1, parseInt(page, 10) || 1);
        const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
        const filter = { type };
        const [items, total] = await Promise.all([
            models_1.Policy.find(filter).sort({ createdAt: -1 }).skip((safePage - 1) * safeLimit).limit(safeLimit),
            models_1.Policy.countDocuments(filter),
        ]);
        return { items, total, page: safePage, limit: safeLimit };
    },
    async getVersion(type, version) {
        if (!Object.values(Policy_1.PolicyType).includes(type)) {
            throw ApiError_1.ApiError.badRequest("Unknown policy type", "INVALID_POLICY_TYPE");
        }
        const doc = await models_1.Policy.findOne({ type, version });
        if (!doc) {
            throw ApiError_1.ApiError.notFound("Policy version not found");
        }
        return doc;
    },
    // Resolves the CURRENT published version of `policyType` server-side -
    // never trusts a client-supplied version/policyId. `acknowledgedVersion`
    // is purely an optional client-side display-reconciliation value: if
    // supplied and it disagrees with what is actually current, the request is
    // rejected with a clear "the policy has changed, please review the latest
    // version" error rather than silently recording acceptance of a version
    // that is no longer current.
    async acknowledge({ userId, organizationId, policyType, acknowledgedVersion, context, actorRole, req }) {
        const current = await this.getCurrent(policyType);
        if (!current) {
            throw ApiError_1.ApiError.notFound("There is no published policy of this type to accept yet");
        }
        if (acknowledgedVersion && acknowledgedVersion !== current.version) {
            throw ApiError_1.ApiError.conflict("The policy has changed since you last viewed it; please review the latest version before accepting", "POLICY_VERSION_STALE");
        }
        const acceptedAt = new Date();
        let ack;
        try {
            ack = await models_1.PolicyAcknowledgement.create({
                userId,
                organizationId: organizationId || null,
                policyId: current._id,
                policyType: current.type,
                policyVersion: current.version,
                acceptedAt,
                ip: req?.ip,
                userAgent: req?.headers?.["user-agent"],
                context: context || "GENERAL",
            });
        }
        catch (err) {
            if (err?.code === 11000) {
                // Idempotent re-submission of the identical acceptance - return the
                // existing record rather than creating a second row.
                return models_1.PolicyAcknowledgement.findOne({ userId, policyId: current._id });
            }
            throw err;
        }
        await (0, audit_service_1.recordAudit)({
            actorId: userId,
            actorRole: actorRole || "UNKNOWN",
            organizationId: organizationId || undefined,
            action: shared_1.AuditAction.POLICY_ACKNOWLEDGED,
            entityType: "Policy",
            entityId: current._id.toString(),
            metadata: { type: current.type, version: current.version },
            req,
        });
        return ack;
    },
    async getMyAcknowledgements(userId, { page = 1, limit = 50 } = {}) {
        const safePage = Math.max(1, parseInt(page, 10) || 1);
        const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
        const filter = { userId };
        const [items, total] = await Promise.all([
            models_1.PolicyAcknowledgement.find(filter).sort({ acceptedAt: -1 }).skip((safePage - 1) * safeLimit).limit(safeLimit),
            models_1.PolicyAcknowledgement.countDocuments(filter),
        ]);
        return { items, total, page: safePage, limit: safeLimit };
    },
    // Whether `userId` has accepted the CURRENTLY published version of
    // `policyType`. Returns detail so a caller can distinguish "no published
    // policy exists" from "published, but not yet accepted" from "accepted".
    async hasAcceptedCurrent(userId, policyType) {
        const current = await this.getCurrent(policyType);
        if (!current) {
            return { hasPublished: false, accepted: false, current: null };
        }
        const ack = await models_1.PolicyAcknowledgement.findOne({ userId, policyId: current._id });
        return { hasPublished: true, accepted: !!ack, current };
    },
    // Ready to be wired into any flow that later needs to require current
    // policy acceptance - deliberately NOT called from anywhere in this
    // phase (see policy.controller.js's header comment / the Phase 16 final
    // report's "Enforcement" section for why).
    async assertAcceptedCurrent(userId, policyType) {
        const { accepted } = await this.hasAcceptedCurrent(userId, policyType);
        if (!accepted) {
            throw ApiError_1.ApiError.badRequest("Current policy acceptance is required", "CURRENT_POLICY_ACCEPTANCE_REQUIRED");
        }
    },
};
