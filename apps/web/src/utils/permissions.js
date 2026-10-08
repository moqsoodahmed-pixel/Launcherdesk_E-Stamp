// Phase 21 - mirrors packages/shared/src/permissions.js's Permission enum
// string values (NOT the enum object itself - see ReportsPage.jsx's own
// identical note on why @launcherdesk/shared cannot be imported here: its
// CommonJS `__exportStar` re-export loop breaks Rollup's production build,
// even though it resolves fine under Vite dev/Node). If that file's set of
// permission strings ever changes, update this list to match.
//
// Unlike ReportsPage.jsx's own local mirror (which ALSO had to re-derive
// DEFAULT_ROLE_PERMISSIONS because /auth/me used to return only each user's
// raw STORED permissions), this file can be simpler: as of Phase 21,
// AuthContext's `user.permissions` is the backend-computed EFFECTIVE set
// (see auth.service.js's issueTokens / auth.controller.js's `me`, both of
// which now return `getEffectivePermissions(role, storedPermissions)`
// directly) - so `hasPermission` below is a plain membership check, no
// role-default re-derivation needed.
export const PERMISSIONS = {
  CLIENT_VIEW: "client.view",
  CLIENT_MANAGE: "client.manage",
  USER_VIEW: "user.view",
  USER_CREATE: "user.create",
  USER_MANAGE: "user.manage",
  ESTAMP_CREATE: "estamp.create",
  ESTAMP_VIEW: "estamp.view",
  ESTAMP_MODIFY: "estamp.modify",
  ESTAMP_CANCEL: "estamp.cancel",
  ESTAMP_DOWNLOAD: "estamp.download",
  ESTAMP_UPLOAD: "estamp.upload",
  ESTAMP_BULK_CREATE: "estamp.bulk_create",
  ARTICLE_VIEW: "article.view",
  ARTICLE_MANAGE: "article.manage",
  PAYMENT_VIEW: "payment.view",
  PAYMENT_MANAGE: "payment.manage",
  WALLET_VIEW: "wallet.view",
  WALLET_MANAGE: "wallet.manage",
  ORDER_VIEW: "order.view",
  ORDER_MANAGE: "order.manage",
  REPORT_VIEW: "report.view",
  REPORT_FINANCIAL_VIEW: "report.financial_view",
  REPORT_GLOBAL_VIEW: "report.global_view",
  AUDIT_VIEW: "audit.view",
  SETTINGS_VIEW: "settings.view",
  SETTINGS_MANAGE: "settings.manage",
  NOTIFICATION_VIEW: "notification.view",
  ESTAMP_PROVIDER_VIEW: "estamp_provider.view",
  POLICY_VIEW: "policy.view",
  POLICY_MANAGE: "policy.manage",
};

// UX-only helper - never a security boundary. Every route this could gate
// rendering for is independently, redundantly enforced server-side by
// requirePermission()/authenticate.js. If `user.permissions` is missing
// entirely (e.g. a stale cached session from before this field existed),
// fail OPEN (show the item) rather than hide a legitimate destination -
// the backend will still 403 an actually-unauthorized request regardless
// of what the sidebar renders.
export function hasPermission(user, permission) {
  if (!permission) return true;
  if (!user) return false;
  if (!Array.isArray(user.permissions)) return true;
  return user.permissions.includes(permission);
}
