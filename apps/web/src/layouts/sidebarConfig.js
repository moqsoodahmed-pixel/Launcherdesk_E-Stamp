import { PERMISSIONS } from "../utils/permissions";

// Phase 21 - restructured from a flat per-role array into logical grouped
// sections (headers, not just a longer flat list), while preserving EVERY
// existing route/link from the original flat arrays untouched - nothing was
// removed. Each item may carry an optional `permission` (the exact
// permission that gates its backend route, taken directly from the
// corresponding routes/v1/*.routes.js file - see report.controller.js /
// user.routes.js / estamp.routes.js etc.) used as a safety-net filter (most
// relevant for ASSISTANT_MASTER_ADMIN, whose actual grants can differ from
// the template below); every other role's array already matches its own
// DEFAULT_ROLE_PERMISSIONS, so filtering is a consistency check, not a
// rewrite of what that role sees.
function section(heading, items) {
  return { heading, items };
}

const MASTER_ADMIN_SECTIONS = [
  section("ACCOUNT", [{ to: "/dashboard", label: "Dashboard" }]),
  section("CLIENTS", [
    { to: "/organizations", label: "Clients / Organizations", permission: PERMISSIONS.CLIENT_VIEW },
    { to: "/assistant-admins", label: "Assistant Master Admins", permission: PERMISSIONS.USER_MANAGE },
    { to: "/users", label: "Users", permission: PERMISSIONS.USER_VIEW },
  ]),
  section("OPERATIONS", [
    { to: "/estamps/requests", label: "E-Stamp Requests", permission: PERMISSIONS.ESTAMP_VIEW },
    { to: "/estamps/bulk", label: "Bulk Requests", permission: PERMISSIONS.ESTAMP_BULK_CREATE },
    { to: "/orders", label: "Orders", permission: PERMISSIONS.ORDER_VIEW },
    { to: "/estamps", label: "E-Stamps", permission: PERMISSIONS.ESTAMP_VIEW },
    { to: "/estamp-provider", label: "E-Stamp Provider", permission: PERMISSIONS.ESTAMP_PROVIDER_VIEW },
  ]),
  section("FINANCE", [
    { to: "/payments", label: "Payments", permission: PERMISSIONS.PAYMENT_VIEW },
    { to: "/wallet", label: "Client Balances", permission: PERMISSIONS.WALLET_VIEW },
  ]),
  section("CONFIGURATION", [
    { to: "/articles", label: "Articles", permission: PERMISSIONS.ARTICLE_VIEW },
    { to: "/settings", label: "Settings", permission: PERMISSIONS.SETTINGS_VIEW },
  ]),
  section("GOVERNANCE", [
    { to: "/reports", label: "Reports", permission: PERMISSIONS.REPORT_VIEW },
    { to: "/notifications", label: "Notifications", permission: PERMISSIONS.NOTIFICATION_VIEW },
    { to: "/audit", label: "Audit Logs", permission: PERMISSIONS.AUDIT_VIEW },
    { to: "/policies/manage", label: "Manage Policies", permission: PERMISSIONS.POLICY_MANAGE },
    { to: "/policies", label: "Policies" },
  ]),
  section("ACCOUNT", [{ to: "/profile", label: "Profile" }]),
];

