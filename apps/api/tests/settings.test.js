// Phase 17 - Advanced System Settings & Configuration Management. Overhauls
// the existing-but-dead SystemSetting mechanism into a real, centralized,
// typed, validated, permission-gated, audited business-settings system.
//
// Covers: registry behavior (allowlist, type/range validation, fail-safe
// fallback to registry defaults that mirror env.js's current defaults),
// permissions (SETTINGS_VIEW/SETTINGS_MANAGE wiring - fixes the previous
// "any authenticated user can read everything" open-read bug), security
// (key-injection/prototype-pollution-shaped keys rejected via the allowlist,
// object/array-shaped values rejected at the validation layer), updates
// (immediate readability, optimistic-concurrency conflict handling, audit
// metadata shape), runtime integration (REQUEST_MODIFY_WINDOW_MINUTES,
// DOCUMENT_MAX_FILE_SIZE_MB, REPORT_MAX_DATE_RANGE_DAYS unifying the two
// previously-duplicated 366-day constants, the low-balance threshold
// tri-state), fail-safe defaults under a simulated DB outage, feature flags
// (BULK_ESTAMP_ENABLED/REPORTS_ENABLED/POLICY_ACKNOWLEDGEMENT_ENABLED - the
// last one being the single sanctioned, default-off bridge to Phase 16's
// PolicyService.assertAcceptedCurrent), secrets (this collection is never
// anything but registry-shaped primitives), and tenant isolation (settings
// are platform-global only - no organization concept exists here at all).
import { describe, it, expect, vi } from "vitest";
import "./setup";
import mongoose from "mongoose";
import {
  Organization,
  Wallet,
  Article,
  ArticleVersion,
  AuditLog,
  SystemSetting,
  EStampRequest,
  Policy,
  PolicyAcknowledgement,
  PolicyType,
} from "../src/models/index.js";
import { Role, Permission, AuditAction, OrganizationStatus, getEffectivePermissions, DEFAULT_ROLE_PERMISSIONS } from "@launcherdesk/shared";
import { SettingsService } from "../src/services/settings.service.js";
import { SETTINGS_REGISTRY } from "../src/config/settingsRegistry.js";
import * as settingsController from "../src/controllers/settings.controller.js";
import { requirePermission } from "../src/middleware/authorize.js";
import { requireFeatureEnabled } from "../src/middleware/requireFeatureEnabled.js";
import { updateSettingSchema } from "@launcherdesk/validation";
import { makeReq, makeRes, runController, runMiddleware } from "./helpers/http.js";
import { EStampRequestService } from "../src/services/estamp-request.service.js";
import { FileService } from "../src/services/file.service.js";
import { EStampProviderService } from "../src/services/estamp-provider.service.js";
import { ReportService } from "../src/services/report.service.js";
import { PolicyService } from "../src/services/policy.service.js";

let seq = 0;
function uid() {
  seq += 1;
  return `${Date.now()}-${seq}-${Math.random().toString(36).slice(2, 8)}`;
}

async function createOrg(overrides = {}) {
  return Organization.create({
    name: overrides.name || `Settings Test Org ${uid()}`,
    contactEmail: `settings-${uid()}@example.com`,
    contactPhone: "9999999999",
    createdBy: new mongoose.Types.ObjectId(),
    status: OrganizationStatus.ACTIVE,
    isEstampServiceEnabled: true,
  });
}

async function makeOrgWithArticle({ balance = 1000000, fixedAmount = 500 } = {}) {
  const creator = new mongoose.Types.ObjectId();
  const org = await createOrg();
  await Wallet.create({ organizationId: org._id, balance });
  const article = await Article.create({ stateCode: "KA", articleCode: `ART-SET-${uid()}`, title: "Test Article", createdBy: creator, currentVersion: 1 });
  await ArticleVersion.create({ articleId: article._id, versionNumber: 1, calculationRule: { type: "FIXED", fixedAmount }, createdBy: creator });
  return { org, article };
}

function reqAs(role, organizationId, permissionsOverride, overrides = {}) {
  return makeReq({
    user: {
      id: new mongoose.Types.ObjectId().toString(),
      role,
      organizationId: organizationId ? organizationId.toString() : null,
      permissions: permissionsOverride ?? getEffectivePermissions(role, []),
    },
    ...overrides,
  });
}

