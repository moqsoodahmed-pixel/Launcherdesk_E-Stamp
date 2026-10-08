"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetPassword = exports.forgotPassword = exports.me = exports.logout = exports.refreshToken = exports.verifyLoginOtp = exports.login = void 0;
const asyncHandler_1 = require("../utils/asyncHandler");
const ApiResponse_1 = require("../utils/ApiResponse");
const auth_service_1 = require("../services/auth.service");
const otp_service_1 = require("../services/otp.service");
const models_1 = require("../models");
const ApiError_1 = require("../utils/ApiError");
const crypto_1 = require("../utils/crypto");
const audit_service_1 = require("../services/audit.service");
const shared_1 = require("@launcherdesk/shared");
exports.login = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { email, password } = req.body;
    const result = await auth_service_1.AuthService.loginStep1(email, password, req);
    return (0, ApiResponse_1.ok)(res, result);
});
exports.verifyLoginOtp = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { otpToken, code } = req.body;
    const result = await auth_service_1.AuthService.completeOtpLogin(otpToken, code, req);
    return (0, ApiResponse_1.ok)(res, result);
});
exports.refreshToken = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { refreshToken } = req.body;
    if (!refreshToken)
        throw ApiError_1.ApiError.badRequest("refreshToken is required");
    const result = await auth_service_1.AuthService.refresh(refreshToken);
    return (0, ApiResponse_1.ok)(res, result);
});
exports.logout = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    await auth_service_1.AuthService.logout(req.user.id, req.user.role, req.body?.refreshToken, req);
    return (0, ApiResponse_1.ok)(res, { loggedOut: true });
});
exports.me = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const user = await models_1.User.findById(req.user.id).select("-passwordHash");
    if (!user) {
        throw ApiError_1.ApiError.unauthorized();
    }
    // Phase 21 - same purely-additive `permissions` field as the login
    // response (see auth.service.js's issueTokens) - a plain object built
    // from the Mongoose doc, not a raw doc mutation, so `.toObject()`'s
    // shape (including virtuals-free plain JSON) stays otherwise unchanged.
    return (0, ApiResponse_1.ok)(res, {
        ...user.toObject(),
        permissions: shared_1.getEffectivePermissions(user.role, user.permissions),
    });
});
// Forgot password: does not reveal whether the email exists.
exports.forgotPassword = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { email } = req.body;
    const user = await models_1.User.findOne({ email: email.toLowerCase() });
    if (user) {
        const { challengeToken } = await otp_service_1.OtpService.issue(user._id.toString(), "PASSWORD_RESET", user.email, user.role, req);
        await (0, audit_service_1.recordAudit)({ actorId: user._id.toString(), actorRole: user.role, action: shared_1.AuditAction.PASSWORD_RESET_REQUESTED, req });
        return (0, ApiResponse_1.ok)(res, { challengeToken, message: "If this email is registered, a reset code has been sent." });
    }
    // Same response shape/timing profile regardless of existence.
    return (0, ApiResponse_1.ok)(res, { challengeToken: (0, crypto_1.generateOpaqueToken)(24), message: "If this email is registered, a reset code has been sent." });
});
exports.resetPassword = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { resetToken, code, newPassword } = req.body;
    const { userId } = await otp_service_1.OtpService.verify(resetToken, code, req);
    const user = await models_1.User.findById(userId);
    if (!user)
        throw ApiError_1.ApiError.badRequest("Invalid reset request");
    user.passwordHash = await auth_service_1.AuthService.hashPassword(newPassword);
    user.mustChangePassword = false;
    await user.save();
    // Invalidate all existing sessions/tokens on password reset.
    await auth_service_1.AuthService.invalidateAllSessions(user._id.toString());
    await (0, audit_service_1.recordAudit)({ actorId: user._id.toString(), actorRole: user.role, action: shared_1.AuditAction.PASSWORD_RESET_COMPLETED, req });
    return (0, ApiResponse_1.ok)(res, { message: "Password reset successful. Please log in again." });
});