const ASSISTANT_MASTER_ADMIN_SECTIONS = [
  section("ACCOUNT", [{ to: "/dashboard", label: "Dashboard" }]),
  section("CLIENTS", [{ to: "/organizations", label: "Clients", permission: PERMISSIONS.CLIENT_VIEW }]),
  section("FINANCE", [{ to: "/wallet", label: "Client Balances", permission: PERMISSIONS.WALLET_VIEW }]),
  section("OPERATIONS", [
    { to: "/estamps/requests", label: "E-Stamp Requests", permission: PERMISSIONS.ESTAMP_VIEW },
    { to: "/orders", label: "Orders", permission: PERMISSIONS.ORDER_VIEW },
    { to: "/estamps", label: "E-Stamps", permission: PERMISSIONS.ESTAMP_VIEW },
    { to: "/files/upload", label: "Upload", permission: PERMISSIONS.ESTAMP_UPLOAD },
    { to: "/files/download", label: "Download", permission: PERMISSIONS.ESTAMP_DOWNLOAD },
  ]),
  section("GOVERNANCE", [
    { to: "/reports", label: "Reports", permission: PERMISSIONS.REPORT_VIEW },
    { to: "/audit/mine", label: "Activity" },
    // AUDIT_VIEW, like SETTINGS_VIEW below, is never part of Assistant
    // Master Admin's role template - this only ever reaches the filter
    // (getSidebarSections) if a Master Admin explicitly granted it to this
    // specific user, matching audit.routes.js's requirePermission(AUDIT_VIEW)
    // gate exactly. Without it, this item is simply absent and `/audit/mine`
    // above remains the only audit-adjacent link, same as before.
    { to: "/audit", label: "Audit Logs", permission: PERMISSIONS.AUDIT_VIEW },
    { to: "/policies/manage", label: "Manage Policies", permission: PERMISSIONS.POLICY_MANAGE },
    { to: "/policies", label: "Policies" },
  ]),
  // SETTINGS_VIEW is never part of Assistant Master Admin's role template -
  // it can only ever reach this array's filter (getSidebarSections) if a
  // Master Admin explicitly granted it to this specific user, matching
  // settings.routes.js's own requirePermission(SETTINGS_VIEW) gate exactly.
  section("CONFIGURATION", [{ to: "/settings", label: "Settings", permission: PERMISSIONS.SETTINGS_VIEW }]),
  section("ACCOUNT", [{ to: "/profile", label: "Profile" }]),
];

const SUPER_ADMIN_SECTIONS = [
  section("ACCOUNT", [{ to: "/dashboard", label: "Dashboard" }]),
  section("CLIENTS", [
    { to: "/users?role=USER", label: "Manage Users", permission: PERMISSIONS.USER_VIEW },
    { to: "/users?role=ADMIN", label: "Manage Admins", permission: PERMISSIONS.USER_VIEW },
  ]),
  section("OPERATIONS", [
    { to: "/estamps/requests/new", label: "E-Stamp Request", permission: PERMISSIONS.ESTAMP_CREATE },
    { to: "/estamps/bulk", label: "Bulk Request", permission: PERMISSIONS.ESTAMP_BULK_CREATE },
    { to: "/orders", label: "Orders", permission: PERMISSIONS.ORDER_VIEW },
    { to: "/estamps", label: "E-Stamps", permission: PERMISSIONS.ESTAMP_VIEW },
  ]),
  section("FINANCE", [
    { to: "/wallet", label: "Available Balance", permission: PERMISSIONS.WALLET_VIEW },
    { to: "/payments", label: "Payments", permission: PERMISSIONS.PAYMENT_VIEW },
  ]),
  section("CONFIGURATION", [{ to: "/articles", label: "Articles", permission: PERMISSIONS.ARTICLE_VIEW }]),
  section("GOVERNANCE", [
    { to: "/reports", label: "Reports", permission: PERMISSIONS.REPORT_VIEW },
    { to: "/audit", label: "Audit Log", permission: PERMISSIONS.AUDIT_VIEW },
    { to: "/policies", label: "Policies" },
  ]),
  section("ACCOUNT", [
    { to: "/organization/profile", label: "Company Profile" },
    { to: "/about", label: "About" },
  ]),
];