describe("Registry - allowlist, validation, and fail-safe defaults", () => {
  it("with no SystemSetting rows at all, every registered key's effective value matches env.js's CURRENT default exactly (fresh-install behavior is unchanged)", async () => {
    expect(await SettingsService.getEffectiveValue("REQUEST_MODIFY_WINDOW_MINUTES")).toBe(20);
    expect(await SettingsService.getEffectiveValue("DOCUMENT_MAX_FILE_SIZE_MB")).toBe(10);
    expect(await SettingsService.getEffectiveValue("REPORT_MAX_DATE_RANGE_DAYS")).toBe(366);
    expect(await SettingsService.getEffectiveValue("ESTAMP_PROVIDER_LOW_BALANCE_THRESHOLD")).toBeNull();
    expect(await SettingsService.getEffectiveValue("BULK_ESTAMP_MAX_ROWS")).toBe(500);
    expect(await SettingsService.getEffectiveValue("BULK_ESTAMP_MAX_FILE_SIZE_MB")).toBe(10);
    expect(await SettingsService.getEffectiveValue("BULK_ESTAMP_ENABLED")).toBe(true);
    expect(await SettingsService.getEffectiveValue("REPORTS_ENABLED")).toBe(true);
    expect(await SettingsService.getEffectiveValue("POLICY_ACKNOWLEDGEMENT_ENABLED")).toBe(false);
  });

  it("rejects an unknown/unregistered key with UNKNOWN_SETTING_KEY - never reaches Mongo", async () => {
    await expect(SettingsService.getEffectiveValue("NOT_A_REAL_SETTING")).rejects.toMatchObject({ statusCode: 400, code: "UNKNOWN_SETTING_KEY" });
    await expect(SettingsService.getSetting("NOT_A_REAL_SETTING")).rejects.toMatchObject({ code: "UNKNOWN_SETTING_KEY" });
  });

  it("a correct-type, in-range INTEGER update is accepted and immediately effective", async () => {
    const actorId = new mongoose.Types.ObjectId();
    const updated = await SettingsService.updateSetting({ key: "REQUEST_MODIFY_WINDOW_MINUTES", value: 45, actorId, actorRole: Role.MASTER_ADMIN });
    expect(updated.value).toBe(45);
    expect(await SettingsService.getEffectiveValue("REQUEST_MODIFY_WINDOW_MINUTES")).toBe(45);
  });

  it("a correct BOOLEAN update is accepted for a FEATURE_FLAG setting", async () => {
    const actorId = new mongoose.Types.ObjectId();
    const updated = await SettingsService.updateSetting({ key: "BULK_ESTAMP_ENABLED", value: false, actorId, actorRole: Role.MASTER_ADMIN });
    expect(updated.value).toBe(false);
  });

  it("a wrong-type value is rejected (string for an INTEGER setting)", async () => {
    const actorId = new mongoose.Types.ObjectId();
    await expect(
      SettingsService.updateSetting({ key: "REQUEST_MODIFY_WINDOW_MINUTES", value: "not a number", actorId, actorRole: Role.MASTER_ADMIN })
    ).rejects.toMatchObject({ code: "INVALID_SETTING_VALUE" });
  });

  it("a wrong-type value is rejected (string for a BOOLEAN setting)", async () => {
    const actorId = new mongoose.Types.ObjectId();
    await expect(
      SettingsService.updateSetting({ key: "BULK_ESTAMP_ENABLED", value: "true", actorId, actorRole: Role.MASTER_ADMIN })
    ).rejects.toMatchObject({ code: "INVALID_SETTING_VALUE" });
  });

  it("an out-of-range value is rejected", async () => {
    const actorId = new mongoose.Types.ObjectId();
    await expect(
      SettingsService.updateSetting({ key: "REQUEST_MODIFY_WINDOW_MINUTES", value: 99999, actorId, actorRole: Role.MASTER_ADMIN })
    ).rejects.toMatchObject({ code: "OUT_OF_RANGE" });
  });

  it("a manually-corrupted stored value fails safe to the registry default rather than being surfaced as-is", async () => {
    // Simulates a directly-edited DB row that bypassed the service's own
    // validation (e.g. manual Mongo edit) - the registry re-validates on
    // every read and never trusts a stored value blindly.
    await SystemSetting.create({ key: "REQUEST_MODIFY_WINDOW_MINUTES", value: "corrupted-not-a-number", valueType: "INTEGER", category: "BUSINESS" });
    const value = await SettingsService.getEffectiveValue("REQUEST_MODIFY_WINDOW_MINUTES");
    expect(value).toBe(20); // registry default, never the corrupted value, never a thrown error
  });
});

