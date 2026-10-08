"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const argon2_1 = __importDefault(require("argon2"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const models_1 = require("../models");
const env_1 = require("../config/env");
const ApiError_1 = require("../utils/ApiError");
const crypto_1 = require("../utils/crypto");
const otp_service_1 = require("./otp.service");
const audit_service_1 = require("./audit.service");
const notification_service_1 = require("./notification.service");
const shared_1 = require("@launcherdesk/shared");
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;
exports.AuthService = {
    async hashPassword(password) {
        return argon2_1.default.hash(password, { type: argon2_1.default.argon2id });
    },
    async verifyPassword(hash, password) {
        return argon2_1.default.verify(hash, password);
    },
    // Step 1 of login: verify credentials, decide if OTP is still valid within
    // the (default 24h, configurable) re-verification window.
    async loginStep1(email, password, req) {
        const user = await models_1.User.findOne({ email: email.toLowerCase() }).select("+passwordHash");
        if (!user) {
            // Do not reveal whether the email exists.
            throw ApiError_1.ApiError.unauthorized("Invalid email or password");
        }
        if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
            throw ApiError_1.ApiError.tooMany("Account temporarily locked due to repeated failed logins. Try again later.");
        }
        const isValid = await this.verifyPassword(user.passwordHash, password);
        if (!isValid) {
            user.failedLoginAttempts += 1;
            if (user.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
                user.lockedUntil = new Date(Date.now() + LOCK_DURATION_MS);
            }
            await user.save();
            await (0, audit_service_1.recordAudit)({ actorId: user._id.toString(), actorRole: user.role, action: shared_1.AuditAction.LOGIN_FAILED, req });
            throw ApiError_1.ApiError.unauthorized("Invalid email or password");
        }
        if (!user.isActive) {
            throw ApiError_1.ApiError.forbidden("Account is deactivated. Contact your administrator.");
        }
        if (user.organizationId) {
            const org = await models_1.Organization.findById(user.organizationId).select("status");
            if (!org || org.status !== shared_1.OrganizationStatus.ACTIVE) {
                throw ApiError_1.ApiError.forbidden("Your organization's access to this platform is currently restricted");
            }
        }
        user.failedLoginAttempts = 0;
        user.lockedUntil = null;
        await user.save();
        const reverifyMs = env_1.env.OTP_REVERIFY_INTERVAL_HOURS * 60 * 60 * 1000;
        const lastVerified = user.lastOtpVerifiedAt?.getTime() ?? 0;
        const otpStillValid = Date.now() - lastVerified <= reverifyMs;
        if (otpStillValid) {
            // No OTP needed - issue tokens immediately.
            return this.issueTokens(user, req);
        }
        const { challengeToken, expiresAt } = await otp_service_1.OtpService.issue(user._id.toString(), "LOGIN", user.email, user.role, req);
        return { requiresOtp: true, challengeToken, expiresAt };
    },
    async completeOtpLogin(challengeToken, code, req) {
        const { userId } = await otp_service_1.OtpService.verify(challengeToken, code, req);
        const user = await models_1.User.findById(userId);
        if (!user)
            throw ApiError_1.ApiError.unauthorized();
        return this.issueTokens(user, req);
    },
    async issueTokens(user, req) {
        // Phase 19 - explicit `algorithm: "HS256"` matches the `algorithms:
        // ["HS256"]` allowlist authenticate.js now pins on verify, so sign
        // and verify are symmetric and neither side relies on a library
        // default that could silently change.
        const accessToken = jsonwebtoken_1.default.sign({ userId: user._id.toString(), role: user.role, organizationId: user.organizationId, tokenVersion: user.tokenVersion }, env_1.env.JWT_SECRET, { expiresIn: env_1.env.JWT_ACCESS_EXPIRY, algorithm: "HS256" });
        const rawRefreshToken = (0, crypto_1.generateOpaqueToken)(32);
        const refreshExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await models_1.RefreshToken.create({
            userId: user._id,
            tokenHash: (0, crypto_1.sha256Hex)(rawRefreshToken),
            tokenVersion: user.tokenVersion,
            userAgent: req?.headers?.["user-agent"],
            ip: req?.ip,
            expiresAt: refreshExpiresAt,
        });
        user.lastLoginAt = new Date();
        await user.save();
        await (0, audit_service_1.recordAudit)({ actorId: user._id.toString(), actorRole: user.role, action: shared_1.AuditAction.LOGIN, organizationId: user.organizationId, req });
        // Critical Assistant Master Admin oversight requirement: Master Admin
        // must be told, in real time, whenever an Assistant Master Admin logs
        // in - not just be able to find it later in the audit log.
        if (user.role === shared_1.Role.ASSISTANT_MASTER_ADMIN) {
            await (0, notification_service_1.notifyAllMasterAdmins)({
                type: shared_1.NotificationType.ASSISTANT_ADMIN_ACTIVITY,
                title: "Assistant Master Admin logged in",
                message: `Assistant Master Admin ${user.name} logged in at ${new Date().toLocaleTimeString()}.`,
                relatedActorId: user._id.toString(),
            });
        }
        return {
            requiresOtp: false,
            accessToken,
            refreshToken: rawRefreshToken,
            user: {
                id: user._id.toString(),
                name: user.name,
                email: user.email,
                role: user.role,
                organizationId: user.organizationId,
                mustChangePassword: user.mustChangePassword,
                // Phase 21 - purely additive UX field: lets the frontend render
                // only the nav/dashboard widgets the user can actually use,
                // without re-deriving the role/permission-merge rule itself.
                // NOT a security boundary - every route this could gate is
                // already independently enforced server-side by
                // requirePermission()/authenticate.js computing this exact
                // same value from role+user.permissions on every request.
                permissions: shared_1.getEffectivePermissions(user.role, user.permissions),
            },
        };
    },
    async refresh(rawRefreshToken) {
        const tokenHash = (0, crypto_1.sha256Hex)(rawRefreshToken);
        const stored = await models_1.RefreshToken.findOne({ tokenHash, revokedAt: null });
        if (!stored || stored.expiresAt.getTime() < Date.now()) {
            throw ApiError_1.ApiError.unauthorized("Invalid or expired refresh token");
        }
        const user = await models_1.User.findById(stored.userId);
        if (!user || user.tokenVersion !== stored.tokenVersion) {
            throw ApiError_1.ApiError.unauthorized("Session no longer valid");
        }
        // Rotate: revoke old, issue new.
        stored.revokedAt = new Date();
        await stored.save();
        return this.issueTokens(user);
    },
    async logout(userId, actorRole, rawRefreshToken, req) {
        if (rawRefreshToken) {
            await models_1.RefreshToken.findOneAndUpdate({ tokenHash: (0, crypto_1.sha256Hex)(rawRefreshToken) }, { revokedAt: new Date() });
        }
        await (0, audit_service_1.recordAudit)({ actorId: userId, actorRole: actorRole || "UNKNOWN", action: shared_1.AuditAction.LOGOUT, req });
    },
    async invalidateAllSessions(userId) {
        await models_1.User.findByIdAndUpdate(userId, { $inc: { tokenVersion: 1 } });
        await models_1.RefreshToken.updateMany({ userId, revokedAt: null }, { revokedAt: new Date() });
    },
};