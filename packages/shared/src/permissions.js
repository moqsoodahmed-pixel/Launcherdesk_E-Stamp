"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_ROLE_PERMISSIONS = exports.Permission = void 0;
var Permission;
(function (Permission) {
    Permission["CLIENT_VIEW"] = "client.view";
    Permission["CLIENT_MANAGE"] = "client.manage";
    Permission["USER_VIEW"] = "user.view";
    Permission["USER_CREATE"] = "user.create";
    Permission["USER_MANAGE"] = "user.manage";
    Permission["ESTAMP_CREATE"] = "estamp.create";
    Permission["ESTAMP_VIEW"] = "estamp.view";
    Permission["ESTAMP_MODIFY"] = "estamp.modify";
    Permission["ESTAMP_CANCEL"] = "estamp.cancel";
    Permission["ESTAMP_DOWNLOAD"] = "estamp.download";
    Permission["ESTAMP_UPLOAD"] = "estamp.upload";
    Permission["ARTICLE_VIEW"] = "article.view";
    Permission["ARTICLE_MANAGE"] = "article.manage";
    Permission["PAYMENT_VIEW"] = "payment.view";
    Permission["PAYMENT_MANAGE"] = "payment.manage";
    Permission["WALLET_VIEW"] = "wallet.view";
    Permission["WALLET_MANAGE"] = "wallet.manage";
    Permission["ORDER_VIEW"] = "order.view";
    Permission["ORDER_MANAGE"] = "order.manage";
    Permission["REPORT_VIEW"] = "report.view";
    // Phase 13 - gates the financial section of the reporting surface
    // (payments/wallet/wallet-transactions/request-value totals). A natural
    // extension of REPORT_VIEW + PAYMENT_VIEW + WALLET_VIEW for a role that
    // already holds all three for its own organization - never granted to
    // USER, and never auto-granted to ASSISTANT_MASTER_ADMIN (explicit-grant
    // only, same as every other Assistant-oversight permission).
    Permission["REPORT_FINANCIAL_VIEW"] = "report.financial_view";
    // Phase 13 - gates cross-organization/platform-wide report scope (the
    // organizations report, and an omitted organizationId resolving to a
    // global view rather than requiring one). Master Admin only in
    // practice (via the all-permissions rule); never in any client role's
    // defaults, and never in ASSISTANT_MASTER_ADMIN's default template -
    // only a per-assistant explicit grant can widen a report to global scope.
    Permission["REPORT_GLOBAL_VIEW"] = "report.global_view";
    Permission["AUDIT_VIEW"] = "audit.view";
    Permission["SETTINGS_VIEW"] = "settings.view";
    Permission["SETTINGS_MANAGE"] = "settings.manage";
    Permission["NOTIFICATION_VIEW"] = "notification.view";
    // Internal platform information: the E-Stamp PROVIDER's own account
    // balance/usage - never the client's LauncherDesk wallet (WALLET_VIEW
    // already covers that, and is unrelated to this permission). Not granted
    // to any client role by default; Assistant Master Admin only if Master
    // Admin explicitly grants it.
    Permission["ESTAMP_PROVIDER_VIEW"] = "estamp_provider.view";
    // Phase 11 - bulk upload/preview/confirm/cancel of E-Stamp requests via
    // a CSV/XLSX batch. Default-granted to SUPER_ADMIN and ADMIN (a natural
    // extension of their existing ESTAMP_CREATE), never to USER. Assistant
    // Master Admin only ever gets it via an explicit per-user grant (see
    // DEFAULT_ROLE_PERMISSIONS note below) - it is deliberately left out of
    // that role's default/template array.
    Permission["ESTAMP_BULK_CREATE"] = "estamp.bulk_create";
    // Phase 16 - Terms/Privacy/Refund policy versioning mechanism.
    // Deliberately 2 permissions, not the 3-way view/manage/publish split -
    // there is no distinct real-world actor in this app's role model who
    // should be able to draft a policy version but never publish it, so a
    // separate POLICY_PUBLISH would be an unused permission (the phase spec
    // itself says not to create unnecessary ones). POLICY_VIEW: read drafts
    // and full version history (internal oversight - reading the CURRENT
    // published policy needs no permission at all, it's public).
    // POLICY_MANAGE: create-draft + publish + supersede, bundled as one
    // administrative capability. Neither is in ASSISTANT_MASTER_ADMIN's
    // default template (explicit-grant-only, matching AUDIT_VIEW/
    // ESTAMP_PROVIDER_VIEW) and neither is in any client role's
    // (SUPER_ADMIN/ADMIN/USER) defaults - policies are platform-wide, not
    // per-organization, so there is no "own-org policy" concept to justify a
    // scoped client grant.
    Permission["POLICY_VIEW"] = "policy.view";
    Permission["POLICY_MANAGE"] = "policy.manage";
})(Permission || (exports.Permission = Permission = {}));
const roles_1 = require("./roles");
// Default permission sets per role. Master Admin implicitly has ALL permissions
// (enforced in authorize middleware) - not listed exhaustively here to avoid drift.
//
// NOTE on ASSISTANT_MASTER_ADMIN: unlike every other role, this list is NOT
// auto-granted to every Assistant Master Admin user. It is only the STARTING
// TEMPLATE applied when Master Admin creates a new Assistant Master Admin
// (see user.controller.createAssistantAdmin). After creation, an Assistant
// Master Admin's actual, enforced permission set is whatever Master Admin has
// explicitly stored on that user's `permissions` field - it can be a subset,
// a superset (from this list), or later be edited (grant/revoke) by Master
// Admin at any time. See getEffectivePermissions() below, which is the single
// place this distinction is enforced.
exports.DEFAULT_ROLE_PERMISSIONS = {
    [roles_1.Role.MASTER_ADMIN]: Object.values(Permission),
    [roles_1.Role.ASSISTANT_MASTER_ADMIN]: [
        Permission.CLIENT_VIEW,
        Permission.CLIENT_MANAGE,
        Permission.WALLET_VIEW,
        Permission.WALLET_MANAGE,
        Permission.PAYMENT_VIEW,
        Permission.ESTAMP_VIEW,
        Permission.ESTAMP_UPLOAD,
        Permission.ESTAMP_DOWNLOAD,
        Permission.ORDER_VIEW,
        Permission.REPORT_VIEW,
        Permission.ARTICLE_VIEW,
        Permission.NOTIFICATION_VIEW,
    ],
    [roles_1.Role.SUPER_ADMIN]: [
        Permission.USER_VIEW,
        Permission.USER_CREATE,
        Permission.USER_MANAGE,
        Permission.ESTAMP_CREATE,
        Permission.ESTAMP_VIEW,
        Permission.ESTAMP_MODIFY,
        Permission.ESTAMP_CANCEL,
        Permission.ESTAMP_DOWNLOAD,
        Permission.ESTAMP_BULK_CREATE,
        Permission.ARTICLE_VIEW,
        Permission.PAYMENT_VIEW,
        Permission.PAYMENT_MANAGE,
        Permission.WALLET_VIEW,
        Permission.ORDER_VIEW,
        Permission.REPORT_VIEW,
        Permission.REPORT_FINANCIAL_VIEW,
        // Phase 15 - a natural extension of this role's existing own-org
        // oversight (it already sees REPORT_VIEW for its own organization);
        // audit.controller.js's scoping ALWAYS restricts a tenant actor to
        // req.user.organizationId regardless of this permission, so this is
        // "see who did what in MY org", never cross-tenant visibility.
        Permission.AUDIT_VIEW,
        Permission.NOTIFICATION_VIEW,
    ],
    [roles_1.Role.ADMIN]: [
        Permission.USER_VIEW,
        Permission.ESTAMP_CREATE,
        Permission.ESTAMP_VIEW,
        Permission.ESTAMP_MODIFY,
        Permission.ESTAMP_DOWNLOAD,
        Permission.ESTAMP_BULK_CREATE,
        Permission.ARTICLE_VIEW,
        Permission.ORDER_VIEW,
        Permission.REPORT_VIEW,
        // Phase 15 - same own-org-only oversight extension as SUPER_ADMIN
        // above; unlike REPORT_FINANCIAL_VIEW (deliberately withheld because
        // ADMIN lacks PAYMENT_VIEW/WALLET_VIEW), AUDIT_VIEW has no such
        // underlying-permission gap - it is a parallel of REPORT_VIEW, which
        // ADMIN already has.
        Permission.AUDIT_VIEW,
        Permission.NOTIFICATION_VIEW,
        // NOTE: unlike SUPER_ADMIN, ADMIN's default set does NOT currently
        // include PAYMENT_VIEW/WALLET_VIEW - so REPORT_FINANCIAL_VIEW is
        // deliberately withheld here too. Granting it would let ADMIN see
        // aggregate payment/wallet totals it has no underlying permission to
        // view individually, which is a real scope increase, not a natural
        // extension (contrary to the original phase assumption that ADMIN
        // already has PAYMENT_VIEW/WALLET_VIEW - verified false by reading
        // this file directly). If a future phase grants ADMIN those two
        // permissions, REPORT_FINANCIAL_VIEW should be reconsidered then.
    ],
    [roles_1.Role.USER]: [
        Permission.ESTAMP_CREATE,
        Permission.ESTAMP_VIEW,
        Permission.ESTAMP_DOWNLOAD,
        Permission.ARTICLE_VIEW,
        Permission.ORDER_VIEW,
        Permission.NOTIFICATION_VIEW,
    ],
};
// The SINGLE source of truth for "what can this user actually do".
// Used by the authenticate middleware (to populate req.user.permissions) and
// safe to reuse anywhere else the same computation is needed (e.g. tests).
//
// - Every role except ASSISTANT_MASTER_ADMIN: default-for-role UNION any
//   extra permissions stored on the user record.
// - ASSISTANT_MASTER_ADMIN: ONLY what is explicitly stored on the user
//   record. Defaults are not auto-granted, so Master Admin can grant a
//   narrower (or wider) set per-assistant, and can revoke previously-granted
//   permissions - simply overwriting `user.permissions` is enough, there is
//   no baseline that silently adds permissions back.
function getEffectivePermissions(role, userPermissions = []) {
    const own = Array.isArray(userPermissions) ? userPermissions : [];
    if (role === roles_1.Role.ASSISTANT_MASTER_ADMIN) {
        return Array.from(new Set(own));
    }
    return Array.from(new Set([...(exports.DEFAULT_ROLE_PERMISSIONS[role] || []), ...own]));
}
exports.getEffectivePermissions = getEffectivePermissions;