describe("Permissions", () => {
  it("Master Admin (all-permissions rule) passes both SETTINGS_VIEW and SETTINGS_MANAGE", async () => {
    const req = reqAs(Role.MASTER_ADMIN, null, Object.values(Permission));
    const view = await runMiddleware(requirePermission(Permission.SETTINGS_VIEW), req, makeRes());
    const manage = await runMiddleware(requirePermission(Permission.SETTINGS_MANAGE), req, makeRes());
    expect(view.threw).toBeNull();
    expect(manage.threw).toBeNull();
  });

  it("neither permission is in ASSISTANT_MASTER_ADMIN's default template, USER's, ADMIN's, or SUPER_ADMIN's defaults (confirmed already-correct scope - no DEFAULT_ROLE_PERMISSIONS change was needed)", () => {
    for (const role of [Role.ASSISTANT_MASTER_ADMIN, Role.USER, Role.ADMIN, Role.SUPER_ADMIN]) {
      expect(DEFAULT_ROLE_PERMISSIONS[role]).not.toContain(Permission.SETTINGS_VIEW);
      expect(DEFAULT_ROLE_PERMISSIONS[role]).not.toContain(Permission.SETTINGS_MANAGE);
    }
  });

  it("Assistant Master Admin without an explicit grant is rejected for both", async () => {
    const req = reqAs(Role.ASSISTANT_MASTER_ADMIN, null, []);
    const view = await runMiddleware(requirePermission(Permission.SETTINGS_VIEW), req, makeRes());
    const manage = await runMiddleware(requirePermission(Permission.SETTINGS_MANAGE), req, makeRes());
    expect(view.threw?.statusCode).toBe(403);
    expect(manage.threw?.statusCode).toBe(403);
  });

  it("Assistant Master Admin explicitly granted both is allowed", async () => {
    const permissions = getEffectivePermissions(Role.ASSISTANT_MASTER_ADMIN, [Permission.SETTINGS_VIEW, Permission.SETTINGS_MANAGE]);
    const req = reqAs(Role.ASSISTANT_MASTER_ADMIN, null, permissions);
    const view = await runMiddleware(requirePermission(Permission.SETTINGS_VIEW), req, makeRes());
    const manage = await runMiddleware(requirePermission(Permission.SETTINGS_MANAGE), req, makeRes());
    expect(view.threw).toBeNull();
    expect(manage.threw).toBeNull();
  });

  it("SUPER_ADMIN, ADMIN and USER are all denied both by default - fixes the previous 'any authenticated user can read everything' bug", async () => {
    for (const role of [Role.SUPER_ADMIN, Role.ADMIN, Role.USER]) {
      const req = reqAs(role, new mongoose.Types.ObjectId());
      const view = await runMiddleware(requirePermission(Permission.SETTINGS_VIEW), req, makeRes());
      const manage = await runMiddleware(requirePermission(Permission.SETTINGS_MANAGE), req, makeRes());
      expect(view.threw?.statusCode).toBe(403);
      expect(manage.threw?.statusCode).toBe(403);
    }
  });
});

