"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
function required(name, fallback) {
    const raw = process.env[name];
    // In production, a dev-only fallback must never be silently accepted -
    // an unset JWT_SECRET/JWT_REFRESH_SECRET/MONGODB_URI falling back to a
    // well-known default (visible in this very file / .env.example) would
    // let anyone forge tokens or point at the wrong database without any
    // startup failure. Only a real, explicitly-set env value is acceptable
    // in production; a missing one always throws, fallback or not.
    if (raw === undefined && process.env.NODE_ENV === "production") {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    const val = raw ?? fallback;
    if (val === undefined) {
        console.warn(`[env] Missing ${name} - using empty string for development.`);
        return "";
    }
    return val;
}
exports.env = {
    NODE_ENV: process.env.NODE_ENV || "development",
    PORT: parseInt(process.env.PORT || "5000", 10),
    FRONTEND_URL: process.env.FRONTEND_URL || "http://localhost:5173",
    MONGODB_URI: required("MONGODB_URI", "mongodb://localhost:27017/launcherdesk_estamping"),
    JWT_SECRET: required("JWT_SECRET", "dev_only_insecure_secret_change_me"),
    JWT_ACCESS_EXPIRY: process.env.JWT_ACCESS_EXPIRY || "15m",
    JWT_REFRESH_SECRET: required("JWT_REFRESH_SECRET", "dev_only_insecure_refresh_secret_change_me"),
    JWT_REFRESH_EXPIRY: process.env.JWT_REFRESH_EXPIRY || "7d",
    OTP_EXPIRY_MINUTES: parseInt(process.env.OTP_EXPIRY_MINUTES || "10", 10),
    OTP_MAX_ATTEMPTS: parseInt(process.env.OTP_MAX_ATTEMPTS || "5", 10),
    OTP_RESEND_COOLDOWN_SECONDS: parseInt(process.env.OTP_RESEND_COOLDOWN_SECONDS || "60", 10),
    OTP_REVERIFY_INTERVAL_HOURS: parseInt(process.env.OTP_REVERIFY_INTERVAL_HOURS || "24", 10),
    REQUEST_MODIFY_WINDOW_MINUTES: parseInt(process.env.REQUEST_MODIFY_WINDOW_MINUTES || "20", 10),
    // DEV/TEST CONVENIENCE ONLY - never honored in production (see
    // otp.service.js). Lets a developer skip checking the console for a
    // real OTP by fixing it to a known value. Unset (or blank) restores
    // normal random-code behavior.
    DEV_FIXED_OTP_CODE: process.env.DEV_FIXED_OTP_CODE || "",
    // EMAIL_PROVIDER is informational only right now (the actual selection
    // logic in services/email-providers is driven by whether BREVO_API_KEY
    // is set) - kept as an explicit, documented setting per Phase 10 so a
    // future second provider can be selected the same way ESTAMP_PROVIDER is.
    EMAIL_PROVIDER: process.env.EMAIL_PROVIDER || "brevo",
    BREVO_API_KEY: process.env.BREVO_API_KEY || "",
    BREVO_SENDER_EMAIL: process.env.BREVO_SENDER_EMAIL || "no-reply@launcherdesk.com",
    BREVO_SENDER_NAME: process.env.BREVO_SENDER_NAME || "LauncherDesk E-Stamping",
    // EMAIL_FROM/EMAIL_FROM_NAME take precedence over BREVO_SENDER_EMAIL/NAME
    // when set, so the "from" identity isn't tied to the Brevo-specific name.
    EMAIL_FROM: process.env.EMAIL_FROM || "",
    EMAIL_FROM_NAME: process.env.EMAIL_FROM_NAME || "",
    RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID || "",
    RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET || "",
    RAZORPAY_WEBHOOK_SECRET: process.env.RAZORPAY_WEBHOOK_SECRET || "",
    CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME || "",
    CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY || "",
    CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET || "",
    // Phase 14 - the single source of truth for FileService's own upload size
    // guardrail (certificate/supporting-document uploads via /files/upload).
    // Deliberately separate from BULK_ESTAMP_MAX_FILE_SIZE_MB above, which
    // only bounds the CSV/XLSX bulk-request spreadsheet upload - the two
    // limits protect different upload paths and must not be conflated.
    // file.routes.js's multer limit is derived from this SAME value, so
    // there is exactly one place this number is configured.
    DOCUMENT_MAX_FILE_SIZE_MB: parseInt(process.env.DOCUMENT_MAX_FILE_SIZE_MB || "10", 10),
    ESTAMP_PROVIDER: process.env.ESTAMP_PROVIDER || "mock",
    ESTAMP_API_BASE_URL: process.env.ESTAMP_API_BASE_URL || "",
    ESTAMP_API_KEY: process.env.ESTAMP_API_KEY || "",
    ESTAMP_API_SECRET: process.env.ESTAMP_API_SECRET || "",
    ESTAMP_API_TIMEOUT_MS: parseInt(process.env.ESTAMP_API_TIMEOUT_MS || "15000", 10),
    ESTAMP_PROVIDER_WEBHOOK_SECRET: process.env.ESTAMP_PROVIDER_WEBHOOK_SECRET || "",
    // Compared only against a MEANINGFUL provider balance (status AVAILABLE) -
    // never evaluated when the provider is unconfigured/unavailable. Left
    // unset means "no threshold configured", not "always low".
    ESTAMP_PROVIDER_LOW_BALANCE_THRESHOLD: process.env.ESTAMP_PROVIDER_LOW_BALANCE_THRESHOLD
        ? parseFloat(process.env.ESTAMP_PROVIDER_LOW_BALANCE_THRESHOLD)
        : null,
    // Phase 11 - bulk E-Stamp request upload guardrails. MAX_ROWS caps how
    // many spreadsheet rows a single batch may contain (exceeding it rejects
    // the whole upload, never a silent truncation); MAX_FILE_SIZE_MB feeds
    // multer's own limit, same convention as file.routes.js.
    BULK_ESTAMP_MAX_ROWS: parseInt(process.env.BULK_ESTAMP_MAX_ROWS || "500", 10),
    BULK_ESTAMP_MAX_FILE_SIZE_MB: parseInt(process.env.BULK_ESTAMP_MAX_FILE_SIZE_MB || "10", 10),
    SEED_MASTER_ADMIN_EMAIL: process.env.SEED_MASTER_ADMIN_EMAIL || "master@launcherdesk.local",
    SEED_MASTER_ADMIN_PASSWORD: process.env.SEED_MASTER_ADMIN_PASSWORD || "",
    SEED_DEMO_ORG_NAME: process.env.SEED_DEMO_ORG_NAME || "Demo Client Pvt Ltd",
};
