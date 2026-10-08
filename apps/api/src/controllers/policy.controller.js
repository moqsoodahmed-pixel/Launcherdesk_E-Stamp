"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMyAcknowledgements = exports.acknowledgePolicy = exports.publishPolicy = exports.createPolicyDraft = exports.getPolicyVersion = exports.getPolicyHistory = exports.getCurrentPolicy = void 0;
const asyncHandler_1 = require("../utils/asyncHandler");
const ApiResponse_1 = require("../utils/ApiResponse");
const policy_service_1 = require("../services/policy.service");
// PUBLIC - no authenticate. Mirrors app.js's /health pre-authentication
// mounting (see policy.routes.js's header comment for exactly how this one
// route avoids the router-wide authenticate gate). Never reads req.user.
// Returns ONLY safe public fields - never createdBy/publishedBy/internal
// audit trail data.
exports.getCurrentPolicy = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const current = await policy_service_1.PolicyService.getCurrentPublicShape(req.params.type?.toUpperCase());
    // Honest "not published yet" - never a 401, never a fabricated document.
    return (0, ApiResponse_1.ok)(res, current);
});
exports.getPolicyHistory = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const result = await policy_service_1.PolicyService.getHistory(req.params.type?.toUpperCase(), req.query);
    return (0, ApiResponse_1.ok)(res, result);
});
exports.getPolicyVersion = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const doc = await policy_service_1.PolicyService.getVersion(req.params.type?.toUpperCase(), req.params.version);
    return (0, ApiResponse_1.ok)(res, doc);
});
exports.createPolicyDraft = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const draft = await policy_service_1.PolicyService.createDraft({
        ...req.body,
        createdBy: req.user.id,
        actorRole: req.user.role,
        req,
    });
    return (0, ApiResponse_1.created)(res, draft);
});
exports.publishPolicy = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const published = await policy_service_1.PolicyService.publish(req.params.id, req.user.id, req.user.role, req);
    return (0, ApiResponse_1.ok)(res, published);
});
// Accepting a policy is a normal user action, not an admin action - any
// authenticated user may call this. userId/organizationId are ALWAYS
// resolved from req.user (the authenticated session), never from the
// request body - a client can never forge who is accepting or on whose
// behalf.
exports.acknowledgePolicy = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const ack = await policy_service_1.PolicyService.acknowledge({
        userId: req.user.id,
        organizationId: req.user.organizationId,
        actorRole: req.user.role,
        policyType: req.body.policyType,
        acknowledgedVersion: req.body.acknowledgedVersion,
        context: req.body.context,
        req,
    });
    return (0, ApiResponse_1.created)(res, ack);
});
exports.getMyAcknowledgements = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const result = await policy_service_1.PolicyService.getMyAcknowledgements(req.user.id, req.query);
    return (0, ApiResponse_1.ok)(res, result);
});