describe("Security", () => {
  it("a $where/__proto__/constructor/prototype-shaped key is rejected as UNKNOWN_SETTING_KEY before any Mongo query - the allowlist is an own-property check, structurally immune to these", async () => {
    for (const badKey of ["$where", "__proto__", "constructor", "prototype", "toString", "hasOwnProperty"]) {
      await expect(SettingsService.getSetting(badKey)).rejects.toMatchObject({ statusCode: 400, code: "UNKNOWN_SETTING_KEY" });
      await expect(
        SettingsService.updateSetting({ key: badKey, value: 1, actorId: new mongoose.Types.ObjectId(), actorRole: Role.MASTER_ADMIN })
      ).rejects.toMatchObject({ code: "UNKNOWN_SETTING_KEY" });
    }
  });

  it("an object/array-shaped or oversized/deeply-nested value is rejected at the validation layer (.strict() permissive-but-bounded union) before it ever reaches the service", () => {
    expect(updateSettingSchema.safeParse({ value: { evil: "payload" } }).success).toBe(false);
    expect(updateSettingSchema.safeParse({ value: [1, 2, 3] }).success).toBe(false);
    expect(updateSettingSchema.safeParse({ value: { a: { b: { c: { d: 1 } } } } }).success).toBe(false);
    expect(updateSettingSchema.safeParse({ value: "45" }).success).toBe(false); // strings rejected outright
    expect(updateSettingSchema.safeParse({ value: undefined }).success).toBe(false); // value is required
    expect(updateSettingSchema.safeParse({ value: 1, extraField: "not allowed" }).success).toBe(false); // .strict()
  });

  it("a legitimate number/boolean/null value (with optional expectedVersion) passes the validation layer", () => {
    expect(updateSettingSchema.safeParse({ value: 45 }).success).toBe(true);
    expect(updateSettingSchema.safeParse({ value: true }).success).toBe(true);
    expect(updateSettingSchema.safeParse({ value: null }).success).toBe(true); // explicit "unset" for a nullable setting
    expect(updateSettingSchema.safeParse({ value: 45, expectedVersion: 2 }).success).toBe(true);
  });

  it("an unauthorized update attempt is rejected via requirePermission before the controller ever runs", async () => {
    const req = reqAs(Role.USER, new mongoose.Types.ObjectId(), [], { params: { key: "REQUEST_MODIFY_WINDOW_MINUTES" }, body: { value: 999 } });
    const { threw } = await runMiddleware(requirePermission(Permission.SETTINGS_MANAGE), req, makeRes());
    expect(threw?.statusCode).toBe(403);
  });
});

