"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULTS = void 0;
// Shared, non-secret configuration constants (defaults; overridden by SystemSetting in DB).
exports.DEFAULTS = {
    OTP_EXPIRY_MINUTES: 10,
    OTP_MAX_ATTEMPTS: 5,
    OTP_RESEND_COOLDOWN_SECONDS: 60,
    OTP_REVERIFY_INTERVAL_HOURS: 24,
    REQUEST_MODIFY_WINDOW_MINUTES: 20,
    CURRENCY: "INR",
    MIN_WALLET_TOPUP: 100,
    LOW_BALANCE_THRESHOLD: 500,
    MAX_FILE_SIZE_MB: 10,
};
