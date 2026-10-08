"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OtpService = void 0;
const models_1 = require("../models");
const env_1 = require("../config/env");
const crypto_1 = require("../utils/crypto");
const ApiError_1 = require("../utils/ApiError");
const email_service_1 = require("./email.service");
const audit_service_1 = require("./audit.service");
const shared_1 = require("@launcherdesk/shared");
const logger_1 = require("../utils/logger");
// Handles OTP issuance/verification for both LOGIN and PASSWORD_RESET,
// with rate limiting, attempt limits, resend cooldown, and single-use
// invalidation. Raw codes are never stored or logged - only sha256 hashes.
exports.OtpService = {
    async issue(userId, purpose, email, actorRole, req) {
        const recent = await models_1.OTP.findOne({ userId, purpose, consumedAt: null }).sort({ createdAt: -1 });
        if (recent) {
            const secondsSinceSent = (Date.now() - recent.lastSentAt.getTime()) / 1000;
            if (secondsSinceSent < env_1.env.OTP_RESEND_COOLDOWN_SECONDS) {
                throw ApiError_1.ApiError.tooMany(`Please wait ${Math.ceil(env_1.env.OTP_RESEND_COOLDOWN_SECONDS - secondsSinceSent)}s before requesting another code`);
            }
        }
        // DEV/TEST CONVENIENCE ONLY - structurally impossible in production:
        // the fixed value is only ever honored when NODE_ENV !== "production",
        // regardless of what DEV_FIXED_OTP_CODE is set to.
        const useFixedDevCode = env_1.env.NODE_ENV !== "production" && env_1.env.DEV_FIXED_OTP_CODE;
        const code = useFixedDevCode ? env_1.env.DEV_FIXED_OTP_CODE : (0, crypto_1.generateNumericCode)(6);
        const challengeToken = (0, crypto_1.generateOpaqueToken)(24);
        const expiresAt = new Date(Date.now() + env_1.env.OTP_EXPIRY_MINUTES * 60 * 1000);
        await models_1.OTP.create({
            userId,
            purpose,
            codeHash: (0, crypto_1.sha256Hex)(code),
            challengeToken,
            expiresAt,
            attempts: 0,
            maxAttempts: env_1.env.OTP_MAX_ATTEMPTS,
            lastSentAt: new Date(),
        });
        if (purpose === "LOGIN") {
            await email_service_1.EmailService.sendLoginOTP(email, code);
        }
        else {
            await email_service_1.EmailService.sendPasswordResetOTP(email, code);
        }
        // DEV-ONLY visibility: no real email provider is configured, so the
        // code above was never actually delivered anywhere (MockEmailProvider
        // logs only the "to"/"subject", never the body). Surface the raw code
        // in the server console so local login/testing can proceed without a
        // real inbox. Never happens in production, and never happens once a
        // real BREVO_API_KEY is configured - this is the ONLY place the raw
        // code is ever exposed outside the OTP flow itself.
        if (env_1.env.NODE_ENV !== "production" && !env_1.env.BREVO_API_KEY) {
            logger_1.logger.warn(`[DEV ONLY - no email provider configured] OTP code for ${email} (${purpose}): ${code}`);
        }
        await (0, audit_service_1.recordAudit)({ actorId: userId, actorRole: actorRole || "UNKNOWN", action: shared_1.AuditAction.OTP_SENT, entityType: "OTP", req });
        return { challengeToken, expiresAt };
    },
    async verify(challengeToken, code, req) {
        const otp = await models_1.OTP.findOne({ challengeToken });
        if (!otp)
            throw ApiError_1.ApiError.badRequest("Invalid or expired verification challenge");
        if (otp.consumedAt)
            throw ApiError_1.ApiError.badRequest("This code has already been used");
        if (otp.expiresAt.getTime() < Date.now())
            throw ApiError_1.ApiError.badRequest("Code has expired, please request a new one");
        if (otp.attempts >= otp.maxAttempts)
            throw ApiError_1.ApiError.tooMany("Maximum verification attempts exceeded");
        // Looked up once, purely to attribute the audit trail to the real role
        // (MASTER_ADMIN / ASSISTANT_MASTER_ADMIN / ...) instead of "UNKNOWN" -
        // every role, per the 24-hour OTP requirement, goes through this same path.
        const actor = await models_1.User.findById(otp.userId).select("role").lean();
        const actorRole = actor?.role || "UNKNOWN";
        const isValid = otp.codeHash === (0, crypto_1.sha256Hex)(code);
        otp.attempts += 1;
        if (!isValid) {
            await otp.save();
            await (0, audit_service_1.recordAudit)({ actorId: otp.userId.toString(), actorRole, action: shared_1.AuditAction.OTP_FAILED, req });
            throw ApiError_1.ApiError.badRequest("Incorrect code");
        }
        otp.consumedAt = new Date();
        await otp.save();
        if (otp.purpose === "LOGIN") {
            await models_1.User.findByIdAndUpdate(otp.userId, { lastOtpVerifiedAt: new Date() });
        }
        await (0, audit_service_1.recordAudit)({ actorId: otp.userId.toString(), actorRole, action: shared_1.AuditAction.OTP_VERIFIED, req });
        return { userId: otp.userId.toString(), purpose: otp.purpose };
    },
};