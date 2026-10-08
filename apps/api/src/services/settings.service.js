"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SettingsService = void 0;
const models_1 = require("../models");
const ApiError_1 = require("../utils/ApiError");
const logger_1 = require("../utils/logger");
const audit_service_1 = require("./audit.service");
const shared_1 = require("@launcherdesk/shared");
const settingsRegistry_1 = require("../config/settingsRegistry");
// Phase 17 - centralizes all business-settings logic. The controller stays
// thin (matches this codebase's established service/controller split, e.g.
// policy.service.js/policy.controller.js).
//
// Runtime consistency decision (Step 15): deliberately NO cache layer. This
// is a business-SaaS admin panel, not a high-QPS public API - a single
// indexed findOne({key}) per read is cheap, and a direct read means a
// setting change takes effect on the very next read with no invalidation
// logic to get wrong. See the Phase 17 final report for the explicit
// rationale.
// Own-property lookup only - a key like "$where"/"__proto__"/"constructor"/
// "prototype" simply has no matching entry on this plain object literal
// (Object.prototype.hasOwnProperty.call never returns true for those on a
// plain `{}`-style registry), so it is rejected as UNKNOWN_SETTING_KEY
// before any Mongo query is ever built. This allowlist IS the security
// guarantee - no separate key-sanitization logic is layered on top.
function getRegistryEntry(key) {
    if (typeof key !== "string" || !Object.prototype.hasOwnProperty.call(settingsRegistry_1.SETTINGS_REGISTRY, key)) {
        return null;
    }
    return settingsRegistry_1.SETTINGS_REGISTRY[key];
}
// Validates `value` against `entry`'s valueType/min/max/allowedValues.
// Throws a clean ApiError (never lets an invalid value reach storage).
function validateValue(entry, value) {
    if (value === null) {
        if (entry.nullable) {
            return null;
        }
        throw ApiError_1.ApiError.badRequest(`Setting ${entry.key} does not accept a null value`, "INVALID_SETTING_VALUE");
    }
    switch (entry.valueType) {
        case "BOOLEAN": {
            if (typeof value !== "boolean") {
                throw ApiError_1.ApiError.badRequest(`Setting ${entry.key} requires a boolean value`, "INVALID_SETTING_VALUE");
            }
            return value;
        }
        case "INTEGER":
        case "DECIMAL": {
            if (typeof value !== "number" || !Number.isFinite(value)) {
                throw ApiError_1.ApiError.badRequest(`Setting ${entry.key} requires a finite number`, "INVALID_SETTING_VALUE");
            }
            if (entry.valueType === "INTEGER" && !Number.isInteger(value)) {
                throw ApiError_1.ApiError.badRequest(`Setting ${entry.key} requires an integer value`, "INVALID_SETTING_VALUE");
            }
            if (entry.min != null && value < entry.min) {
                throw ApiError_1.ApiError.badRequest(`Setting ${entry.key} must be >= ${entry.min}`, "OUT_OF_RANGE");
            }
            if (entry.max != null && value > entry.max) {
                throw ApiError_1.ApiError.badRequest(`Setting ${entry.key} must be <= ${entry.max}`, "OUT_OF_RANGE");
            }
            return value;
        }
        case "ENUM": {
            if (typeof value !== "string" || !Array.isArray(entry.allowedValues) || !entry.allowedValues.includes(value)) {
                throw ApiError_1.ApiError.badRequest(`Setting ${entry.key} must be one of: ${(entry.allowedValues || []).join(", ")}`, "INVALID_SETTING_VALUE");
            }
            return value;
        }
        case "STRING": {
            if (typeof value !== "string") {
                throw ApiError_1.ApiError.badRequest(`Setting ${entry.key} requires a string value`, "INVALID_SETTING_VALUE");
            }
            return value;
        }
        default:
            throw ApiError_1.ApiError.internal(`Unsupported setting valueType for ${entry.key}`);
    }
}
function toPublicEntry(entry, row) {
    let value = entry.defaultValue;
    let isOverridden = false;
    if (row) {
        try {
            value = validateValue(entry, row.value === undefined ? null : row.value);
            isOverridden = true;
        }
        catch (err) {
            // A manually-edited/stale DB row that no longer passes validation -
            // fail safe to the registered default rather than surfacing a
            // corrupt/invalid value to a caller (Step 17 fail-safe requirement).
            logger_1.logger.warn(`[settings] stored value for ${entry.key} failed validation - falling back to registry default`, { key: entry.key });
            value = entry.defaultValue;
            isOverridden = false;
        }
    }
    return {
        key: entry.key,
        category: entry.category,
        valueType: entry.valueType,
        description: entry.description,
        defaultValue: entry.defaultValue,
        min: entry.min ?? null,
        max: entry.max ?? null,
        allowedValues: entry.allowedValues ?? null,
        nullable: !!entry.nullable,
        value,
        isOverridden,
        version: row ? row.version : 0,
        updatedBy: row ? row.updatedBy : null,
        updatedAt: row ? row.updatedAt : null,
    };
}
exports.SettingsService = {
    // The single read path every runtime consumer goes through. Precedence:
    // (1) a valid SystemSetting DB row for `key`, if present and it passes
    // the registry's own type/range validation, else (2) the registry's
    // defaultValue. Never throws for a REGISTERED key - a DB outage or a
    // corrupt stored value both fail safe to the registered default (Step
    // 17); an UNKNOWN key (never true for the internal helpers below, which
    // only ever pass hardcoded registered keys) still throws, since that is
    // a programming error, not a runtime condition to fail safe against.
    async getEffectiveValue(key) {
        const entry = getRegistryEntry(key);
        if (!entry) {
            throw ApiError_1.ApiError.badRequest(`Unknown setting: ${typeof key === "string" ? key : "(invalid)"}`, "UNKNOWN_SETTING_KEY");
        }
        let row;
        try {
            row = await models_1.SystemSetting.findOne({ key });
        }
        catch (err) {
            logger_1.logger.warn(`[settings] DB read failed for ${key} - falling back to registry default`, { key, error: err?.message });
            return entry.defaultValue;
        }
        if (!row) {
            return entry.defaultValue;
        }
        try {
            return validateValue(entry, row.value === undefined ? null : row.value);
        }
        catch (err) {
            logger_1.logger.warn(`[settings] stored value for ${key} failed validation - falling back to registry default`, { key });
            return entry.defaultValue;
        }
    },
    async listSettings({ category } = {}) {
        const entries = Object.values(settingsRegistry_1.SETTINGS_REGISTRY).filter((e) => !category || e.category === category);
        const keys = entries.map((e) => e.key);
        const rows = await models_1.SystemSetting.find({ key: { $in: keys } });
        const rowMap = new Map(rows.map((r) => [r.key, r]));
        return entries.map((entry) => toPublicEntry(entry, rowMap.get(entry.key) || null));
    },
    async getSetting(key) {
        const entry = getRegistryEntry(key);
        if (!entry) {
            throw ApiError_1.ApiError.badRequest(`Unknown setting: ${typeof key === "string" ? key : "(invalid)"}`, "UNKNOWN_SETTING_KEY");
        }
        const row = await models_1.SystemSetting.findOne({ key: entry.key });
        return toPublicEntry(entry, row);
    },
    // Optimistic-concurrency update (mirrors Wallet.version exactly): the
    // conditional match `{key, version: matchVersion}` is the ONLY authority
    // for "did this race with someone else's write" - never a
    // read-then-blind-write. A caller who lost the race gets a clean
    // SETTING_CONFLICT, never a silent overwrite.
    async updateSetting({ key, value, expectedVersion, actorId, actorRole, req }) {
        const entry = getRegistryEntry(key);
        if (!entry) {
            throw ApiError_1.ApiError.badRequest(`Unknown setting: ${typeof key === "string" ? key : "(invalid)"}`, "UNKNOWN_SETTING_KEY");
        }
        const validated = validateValue(entry, value === undefined ? null : value);
        const existing = await models_1.SystemSetting.findOne({ key: entry.key });
        const currentVersion = existing ? existing.version : 0;
        const matchVersion = expectedVersion ?? currentVersion;
        const oldValue = existing ? (existing.value === undefined ? null : existing.value) : entry.defaultValue;
        let updated;
        try {
            updated = await models_1.SystemSetting.findOneAndUpdate({ key: entry.key, version: matchVersion }, {
                $set: {
                    value: validated,
                    updatedBy: actorId,
                    valueType: entry.valueType,
                    category: entry.category,
                    description: entry.description,
                },
                $inc: { version: 1 },
            }, { new: true, upsert: !existing });
        }
        catch (err) {
            // Duplicate-key race on the very first write for this key (two
            // concurrent callers both saw "no row yet" and both tried to
            // upsert-create it) - translate into the same clean conflict,
            // never a raw 500.
            if (err?.code === 11000) {
                throw ApiError_1.ApiError.conflict("Setting was changed by someone else - refresh and retry", "SETTING_CONFLICT");
            }
            throw err;
        }
        if (!updated) {
            throw ApiError_1.ApiError.conflict("Setting was changed by someone else - refresh and retry", "SETTING_CONFLICT");
        }
        // Safe metadata only - {key, oldValue, newValue}, never the whole
        // document. Every registered value is a primitive (number/boolean/
        // null) - there is no secret/object to mask here, the allowlist
        // itself is what keeps this collection free of anything sensitive.
        await (0, audit_service_1.recordAudit)({
            actorId,
            actorRole: actorRole || "UNKNOWN",
            action: shared_1.AuditAction.SETTINGS_CHANGED,
            entityType: "SystemSetting",
            entityId: entry.key,
            metadata: { key: entry.key, oldValue, newValue: validated },
            req,
        });
        return toPublicEntry(entry, updated);
    },
    // Thin, fallback-baked helpers for the real runtime consumers - reads
    // cleanly at each call site instead of every consumer repeating
    // getEffectiveValue("...") with the exact right key string.
    async getRequestModifyWindowMinutes() {
        return this.getEffectiveValue("REQUEST_MODIFY_WINDOW_MINUTES");
    },
    async getDocumentMaxFileSizeMb() {
        return this.getEffectiveValue("DOCUMENT_MAX_FILE_SIZE_MB");
    },
    async getReportMaxDateRangeDays() {
        return this.getEffectiveValue("REPORT_MAX_DATE_RANGE_DAYS");
    },
    async getLowProviderBalanceThreshold() {
        return this.getEffectiveValue("ESTAMP_PROVIDER_LOW_BALANCE_THRESHOLD");
    },
    async getBulkEstampMaxRows() {
        return this.getEffectiveValue("BULK_ESTAMP_MAX_ROWS");
    },
    async getBulkEstampMaxFileSizeMb() {
        return this.getEffectiveValue("BULK_ESTAMP_MAX_FILE_SIZE_MB");
    },
    async isFeatureEnabled(flagKey) {
        return this.getEffectiveValue(flagKey);
    },
};
