"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticate = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const env_1 = require("../config/env");
const models_1 = require("../models");
const ApiError_1 = require("../utils/ApiError");
const asyncHandler_1 = require("../utils/asyncHandler");
const shared_1 = require("@launcherdesk/shared");
exports.authenticate = (0, asyncHandler_1.asyncHandler)(async (req, _res, next) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
        throw ApiError_1.ApiError.unauthorized("Missing authentication token");
    }
    const token = header.slice("Bearer ".length);
    let payload;
    try {
        // Phase 19 - explicitly pin the accepted signing algorithm rather than
        // relying on jsonwebtoken's default behavior. This app only ever
        // signs access tokens with HMAC/HS256 (see auth.service.js's
        // issueTokens) - pinning `algorithms` here is defense-in-depth against
        // any algorithm-confusion/downgrade attack (e.g. a forged token
        // claiming `alg: none` or an unexpected asymmetric algorithm), even
        // though the installed jsonwebtoken version already rejects `none`
        // by default.
        payload = jsonwebtoken_1.default.verify(token, env_1.env.JWT_SECRET, { algorithms: ["HS256"] });
    }
    catch {
        throw ApiError_1.ApiError.unauthorized("Invalid or expired token");
    }
    const user = await models_1.User.findById(payload.userId);
    if (!user || !user.isActive) {
        throw ApiError_1.ApiError.unauthorized("Account not found or deactivated");
    }
    if (user.tokenVersion !== payload.tokenVersion) {
        throw ApiError_1.ApiError.unauthorized("Session has been invalidated, please log in again");
    }
    // Tenant roles inherit their organization's lifecycle state on every
    // request - a suspended/deactivated/restricted client organization must
    // lock out its users immediately, not just at their next login.
    if (user.organizationId) {
        const org = await models_1.Organization.findById(user.organizationId).select("status");
        if (!org || org.status !== shared_1.OrganizationStatus.ACTIVE) {
            throw ApiError_1.ApiError.forbidden("Your organization's access to this platform is currently restricted");
        }
    }
    // Enforce the 24-hour (configurable) OTP re-verification requirement on
    // every authenticated request, not just at login.
    const reverifyMs = env_1.env.OTP_REVERIFY_INTERVAL_HOURS * 60 * 60 * 1000;
    const lastVerified = user.lastOtpVerifiedAt?.getTime() ?? 0;
    if (Date.now() - lastVerified > reverifyMs) {
        throw ApiError_1.ApiError.unauthorized("OTP re-verification required");
    }
    // Effective permissions: centralized in @launcherdesk/shared so the exact
    // same rule (Assistant Master Admin = explicitly-assigned only, every
    // other role = role default + any extra grants) is used everywhere,
    // including tests, instead of being re-derived here.
    req.user = {
        id: user._id.toString(),
        role: user.role,
        organizationId: user.organizationId ? user.organizationId.toString() : null,
        permissions: shared_1.getEffectivePermissions(user.role, user.permissions),
    };
    next();
});