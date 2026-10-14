"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateEstampPackageSchema = exports.createEstampPackageSchema = exports.verifyRazorpayPaymentSchema = exports.createRazorpayOrderSchema = exports.createEStampRequestSchema = exports.updateAssistantAdminPermissionsSchema = exports.createAssistantAdminSchema = exports.createUserSchema = exports.createOrganizationSchema = exports.changePasswordSchema = exports.resetPasswordSchema = exports.forgotPasswordSchema = exports.verifyOtpSchema = exports.loginSchema = void 0;
const zod_1 = require("zod");
const shared_1 = require("@launcherdesk/shared");
// An optional phone field left blank in a form submits "" (empty string),
// not undefined. z.string().min(6).optional() only treats a MISSING key or
// an explicit undefined as "not provided" - an empty string still has to
// satisfy min(6) and fails with no explanation the user can act on (just a
// generic "Validation failed"). Treating "" (and null) as not provided
// before the length check matches what "optional" actually means to a user.
function optionalPhone() {
    return zod_1.z.preprocess((val) => (val === "" || val === null ? undefined : val), zod_1.z.string().min(6).max(20).optional());
}
// Same empty-string-vs-optional fix as optionalPhone() above, for a creator
// (Super Admin/Admin) optionally setting the new account's password
// themselves instead of getting a random one. Same minimum strength as
// every other password field in this file (changePasswordSchema,
// resetPasswordSchema).
function optionalPassword() {
    return zod_1.z.preprocess((val) => (val === "" || val === null ? undefined : val), zod_1.z.string().min(8).max(72).optional());
}
exports.loginSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    password: zod_1.z.string().min(8),
});
exports.verifyOtpSchema = zod_1.z.object({
    otpToken: zod_1.z.string().min(10), // opaque reference to the OTP challenge, not the code
    code: zod_1.z.string().length(6),
});
exports.forgotPasswordSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
});
exports.resetPasswordSchema = zod_1.z.object({
    resetToken: zod_1.z.string().min(10),
    code: zod_1.z.string().length(6).optional(),
    newPassword: zod_1.z.string().min(8),
});
// Logged-in password change. Same strength rule as resetPasswordSchema.
exports.changePasswordSchema = zod_1.z
    .object({
    currentPassword: zod_1.z.string().min(1, "Current password is required"),
    newPassword: zod_1.z.string().min(8, "New password must be at least 8 characters"),
})
    .refine((d) => d.newPassword !== d.currentPassword, { message: "New password must be different from the current password", path: ["newPassword"] });