const ADMIN_SECTIONS = [
  section("ACCOUNT", [{ to: "/dashboard", label: "Dashboard" }]),
  section("CLIENTS", [{ to: "/users", label: "Users", permission: PERMISSIONS.USER_VIEW }]),
  section("OPERATIONS", [
    { to: "/estamps/requests", label: "E-Stamp Requests", permission: PERMISSIONS.ESTAMP_VIEW },
    { to: "/estamps/bulk", label: "Bulk Request", permission: PERMISSIONS.ESTAMP_BULK_CREATE },
    { to: "/orders", label: "Orders", permission: PERMISSIONS.ORDER_VIEW },
    { to: "/estamps", label: "E-Stamps", permission: PERMISSIONS.ESTAMP_VIEW },
  ]),
  section("CONFIGURATION", [{ to: "/articles", label: "Articles", permission: PERMISSIONS.ARTICLE_VIEW }]),
  section("GOVERNANCE", [
    { to: "/reports", label: "Reports", permission: PERMISSIONS.REPORT_VIEW },
    { to: "/audit", label: "Audit Log", permission: PERMISSIONS.AUDIT_VIEW },
    { to: "/policies", label: "Policies" },
  ]),
  section("ACCOUNT", [{ to: "/profile", label: "Profile" }]),
];

const USER_SECTIONS = [
  section("ACCOUNT", [{ to: "/dashboard", label: "Dashboard" }]),
  section("OPERATIONS", [
    { to: "/estamps/requests/new", label: "Create E-Stamp Request", permission: PERMISSIONS.ESTAMP_CREATE },
    { to: "/estamps/requests", label: "My Requests", permission: PERMISSIONS.ESTAMP_VIEW },
    { to: "/orders", label: "My Orders", permission: PERMISSIONS.ORDER_VIEW },
    { to: "/estamps", label: "E-Stamps", permission: PERMISSIONS.ESTAMP_VIEW },
  ]),
  section("CONFIGURATION", [{ to: "/articles", label: "Articles", permission: PERMISSIONS.ARTICLE_VIEW }]),
  section("GOVERNANCE", [{ to: "/policies", label: "Policies" }]),
  section("ACCOUNT", [{ to: "/profile", label: "Profile" }]),
];

function sectionsFor(role) {
  switch (role) {
    case "MASTER_ADMIN":
      return MASTER_ADMIN_SECTIONS;
    case "ASSISTANT_MASTER_ADMIN":
      return ASSISTANT_MASTER_ADMIN_SECTIONS;
    case "SUPER_ADMIN":
      return SUPER_ADMIN_SECTIONS;
    case "ADMIN":
      return ADMIN_SECTIONS;
    default:
      return USER_SECTIONS;
  }
}

// `permissions`: the user's EFFECTIVE permission set (see utils/permissions.js's
// header note) - `undefined`/non-array fails OPEN (shows everything for the
// role), so a stale cached session never loses navigation it used to have.
export function getSidebarSections(role, permissions) {
  const hasPerm = (permission) => {
    if (!permission) return true;
    if (!Array.isArray(permissions)) return true;
    return permissions.includes(permission);
  };
  const filtered = sectionsFor(role).map((sec) => ({ heading: sec.heading, items: sec.items.filter((item) => hasPerm(item.permission)) }));
  // Several roles legitimately declare the same heading twice in the raw
  // config above (e.g. "ACCOUNT" for Dashboard up top and Profile at the
  // bottom) - merge same-heading sections into one so React never renders
  // two sibling section `<div>`s sharing the same key.
  const merged = [];
  const indexByHeading = new Map();
  for (const sec of filtered) {
    if (indexByHeading.has(sec.heading)) {
      merged[indexByHeading.get(sec.heading)].items.push(...sec.items);
    } else {
      indexByHeading.set(sec.heading, merged.length);
      merged.push({ heading: sec.heading, items: [...sec.items] });
    }
  }
  return merged.filter((sec) => sec.items.length > 0);
}

// Kept for any other consumer that only wants a flat list (e.g. active-link
// "longest prefix" matching across every visible item regardless of section).
export function getFlatSidebarItems(role, permissions) {
  return getSidebarSections(role, permissions).flatMap((sec) => sec.items);
}

// Backward-compatible flat-array export (unchanged pre-Phase-21 behavior for
// any other consumer) - role only, no permission filtering.
export function getSidebarItems(role) {
  return sectionsFor(role).flatMap((sec) => sec.items);
}
