"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.credentialRevealLimiter = exports.vendorAdminLimiter = exports.vendorUploadLimiter = exports.passwordChangeLimiter = exports.providerSyncLimiter = exports.documentUploadLimiter = exports.bulkUploadLimiter = exports.paymentLimiter = exports.refreshLimiter = exports.globalApiLimiter = exports.passwordResetLimiter = exports.otpVerifyLimiter = exports.otpRequestLimiter = exports.loginLimiter = void 0;
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
// Phase 19 - tag every limiter middleware with a stable, introspectable
// `.limiterName` so tests can assert "this exact named limiter is wired to
// this route" (tests/security-hardening.test.js) without relying on
// cross-module function-reference equality, which is not guaranteed to
// survive a test runner's module transform/duplication behavior. Purely a
// test/debugging aid - never read at runtime by Express itself.
function tag(name, limiter) {
    limiter.limiterName = name;
    return limiter;
}
// Separate, purpose-specific limiters so a global limiter doesn't either
// over- or under-protect sensitive auth endpoints vs. general API traffic.
exports.loginLimiter = tag("loginLimiter", (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Too many login attempts. Please try again later.", code: "RATE_LIMITED" },
}));
exports.otpRequestLimiter = tag("otpRequestLimiter", (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Too many OTP requests. Please wait before retrying.", code: "RATE_LIMITED" },
}));
exports.otpVerifyLimiter = tag("otpVerifyLimiter", (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    limit: 15,
    standardHeaders: true,
    legacyHeaders: false,
}));
exports.passwordResetLimiter = tag("passwordResetLimiter", (0, express_rate_limit_1.default)({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
}));
// Logged-in password change: keyed per USER (it runs after authenticate), so
// guessing the current password is capped per account, not per IP.
exports.passwordChangeLimiter = tag("passwordChangeLimiter", (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `user:${req.user?.id || req.ip}`,
    message: { success: false, message: "Too many password change attempts. Please try again later.", code: "RATE_LIMITED" },
}));
exports.globalApiLimiter = tag("globalApiLimiter", (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    limit: 600,
    standardHeaders: true,
    legacyHeaders: false,
}));
// Phase 19 - purpose-specific limiters for sensitive/high-cost endpoints that
// previously relied on globalApiLimiter (600/15min) alone. Limits are
// deliberately generous so legitimate bulk/report/payment usage is never
// broken - these exist to blunt credential/session-guessing and
// resource-exhaustion abuse, not to throttle normal traffic.
exports.refreshLimiter = tag("refreshLimiter", (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Too many token refresh attempts. Please try again later.", code: "RATE_LIMITED" },
}));
exports.paymentLimiter = tag("paymentLimiter", (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Too many payment requests. Please try again later.", code: "RATE_LIMITED" },
}));
exports.bulkUploadLimiter = tag("bulkUploadLimiter", (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Too many bulk upload requests. Please try again later.", code: "RATE_LIMITED" },
}));
exports.documentUploadLimiter = tag("documentUploadLimiter", (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    limit: 40,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Too many upload requests. Please try again later.", code: "RATE_LIMITED" },
}));
exports.providerSyncLimiter = tag("providerSyncLimiter", (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Too many provider sync/retry requests. Please try again later.", code: "RATE_LIMITED" },
}));
// Vendor certificate uploads: keyed per USER (runs after authenticate) so
// one vendor working through a long queue one by one is capped on its own,
// independent of IP. Generous enough for a full batch in one sitting.
exports.vendorUploadLimiter = tag("vendorUploadLimiter", (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    limit: 150,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `vendor-upload:${req.user?.id || req.ip}`,
    message: { success: false, message: "Too many uploads. Please wait a few minutes and try again.", code: "RATE_LIMITED" },
}));
// Master Admin vendor password resets / deletions: keyed per ACTOR (runs
// after authenticate), so a hijacked admin session cannot mass-reset.
exports.vendorAdminLimiter = tag("vendorAdminLimiter", (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `vendor-admin:${req.user?.id || req.ip}`,
    message: { success: false, message: "Too many vendor account changes. Please wait and try again.", code: "RATE_LIMITED" },
}));
// Temporary-password reveal: keyed per ACTOR (runs after authenticate).
exports.credentialRevealLimiter = tag("credentialRevealLimiter", (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `credential-reveal:${req.user?.id || req.ip}`,
    message: { success: false, message: "Too many password reveals. Please wait and try again.", code: "RATE_LIMITED" },
}));