exports.createOrganizationSchema = zod_1.z.object({
    name: zod_1.z.string().min(2).max(200),
    contactEmail: zod_1.z.string().email(),
    contactPhone: zod_1.z.string().min(6).max(20),
    gstin: zod_1.z.string().optional(),
    address: zod_1.z.string().optional(),
    // Optional at creation (Master Admin only - enforced in the controller).
    assignedAssistantId: zod_1.z.string().regex(/^[a-f0-9]{24}$/i).nullable().optional(),
    // One-step onboarding: the organization's Super Admin is created with it
    // (login email = contactEmail, phone = contactPhone).
    superAdminName: zod_1.z.string().trim().min(2).max(150),
    activateNow: zod_1.z.boolean().default(true),
    enableEstampService: zod_1.z.boolean().default(true),
});
// Partial update - only fields an organization's own profile actually owns.
// Deliberately excludes status/isEstampServiceEnabled (their own dedicated,
// more tightly-gated endpoints) and anything identity/ownership-related
// (_id, createdBy, timestamps) - this is the server-side update whitelist.
exports.updateOrganizationSchema = zod_1.z.object({
    name: zod_1.z.string().min(2).max(200).optional(),
    contactEmail: zod_1.z.string().email().optional(),
    contactPhone: optionalPhone(),
    gstin: zod_1.z.string().optional(),
    address: zod_1.z.string().optional(),
}).strict();
// Provisions the initial Super Admin for a newly created client organization.
// Role/organizationId are never accepted here - both are hard-coded server-side.
exports.provisionSuperAdminSchema = zod_1.z.object({
    name: zod_1.z.string().min(2).max(150),
    email: zod_1.z.string().email(),
    phone: optionalPhone(),
});
exports.createUserSchema = zod_1.z.object({
    name: zod_1.z.string().min(2).max(150),
    email: zod_1.z.string().email(),
    phone: optionalPhone(),
    role: zod_1.z.enum(["SUPER_ADMIN", "ADMIN", "USER"]),
    // Left blank, the server generates one instead (unchanged behaviour).
    password: optionalPassword(),
}).strict();
// Client employee profile edit - deliberately excludes organizationId, role,
// isActive, permissions and anything authentication-related (those have
// their own dedicated, more tightly-gated endpoints/whitelists).
exports.updateClientUserSchema = zod_1.z.object({
    name: zod_1.z.string().min(2).max(150).optional(),
    email: zod_1.z.string().email().optional(),
    phone: optionalPhone(),
}).strict();
// ADMIN <-> USER only. SUPER_ADMIN and internal roles are never reachable
// through this schema - enforced again server-side in the controller.
exports.updateUserRoleSchema = zod_1.z.object({
    role: zod_1.z.enum(["ADMIN", "USER"]),
}).strict();
// Master-Admin-only: creates an ASSISTANT_MASTER_ADMIN. Role is never
// accepted here (it is hard-coded server-side) - only identity fields and
// the permission set Master Admin chooses to grant.
exports.createAssistantAdminSchema = zod_1.z.object({
    name: zod_1.z.string().min(2).max(150),
    email: zod_1.z.string().email(),
    phone: optionalPhone(),
    permissions: zod_1.z.array(zod_1.z.nativeEnum(shared_1.Permission)).optional(),
});
// Master-Admin-only: replaces the full permission set on an Assistant
// Master Admin (grant AND revoke - this is a full overwrite, not a merge).
exports.updateAssistantAdminPermissionsSchema = zod_1.z.object({
    permissions: zod_1.z.array(zod_1.z.nativeEnum(shared_1.Permission)),
});
exports.createEStampRequestSchema = zod_1.z.object({
    stateCode: zod_1.z.string().trim().min(2).max(10),
    articleId: zod_1.z.string().trim().min(1),
    firstParty: zod_1.z.string().trim().min(1).max(300),
    secondParty: zod_1.z.string().trim().min(1).max(300),
    descriptionOfDocument: zod_1.z.string().trim().min(1).max(1000),
    propertyDescription: zod_1.z.string().trim().max(2000).optional(),
    considerationPrice: zod_1.z.number().finite().min(0),
    stampDutyPaidBy: zod_1.z.string().trim().min(1).max(300),
    numberOfEStamps: zod_1.z.number().int().min(1).max(100).default(1),
    extraFields: zod_1.z.record(zod_1.z.any()).optional(), // extensible, state-specific
    // Client-generated once per form submission (e.g. crypto.randomUUID()),
    // resent unchanged on retry - lets the server recognize and safely
    // no-op a duplicate/double-click submission instead of double-charging.
    idempotencyKey: zod_1.z.string().min(10).max(100).optional(),
}).strict();
// Phase 11 - per-row shape for a bulk-upload spreadsheet row. Reuses
// createEStampRequestSchema's field-level rules exactly (never retyped) minus
// idempotencyKey - bulk generates its own deterministic
// `bulk:<batchId>:row:<rowNumber>` key per row, a client/spreadsheet value is
// never accepted for it.
exports.bulkEStampRowSchema = exports.createEStampRequestSchema.omit({ idempotencyKey: true });
// Confirm/cancel take no body - everything comes from the batchId route
// param plus already-stored batch/item state (same no-body pattern as
// cancelRequest/syncEStampOrderStatus elsewhere in this codebase). Kept as
// an explicit empty-strict schema for consistency with the validateBody
// middleware pattern used on every other route.
exports.bulkBatchConfirmSchema = zod_1.z.object({}).strict();
// Modification is intentionally restricted to non-financial descriptive
// fields. stateCode/articleId/considerationPrice/numberOfEStamps are never
// editable here - changing any of them would invalidate the calculation and
// wallet debit already performed at creation time, and this project has no
// re-calculation/partial-refund policy yet (see estamp-request.service.js).
exports.updateEStampRequestSchema = zod_1.z.object({
    firstParty: zod_1.z.string().min(1).max(300).optional(),
    secondParty: zod_1.z.string().min(1).max(300).optional(),
    descriptionOfDocument: zod_1.z.string().min(1).max(1000).optional(),
    propertyDescription: zod_1.z.string().max(2000).optional(),
    stampDutyPaidBy: zod_1.z.string().min(1).max(300).optional(),
    // Amount-changing fields: the server recalculates the amount and moves
    // the wallet reservation by the difference (see modifyRequest).
    considerationPrice: zod_1.z.number().finite().min(0).optional(),
    numberOfEStamps: zod_1.z.number().int().min(1).max(100).optional(),
}).strict();
// Shared shape for a calculation rule, used by both article creation and
// new-version creation - CalculationService (apps/api) remains the only
// place that actually INTERPRETS this rule; this schema only validates its
// shape so a malformed rule can never reach the database.
const calculationRuleSchema = zod_1.z.object({
    type: zod_1.z.enum(["FIXED", "PERCENTAGE", "SLAB", "CUSTOM"]),
    fixedAmount: zod_1.z.number().finite().min(0).optional(),
    percentage: zod_1.z.number().finite().min(0).max(100).optional(),
    slabs: zod_1.z.array(zod_1.z.object({
        minValue: zod_1.z.number().finite().min(0),
        maxValue: zod_1.z.number().finite().min(0).nullable(),
        amount: zod_1.z.number().finite().min(0),
    })).optional(),
    minAmount: zod_1.z.number().finite().min(0).optional(),
    maxAmount: zod_1.z.number().finite().min(0).optional(),
}).strict();
exports.createArticleSchema = zod_1.z.object({
    stateCode: zod_1.z.string().min(2).max(10),
    articleCode: zod_1.z.string().min(1).max(50),
    title: zod_1.z.string().min(1).max(300),
    description: zod_1.z.string().max(2000).optional(),
    calculationRule: calculationRuleSchema,
}).strict();
// Article-level fields that are safe to edit in place without affecting any
// past calculation: state/articleCode are NOT editable (they're part of the
// article's identity and its unique index; changing them out from under
// existing historical requests would be incoherent). Rule changes always go
// through addArticleVersionSchema instead, never a destructive edit here.
exports.updateArticleSchema = zod_1.z.object({
    title: zod_1.z.string().min(1).max(300).optional(),
    description: zod_1.z.string().max(2000).optional(),
}).strict();
exports.setArticleStatusSchema = zod_1.z.object({
    isActive: zod_1.z.boolean(),
}).strict();
// Adds a new, non-destructive ArticleVersion. effectiveFrom may be in the
// future (a pre-published upcoming rate change) - CalculationService will
// not select it until that date arrives. effectiveTo is optional (open-ended).
exports.addArticleVersionSchema = zod_1.z.object({
    calculationRule: calculationRuleSchema,
    effectiveFrom: zod_1.z.coerce.date().optional(),
    effectiveTo: zod_1.z.coerce.date().nullable().optional(),
}).strict();
// Preview-only: same authoritative-calculation inputs as
// createEStampRequestSchema, minus the party/document fields that don't
// affect the amount. Never creates a request or touches the wallet.
exports.calculatePreviewSchema = zod_1.z.object({
    stateCode: zod_1.z.string().min(2).max(10),
    articleId: zod_1.z.string().min(1),
    considerationPrice: zod_1.z.number().finite().min(0),
    numberOfEStamps: zod_1.z.number().int().min(1).max(100).default(1),
}).strict();
// Wallet funding amount, in rupees. Bounded and precision-checked so it can
// never reach Math.round(amount * 100) (paise conversion) with float-error
// surprises or an unreasonable value - organizationId/status/anything else
// is never accepted here, only the amount; organization always comes from
// the authenticated session (or, for internal actors, a separate trusted
// param), never this body.
exports.createRazorpayOrderSchema = zod_1.z.object({
    // packageKey selects a catalog EstampPackage, whose price/plan/stampsCount
    // are resolved server-side (see payment.controller.js) - amount/plan/
    // stampsCount below are then ignored for a catalog purchase and only
    // actually used for a custom top-up (packageKey omitted).
    packageKey: zod_1.z.string().min(1).max(100).optional(),
    amount: zod_1.z
        .number()
        .finite()
        .positive()
        .max(1000000)
        .refine((v) => Math.round(v * 100) === v * 100, "Amount must have at most 2 decimal places")
        .optional(),
    plan: zod_1.z.string().max(200).optional(),
    stampsCount: zod_1.z.number().int().nonnegative().optional(),
    organizationId: zod_1.z.string().optional(), // only ever honored for internal actors, see resolveOrgId
}).strict().refine((d) => d.packageKey || d.amount !== undefined, {
    message: "Either packageKey or amount is required",
    path: ["amount"],
});
exports.createEstampPackageSchema = zod_1.z.object({
    key: zod_1.z.string().min(2).max(100),
    name: zod_1.z.string().min(2).max(200),
    description: zod_1.z.string().max(500).optional(),
    stampsCount: zod_1.z.number().int().nonnegative(),
    price: zod_1.z.number().finite().nonnegative(),
    features: zod_1.z.array(zod_1.z.string().max(200)).optional(),
    validityDays: zod_1.z.number().int().positive().nullable().optional(),
    recommended: zod_1.z.boolean().optional(),
    sortOrder: zod_1.z.number().int().optional(),
}).strict();
exports.updateEstampPackageSchema = zod_1.z.object({
    name: zod_1.z.string().min(2).max(200).optional(),
    description: zod_1.z.string().max(500).optional(),
    stampsCount: zod_1.z.number().int().nonnegative().optional(),
    price: zod_1.z.number().finite().nonnegative().optional(),
    features: zod_1.z.array(zod_1.z.string().max(200)).optional(),
    validityDays: zod_1.z.number().int().positive().nullable().optional(),
    recommended: zod_1.z.boolean().optional(),
    isActive: zod_1.z.boolean().optional(),
    sortOrder: zod_1.z.number().int().optional(),
}).strict();
exports.verifyRazorpayPaymentSchema = zod_1.z.object({
    razorpay_order_id: zod_1.z.string().min(1),
    razorpay_payment_id: zod_1.z.string().min(1),
    razorpay_signature: zod_1.z.string().min(1),
}).strict();
// Phase 16 - Policy (Terms/Privacy/Refund) draft creation. `content` is
// plain text only (never HTML/Markdown) - bounded to a sane max length to
// prevent absurd payloads; no legal review of length limits implied, purely
// a request-size sanity bound.
exports.createPolicySchema = zod_1.z.object({
    type: zod_1.z.enum(["TERMS", "PRIVACY", "REFUND"]),
    version: zod_1.z.string().min(1).max(50),
    title: zod_1.z.string().min(1).max(300),
    content: zod_1.z.string().min(1).max(50000),
}).strict();
// `acknowledgedVersion` is purely advisory/display-reconciliation - the
// server always resolves and stores the CURRENT published version itself,
// and rejects (rather than silently overriding) a stale acknowledgedVersion
// that no longer matches current (see policy.service.js's acknowledge()).
exports.acknowledgePolicySchema = zod_1.z.object({
    policyType: zod_1.z.enum(["TERMS", "PRIVACY", "REFUND"]),
    acknowledgedVersion: zod_1.z.string().min(1).max(50).optional(),
    context: zod_1.z.enum(["LOGIN", "WALLET_FUNDING", "ESTAMP_REQUEST", "GENERAL"]).optional(),
}).strict();
// Phase 17 - PATCH /settings/:key body. `key` itself is taken ONLY from the
// URL param (never the body) and is validated against the settingsRegistry
// allowlist server-side (settings.service.js) - the real per-key
// type/range/enum authority. This HTTP-layer schema is deliberately
// permissive-but-bounded: a setting's real shape varies (number/boolean/
// null-for-"unset"), so this only rejects what can NEVER be a legitimate
// setting value - strings, objects, arrays - before it ever reaches the
// service.
exports.updateSettingSchema = zod_1.z.object({
    value: zod_1.z.union([zod_1.z.number().finite(), zod_1.z.boolean(), zod_1.z.null()]),
    expectedVersion: zod_1.z.number().int().nonnegative().optional(),
}).strict();// ---- Vendor workflow ------------------------------------------------------
// Master-Admin-only: creates a VENDOR. Role, organizationId and permissions
// are hard-coded server-side - only identity fields are accepted.
exports.createVendorSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(2).max(150),
    email: zod_1.z.string().email(),
    phone: optionalPhone(),
}).strict();
exports.updateVendorStatusSchema = zod_1.z.object({
    isActive: zod_1.z.boolean(),
}).strict();
const objectId = zod_1.z.string().regex(/^[a-f0-9]{24}$/i, "Invalid id");
exports.dispatchOrdersSchema = zod_1.z.object({
    orderIds: zod_1.z.array(objectId).min(1).max(200),
    vendorId: objectId,
}).strict();
exports.vendorApproveManySchema = zod_1.z.object({
    orderIds: zod_1.z.array(objectId).min(1).max(200),
}).strict();
exports.vendorRejectSchema = zod_1.z.object({
    reason: zod_1.z.string().trim().min(5).max(500),
}).strict();
exports.vendorCannotProcessSchema = zod_1.z.object({
    reason: zod_1.z.string().trim().min(5).max(500),
}).strict();