describe("Updates & concurrency", () => {
  it("a valid update persists and is readable immediately - no caching delay", async () => {
    const actorId = new mongoose.Types.ObjectId();
    await SettingsService.updateSetting({ key: "DOCUMENT_MAX_FILE_SIZE_MB", value: 25, actorId, actorRole: Role.MASTER_ADMIN });
    expect(await SettingsService.getEffectiveValue("DOCUMENT_MAX_FILE_SIZE_MB")).toBe(25);
  });

  it("CONCURRENCY: two concurrent updates to the same key with the same expectedVersion - exactly one succeeds, the other gets SETTING_CONFLICT, never a silently-overwritten value", async () => {
    const actorId = new mongoose.Types.ObjectId();
    const initial = await SettingsService.updateSetting({ key: "BULK_ESTAMP_MAX_ROWS", value: 500, actorId, actorRole: Role.MASTER_ADMIN });
    const startVersion = initial.version;

    const results = await Promise.allSettled([
      SettingsService.updateSetting({ key: "BULK_ESTAMP_MAX_ROWS", value: 600, expectedVersion: startVersion, actorId, actorRole: Role.MASTER_ADMIN }),
      SettingsService.updateSetting({ key: "BULK_ESTAMP_MAX_ROWS", value: 700, expectedVersion: startVersion, actorId, actorRole: Role.MASTER_ADMIN }),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect(rejected[0].reason).toMatchObject({ statusCode: 409, code: "SETTING_CONFLICT" });

    const finalValue = await SettingsService.getEffectiveValue("BULK_ESTAMP_MAX_ROWS");
    expect([600, 700]).toContain(finalValue); // exactly the winner's value - never a merged/corrupted state
  });

  it("a stale expectedVersion (not matching current) is rejected with SETTING_CONFLICT, never silently applied", async () => {
    const actorId = new mongoose.Types.ObjectId();
    const first = await SettingsService.updateSetting({ key: "BULK_ESTAMP_MAX_FILE_SIZE_MB", value: 5, actorId, actorRole: Role.MASTER_ADMIN });
    await expect(
      SettingsService.updateSetting({ key: "BULK_ESTAMP_MAX_FILE_SIZE_MB", value: 6, expectedVersion: first.version - 1, actorId, actorRole: Role.MASTER_ADMIN })
    ).rejects.toMatchObject({ code: "SETTING_CONFLICT" });
    expect(await SettingsService.getEffectiveValue("BULK_ESTAMP_MAX_FILE_SIZE_MB")).toBe(5); // unchanged
  });

  it("audit record has correct actor/old-safe-value/new-safe-value, never the whole document", async () => {
    const actorId = new mongoose.Types.ObjectId();
    await SettingsService.updateSetting({ key: "REPORTS_ENABLED", value: false, actorId, actorRole: Role.SUPER_ADMIN });
    const entry = await AuditLog.findOne({ action: AuditAction.SETTINGS_CHANGED, entityId: "REPORTS_ENABLED" }).sort({ createdAt: -1 });
    expect(entry).not.toBeNull();
    expect(entry.actorId.toString()).toBe(actorId.toString());
    expect(entry.actorRole).toBe(Role.SUPER_ADMIN);
    expect(entry.metadata.key).toBe("REPORTS_ENABLED");
    expect(entry.metadata.oldValue).toBe(true); // registry default, since no row existed before this write
    expect(entry.metadata.newValue).toBe(false);
    expect(entry.metadata).not.toHaveProperty("updatedBy");
    expect(entry.metadata).not.toHaveProperty("_id");
  });
});

describe("Runtime integration - REQUEST_MODIFY_WINDOW_MINUTES", () => {
  it("a changed setting affects a NEWLY created request's modificationDeadline, while an ALREADY-created request's stored deadline is provably unaffected", async () => {
    const { org, article } = await makeOrgWithArticle();
    const creator = new mongoose.Types.ObjectId();

    const { request: requestBefore } = await EStampRequestService.createRequest({
      organizationId: org._id,
      createdBy: creator,
      stateCode: "KA",
      articleId: article._id.toString(),
      firstParty: "Alice",
      secondParty: "Bob",
      descriptionOfDocument: "Doc",
      considerationPrice: 0,
      stampDutyPaidBy: "Alice",
      numberOfEStamps: 1,
      // Distinct idempotencyKey per call - two requests for the SAME org with
      // no idempotencyKey collide on EStampRequest's
      // {organizationId, idempotencyKey} sparse-but-still-compound-indexed
      // unique index (a pre-existing model quirk, unrelated to this phase).
      idempotencyKey: uid(),
    });
    const deadlineBeforeMs = requestBefore.modificationDeadline.getTime();
    const approxDefaultMinutes = Math.round((deadlineBeforeMs - requestBefore.createdAt.getTime()) / 60000);
    expect(approxDefaultMinutes).toBe(20); // registry default, matches env.js's current default

    await SettingsService.updateSetting({ key: "REQUEST_MODIFY_WINDOW_MINUTES", value: 5, actorId: new mongoose.Types.ObjectId(), actorRole: Role.MASTER_ADMIN });

    const { request: requestAfter } = await EStampRequestService.createRequest({
      organizationId: org._id,
      createdBy: creator,
      stateCode: "KA",
      articleId: article._id.toString(),
      firstParty: "Carol",
      secondParty: "Dave",
      descriptionOfDocument: "Doc2",
      considerationPrice: 0,
      stampDutyPaidBy: "Carol",
      numberOfEStamps: 1,
      idempotencyKey: uid(),
    });
    const approxNewMinutes = Math.round((requestAfter.modificationDeadline.getTime() - requestAfter.createdAt.getTime()) / 60000);
    expect(approxNewMinutes).toBe(5);

    // The FIRST request's stored deadline must be byte-for-byte unchanged -
    // a setting change only affects requests created AFTER the change.
    const reloaded = await EStampRequest.findById(requestBefore._id);
    expect(reloaded.modificationDeadline.getTime()).toBe(deadlineBeforeMs);
  });
});

describe("Runtime integration - DOCUMENT_MAX_FILE_SIZE_MB", () => {
  it("a changed setting affects FileService.validate's LIVE rejection boundary immediately, with no restart", async () => {
    const justUnderDefault = 10 * 1024 * 1024 - 1024;
    await expect(FileService.validate("application/pdf", justUnderDefault)).resolves.toBeUndefined();

    await SettingsService.updateSetting({ key: "DOCUMENT_MAX_FILE_SIZE_MB", value: 1, actorId: new mongoose.Types.ObjectId(), actorRole: Role.MASTER_ADMIN });

    // The SAME file size that passed under the 10MB default now fails under the new, live 1MB limit.
    await expect(FileService.validate("application/pdf", justUnderDefault)).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
    // A file within the NEW limit still passes.
    await expect(FileService.validate("application/pdf", 512 * 1024)).resolves.toBeUndefined();
  });
});

describe("Runtime integration - REPORT_MAX_DATE_RANGE_DAYS unifies the two previously-duplicated 366-day constants", () => {
  it("a changed setting affects estamp-provider.service.js's usage endpoint AND report.service.js's report endpoints identically - proving the unification removed the duplicate-constant drift risk", async () => {
    await SettingsService.updateSetting({ key: "REPORT_MAX_DATE_RANGE_DAYS", value: 10, actorId: new mongoose.Types.ObjectId(), actorRole: Role.MASTER_ADMIN });

    const from = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
    const to = new Date().toISOString();

    await expect(EStampProviderService.getUsage({ from, to })).rejects.toMatchObject({ code: "RANGE_TOO_LARGE" });
    await expect(ReportService.getRequestReport({ from, to })).rejects.toMatchObject({ code: "RANGE_TOO_LARGE" });
    await expect(ReportService.getFinancialReport({ from, to })).rejects.toMatchObject({ code: "RANGE_TOO_LARGE" });
    await expect(ReportService.getBulkReport({ from, to })).rejects.toMatchObject({ code: "RANGE_TOO_LARGE" });

    // A range within the new, smaller limit still succeeds for both call sites.
    const shortFrom = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    await expect(EStampProviderService.getUsage({ from: shortFrom, to })).resolves.toBeTruthy();
    await expect(ReportService.getRequestReport({ from: shortFrom, to })).resolves.toBeTruthy();
  });
});

describe("Runtime integration - low-balance threshold tri-state (null = never alert, never treated as 0)", () => {
  it("unset (no DB row) preserves the null/never-alert default", async () => {
    expect(await SettingsService.getLowProviderBalanceThreshold()).toBeNull();
  });

  it("can be explicitly set to a number, then explicitly cleared back to null (unset) via the update API", async () => {
    const actorId = new mongoose.Types.ObjectId();
    await SettingsService.updateSetting({ key: "ESTAMP_PROVIDER_LOW_BALANCE_THRESHOLD", value: 500, actorId, actorRole: Role.MASTER_ADMIN });
    expect(await SettingsService.getLowProviderBalanceThreshold()).toBe(500);

    const row = await SystemSetting.findOne({ key: "ESTAMP_PROVIDER_LOW_BALANCE_THRESHOLD" });
    await SettingsService.updateSetting({ key: "ESTAMP_PROVIDER_LOW_BALANCE_THRESHOLD", value: null, expectedVersion: row.version, actorId, actorRole: Role.MASTER_ADMIN });
    expect(await SettingsService.getLowProviderBalanceThreshold()).toBeNull();
  });
});

describe("Fail-safe defaults - a DB outage never propagates as a 500 to the caller", () => {
  it("a SystemSetting.findOne rejection falls back to the registry default for getEffectiveValue directly", async () => {
    const spy = vi.spyOn(SystemSetting, "findOne").mockImplementationOnce(() => {
      throw new Error("simulated DB outage");
    });
    const value = await SettingsService.getEffectiveValue("REQUEST_MODIFY_WINDOW_MINUTES");
    expect(value).toBe(20);
    spy.mockRestore();
  });

  it("a consumer helper (getDocumentMaxFileSizeMb) also fails safe on a simulated DB outage", async () => {
    const spy = vi.spyOn(SystemSetting, "findOne").mockImplementationOnce(() => {
      throw new Error("simulated DB outage");
    });
    const value = await SettingsService.getDocumentMaxFileSizeMb();
    expect(value).toBe(10);
    spy.mockRestore();
  });

  it("a feature-flag check (isFeatureEnabled) also fails safe on a simulated DB outage - never crashes the gated route", async () => {
    const spy = vi.spyOn(SystemSetting, "findOne").mockImplementationOnce(() => {
      throw new Error("simulated DB outage");
    });
    const enabled = await SettingsService.isFeatureEnabled("BULK_ESTAMP_ENABLED");
    expect(enabled).toBe(true); // registry default
    spy.mockRestore();
  });
});

describe("Feature flags", () => {
  it("BULK_ESTAMP_ENABLED default (true) lets the feature gate pass", async () => {
    const { threw } = await runMiddleware(requireFeatureEnabled("BULK_ESTAMP_ENABLED", "Bulk E-Stamp is currently disabled"), makeReq(), makeRes());
    expect(threw).toBeNull();
  });

  it("BULK_ESTAMP_ENABLED=false cleanly blocks with an honest 503 FEATURE_DISABLED, not a confusing 404", async () => {
    await SettingsService.updateSetting({ key: "BULK_ESTAMP_ENABLED", value: false, actorId: new mongoose.Types.ObjectId(), actorRole: Role.MASTER_ADMIN });
    const { threw } = await runMiddleware(requireFeatureEnabled("BULK_ESTAMP_ENABLED", "Bulk E-Stamp is currently disabled"), makeReq(), makeRes());
    expect(threw?.statusCode).toBe(503);
    expect(threw?.code).toBe("FEATURE_DISABLED");
  });

  it("REPORTS_ENABLED=false likewise blocks the reporting surface with an honest 503", async () => {
    await SettingsService.updateSetting({ key: "REPORTS_ENABLED", value: false, actorId: new mongoose.Types.ObjectId(), actorRole: Role.MASTER_ADMIN });
    const { threw } = await runMiddleware(requireFeatureEnabled("REPORTS_ENABLED", "Reports are currently disabled"), makeReq(), makeRes());
    expect(threw?.statusCode).toBe(503);
    expect(threw?.code).toBe("FEATURE_DISABLED");
  });

  describe("POLICY_ACKNOWLEDGEMENT_ENABLED - the single sanctioned Phase 16 bridge", () => {
    it("default OFF: request creation succeeds with ZERO policy acceptance on record - today's behavior, byte-for-byte unchanged", async () => {
      const { org, article } = await makeOrgWithArticle();
      const creator = new mongoose.Types.ObjectId();
      expect(await PolicyAcknowledgement.countDocuments({ userId: creator })).toBe(0);

      const { request } = await EStampRequestService.createRequest({
        organizationId: org._id,
        createdBy: creator,
        stateCode: "KA",
        articleId: article._id.toString(),
        firstParty: "Alice",
        secondParty: "Bob",
        descriptionOfDocument: "Doc",
        considerationPrice: 0,
        stampDutyPaidBy: "Alice",
        numberOfEStamps: 1,
      });
      expect(request).toBeTruthy();
      expect(await PolicyAcknowledgement.countDocuments({ userId: creator })).toBe(0);
    });

    it("flag ON + no acceptance: request creation is rejected with CURRENT_POLICY_ACCEPTANCE_REQUIRED, and the wallet is never debited for the rejected attempt", async () => {
      const { org, article } = await makeOrgWithArticle({ balance: 100000, fixedAmount: 500 });
      const creator = new mongoose.Types.ObjectId();
      await SettingsService.updateSetting({ key: "POLICY_ACKNOWLEDGEMENT_ENABLED", value: true, actorId: new mongoose.Types.ObjectId(), actorRole: Role.MASTER_ADMIN });

      await expect(
        EStampRequestService.createRequest({
          organizationId: org._id,
          createdBy: creator,
          stateCode: "KA",
          articleId: article._id.toString(),
          firstParty: "Alice",
          secondParty: "Bob",
          descriptionOfDocument: "Doc",
          considerationPrice: 0,
          stampDutyPaidBy: "Alice",
          numberOfEStamps: 1,
        })
      ).rejects.toMatchObject({ code: "CURRENT_POLICY_ACCEPTANCE_REQUIRED" });

      const wallet = await Wallet.findOne({ organizationId: org._id });
      expect(wallet.balance).toBe(100000); // never debited for a rejected request
    });

    it("flag ON + accepted: request creation succeeds normally", async () => {
      const { org, article } = await makeOrgWithArticle();
      const creator = new mongoose.Types.ObjectId();
      const draft = await PolicyService.createDraft({
        type: PolicyType.TERMS,
        version: "1.0",
        title: "Terms",
        content: "TEST PLACEHOLDER CONTENT - not real legal text",
        createdBy: new mongoose.Types.ObjectId(),
        actorRole: Role.MASTER_ADMIN,
      });
      await PolicyService.publish(draft._id, new mongoose.Types.ObjectId(), Role.MASTER_ADMIN);
      await PolicyService.acknowledge({ userId: creator, organizationId: org._id, policyType: PolicyType.TERMS, actorRole: Role.USER, req: makeReq() });

      await SettingsService.updateSetting({ key: "POLICY_ACKNOWLEDGEMENT_ENABLED", value: true, actorId: new mongoose.Types.ObjectId(), actorRole: Role.MASTER_ADMIN });

      const { request } = await EStampRequestService.createRequest({
        organizationId: org._id,
        createdBy: creator,
        stateCode: "KA",
        articleId: article._id.toString(),
        firstParty: "Alice",
        secondParty: "Bob",
        descriptionOfDocument: "Doc",
        considerationPrice: 0,
        stampDutyPaidBy: "Alice",
        numberOfEStamps: 1,
      });
      expect(request).toBeTruthy();
    });
  });
});

describe("Secrets - the SystemSetting collection is never anything but registry-shaped primitives", () => {
  it("every stored row's key belongs to the registry allowlist, and no row's value is a secret-shaped string", async () => {
    const actorId = new mongoose.Types.ObjectId();
    await SettingsService.updateSetting({ key: "REQUEST_MODIFY_WINDOW_MINUTES", value: 30, actorId, actorRole: Role.MASTER_ADMIN });
    await SettingsService.updateSetting({ key: "BULK_ESTAMP_ENABLED", value: false, actorId, actorRole: Role.MASTER_ADMIN });

    const rows = await SystemSetting.find({});
    expect(rows.length).toBeGreaterThan(0);
    const secretLikePatterns = [/jwt/i, /secret/i, /razorpay/i, /brevo/i, /cloudinary/i, /api[_-]?key/i, /mongodb/i];
    for (const row of rows) {
      expect(Object.prototype.hasOwnProperty.call(SETTINGS_REGISTRY, row.key)).toBe(true);
      const isPrimitiveShape = row.value === null || typeof row.value === "number" || typeof row.value === "boolean";
      expect(isPrimitiveShape).toBe(true);
      if (typeof row.value === "string") {
        for (const pattern of secretLikePatterns) {
          expect(pattern.test(row.value)).toBe(false);
        }
      }
    }
  });
});

describe("Tenant isolation - settings are platform-global only, no organization concept exists here", () => {
  it("a tenant actor (SUPER_ADMIN) gets a clean 403, never a partial/org-scoped view", async () => {
    const req = reqAs(Role.SUPER_ADMIN, new mongoose.Types.ObjectId());
    const view = await runMiddleware(requirePermission(Permission.SETTINGS_VIEW), req, makeRes());
    const manage = await runMiddleware(requirePermission(Permission.SETTINGS_MANAGE), req, makeRes());
    expect(view.threw?.statusCode).toBe(403);
    expect(manage.threw?.statusCode).toBe(403);
  });

  it("an organizationId query param has NO effect on listSettings - it is never consulted, since SystemSetting has no organizationId field at all", async () => {
    await SettingsService.updateSetting({ key: "REQUEST_MODIFY_WINDOW_MINUTES", value: 33, actorId: new mongoose.Types.ObjectId(), actorRole: Role.MASTER_ADMIN });
    const someOrgId = new mongoose.Types.ObjectId().toString();
    const otherOrgId = new mongoose.Types.ObjectId().toString();

    const reqA = reqAs(Role.MASTER_ADMIN, null, Object.values(Permission), { query: { organizationId: someOrgId } });
    const reqB = reqAs(Role.MASTER_ADMIN, null, Object.values(Permission), { query: { organizationId: otherOrgId } });
    const { res: resA } = await runController(settingsController.listSettings, reqA, makeRes());
    const { res: resB } = await runController(settingsController.listSettings, reqB, makeRes());
    expect(resA.body.data).toEqual(resB.body.data); // identical regardless of organizationId
  });
});
