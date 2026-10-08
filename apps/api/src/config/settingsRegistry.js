"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SETTINGS_REGISTRY = void 0;
// Phase 17 - Advanced System Settings & Configuration Management.
//
// This is the ONLY allowlist through which a SystemSetting row can ever be
// created, read, or updated via the settings API (see settings.service.js).
// A key not present here is structurally unreachable - GET/PATCH reject it
// as UNKNOWN_SETTING_KEY before any Mongo query is built, which is also why
// a "$where"/"__proto__"/"constructor"-shaped key is inert here: the lookup
// is an own-property check against this fixed object, never a dynamic
// property access driven by client input.
//
// Every `defaultValue` below mirrors config/env.js's CURRENT default for the
// same value EXACTLY - a fresh install with zero SystemSetting DB rows must
// behave identically to the pre-Phase-17 codebase. Only settings that
// already exist as real env-backed business thresholds/feature toggles in
// this codebase are registered here; this is deliberately not a place to
// invent new operational knobs.
//
// category is either:
//  - "BUSINESS": a configurable operational threshold/limit.
//  - "FEATURE_FLAG": a boolean on/off switch for a whole feature surface.
// Never "SECRET" or "INFRASTRUCTURE" - real secrets (JWT_SECRET,
// RAZORPAY_KEY_SECRET, BREVO_API_KEY, CLOUDINARY_API_SECRET,
// ESTAMP_API_SECRET, ESTAMP_PROVIDER_WEBHOOK_SECRET,
// RAZORPAY_WEBHOOK_SECRET) and infrastructure values (MONGODB_URI, PORT,
// FRONTEND_URL, JWT_*_EXPIRY) are never registered here and never become
// reachable through this system - env.js remains their only source of
// truth, full stop.
exports.SETTINGS_REGISTRY = {
    REQUEST_MODIFY_WINDOW_MINUTES: {
        key: "REQUEST_MODIFY_WINDOW_MINUTES",
        valueType: "INTEGER",
        category: "BUSINESS",
        defaultValue: 20,
        min: 1,
        max: 1440,
        description: "Minutes an E-Stamp request stays open for modification/cancellation after creation.",
    },
    DOCUMENT_MAX_FILE_SIZE_MB: {
        key: "DOCUMENT_MAX_FILE_SIZE_MB",
        valueType: "INTEGER",
        category: "BUSINESS",
        defaultValue: 10,
        min: 1,
        max: 100,
        description: "Maximum size (MB) for a single certificate/supporting-document upload (FileService.validate's live business limit).",
    },
    REPORT_MAX_DATE_RANGE_DAYS: {
        key: "REPORT_MAX_DATE_RANGE_DAYS",
        valueType: "INTEGER",
        category: "BUSINESS",
        defaultValue: 366,
        min: 1,
        max: 3650,
        description: "Maximum number of days a report or provider-usage date range may span. Unifies the two previously-hardcoded 366-day limits in estamp-provider.service.js and report.service.js.",
    },
    ESTAMP_PROVIDER_LOW_BALANCE_THRESHOLD: {
        key: "ESTAMP_PROVIDER_LOW_BALANCE_THRESHOLD",
        valueType: "DECIMAL",
        category: "BUSINESS",
        defaultValue: null,
        // Tri-state, preserved exactly from env.js: null/unset means "no
        // threshold configured, never alert" - never silently treated as 0.
        nullable: true,
        min: 0,
        max: null,
        description: "E-Stamp provider account balance at/below which Master Admin is alerted. Unset (null) = no threshold configured, never alert.",
    },
    BULK_ESTAMP_MAX_ROWS: {
        key: "BULK_ESTAMP_MAX_ROWS",
        valueType: "INTEGER",
        category: "BUSINESS",
        defaultValue: 500,
        min: 1,
        max: 10000,
        description: "Maximum spreadsheet rows accepted in a single bulk E-Stamp upload.",
    },
    BULK_ESTAMP_MAX_FILE_SIZE_MB: {
        key: "BULK_ESTAMP_MAX_FILE_SIZE_MB",
        valueType: "INTEGER",
        category: "BUSINESS",
        defaultValue: 10,
        min: 1,
        max: 100,
        description: "Maximum size (MB) for a bulk E-Stamp CSV/XLSX upload.",
    },
    BULK_ESTAMP_ENABLED: {
        key: "BULK_ESTAMP_ENABLED",
        valueType: "BOOLEAN",
        category: "FEATURE_FLAG",
        defaultValue: true,
        description: "Master switch for the bulk E-Stamp upload feature (matches today's always-on behavior by default).",
    },
    REPORTS_ENABLED: {
        key: "REPORTS_ENABLED",
        valueType: "BOOLEAN",
        category: "FEATURE_FLAG",
        defaultValue: true,
        description: "Master switch for the reporting surface (matches today's always-on behavior by default).",
    },
    POLICY_ACKNOWLEDGEMENT_ENABLED: {
        key: "POLICY_ACKNOWLEDGEMENT_ENABLED",
        valueType: "BOOLEAN",
        category: "FEATURE_FLAG",
        defaultValue: false,
        description: "When enabled, creating an E-Stamp request requires the actor to have accepted the currently published TERMS policy (bridges to the already-built, Phase 16 PolicyService.assertAcceptedCurrent). Defaults to false so out-of-the-box behavior is unchanged.",
    },
};
