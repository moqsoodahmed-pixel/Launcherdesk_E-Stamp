"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SETTING_KEYS = exports.SystemSetting = void 0;
const mongoose_1 = require("mongoose");
const systemSettingSchema = new mongoose_1.Schema({
    key: { type: String, required: true, unique: true },
    // Not `required` - a handful of registered settings (e.g.
    // ESTAMP_PROVIDER_LOW_BALANCE_THRESHOLD) are legitimately nullable
    // ("no threshold configured" is a real, storable state, distinct from
    // "no row exists yet"). Type/range validation for whatever IS stored is
    // enforced entirely by settings.service.js against the settingsRegistry
    // allowlist - never by this schema.
    value: { type: mongoose_1.Schema.Types.Mixed },
    // Phase 17 - denormalized snapshot of the settingsRegistry entry active
    // at the time of the most recent write. Never independently trusted -
    // settings.service.js always re-validates the CURRENT registry entry for
    // the key, so a future registry change (e.g. a tightened range) takes
    // effect even against an older stored row.
    valueType: { type: String, enum: ["INTEGER", "DECIMAL", "BOOLEAN", "ENUM", "STRING"] },
    // BUSINESS or FEATURE_FLAG only - a SystemSetting row is never created
    // for a SECRET/INFRASTRUCTURE value (those remain env-only, see
    // config/settingsRegistry.js's header comment).
    category: { type: String, enum: ["BUSINESS", "FEATURE_FLAG"] },
    description: { type: String },
    updatedBy: { type: mongoose_1.Schema.Types.ObjectId, ref: "User" },
    // Optimistic-concurrency counter - same idiom as Wallet.version. Bumped
    // by $inc on every successful update; a conditional update matched
    // against a stale version fails to match (never silently overwrites).
    version: { type: Number, default: 0 },
}, { timestamps: true });
exports.SystemSetting = (0, mongoose_1.model)("SystemSetting", systemSettingSchema);
exports.SETTING_KEYS = {
    OTP_REVERIFY_INTERVAL_HOURS: "otp.reverify_interval_hours",
    OTP_EXPIRY_MINUTES: "otp.expiry_minutes",
    OTP_MAX_ATTEMPTS: "otp.max_attempts",
    OTP_RESEND_COOLDOWN_SECONDS: "otp.resend_cooldown_seconds",
    REQUEST_MODIFY_WINDOW_MINUTES: "request.modify_window_minutes",
    CURRENCY: "general.currency",
    MIN_WALLET_TOPUP: "wallet.min_topup",
    LOW_BALANCE_THRESHOLD: "wallet.low_balance_threshold",
    MAX_FILE_SIZE_MB: "files.max_size_mb",
};
