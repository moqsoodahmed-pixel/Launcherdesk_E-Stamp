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
    { to: "/vendors", label: "Vendors" },
    { to: "/users", label: "Users", permission: PERMISSIONS.USER_VIEW },
  ]),
  section("OPERATIONS", [
    { to: "/estamps/requests", label: "E-Stamp Requests", permission: PERMISSIONS.ESTAMP_VIEW },
    { to: "/estamps/bulk", label: "Bulk Requests", permission: PERMISSIONS.ESTAMP_BULK_CREATE },
    { to: "/orders/fulfil", label: "Orders to fulfil", permission: PERMISSIONS.ORDER_MANAGE, mode: "manual" },
    { to: "/orders/dispatch", label: "Send to vendor", permission: PERMISSIONS.ORDER_MANAGE, mode: "manual" },
    { to: "/orders/vendor-review", label: "Vendor review", permission: PERMISSIONS.ORDER_MANAGE, mode: "manual" },
    { to: "/orders", label: "Orders", permission: PERMISSIONS.ORDER_VIEW },
    { to: "/estamps", label: "E-Stamps", permission: PERMISSIONS.ESTAMP_VIEW },
    { to: "/estamp-provider", label: "E-Stamp Provider", permission: PERMISSIONS.ESTAMP_PROVIDER_VIEW, mode: "provider" },
  ]),
  section("FINANCE", [
    { to: "/payments/credit-queue", label: "Payments to credit", permission: PERMISSIONS.WALLET_MANAGE },
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
    { to: "/policies/manage", label: "Manage Policies", permission: PERMISSIONS.POLICY_VIEW },
    { to: "/policies", label: "Policies" },
  ]),
  section("ACCOUNT", [
    { to: "/audit/mine", label: "My Activity" },
    { to: "/profile", label: "Profile" },
  ]),
];

const ASSISTANT_MASTER_ADMIN_SECTIONS = [
  section("ACCOUNT", [{ to: "/dashboard", label: "Dashboard" }]),
  section("CLIENTS", [
    { to: "/organizations", label: "Clients", permission: PERMISSIONS.CLIENT_VIEW },
    { to: "/users", label: "Users", permission: PERMISSIONS.USER_VIEW },
  ]),
  section("FINANCE", [
    { to: "/payments/credit-queue", label: "Payments to credit", permission: PERMISSIONS.WALLET_MANAGE },
    { to: "/wallet", label: "Client Balances", permission: PERMISSIONS.WALLET_VIEW },
    { to: "/payments", label: "Payments", permission: PERMISSIONS.PAYMENT_VIEW },
  ]),
  section("OPERATIONS", [
    { to: "/estamps/requests", label: "E-Stamp Requests", permission: PERMISSIONS.ESTAMP_VIEW },
    { to: "/estamps/bulk", label: "Bulk Requests", permission: PERMISSIONS.ESTAMP_BULK_CREATE },
    { to: "/orders/fulfil", label: "Orders to fulfil", permission: PERMISSIONS.ORDER_MANAGE, mode: "manual" },
    { to: "/orders/dispatch", label: "Send to vendor", permission: PERMISSIONS.ORDER_MANAGE, mode: "manual" },
    { to: "/orders/vendor-review", label: "Vendor review", permission: PERMISSIONS.ORDER_MANAGE, mode: "manual" },
    { to: "/orders", label: "Orders", permission: PERMISSIONS.ORDER_VIEW },
    { to: "/estamps", label: "E-Stamps", permission: PERMISSIONS.ESTAMP_VIEW },
    { to: "/estamp-provider", label: "E-Stamp Provider", permission: PERMISSIONS.ESTAMP_PROVIDER_VIEW, mode: "provider" },
  ]),
  section("GOVERNANCE", [
    { to: "/reports", label: "Reports", permission: PERMISSIONS.REPORT_VIEW },
    { to: "/notifications", label: "Notifications", permission: PERMISSIONS.NOTIFICATION_VIEW },
    { to: "/audit/mine", label: "Activity" },
    // AUDIT_VIEW, like SETTINGS_VIEW below, is never part of Assistant
    // Master Admin's role template - this only ever reaches the filter
    // (getSidebarSections) if a Master Admin explicitly granted it to this
    // specific user, matching audit.routes.js's requirePermission(AUDIT_VIEW)
    // gate exactly. Without it, this item is simply absent and `/audit/mine`
    // above remains the only audit-adjacent link, same as before.
    { to: "/audit", label: "Audit Logs", permission: PERMISSIONS.AUDIT_VIEW },
    { to: "/policies/manage", label: "Manage Policies", permission: PERMISSIONS.POLICY_VIEW },
    { to: "/policies", label: "Policies" },
  ]),
  // SETTINGS_VIEW is never part of Assistant Master Admin's role template -
  // it can only ever reach this array's filter (getSidebarSections) if a
  // Master Admin explicitly granted it to this specific user, matching
  // settings.routes.js's own requirePermission(SETTINGS_VIEW) gate exactly.
  section("CONFIGURATION", [
    { to: "/articles", label: "Articles", permission: PERMISSIONS.ARTICLE_VIEW },
    { to: "/settings", label: "Settings", permission: PERMISSIONS.SETTINGS_VIEW },
  ]),
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
    { to: "/audit/mine", label: "My Activity" },
    { to: "/profile", label: "Profile" },
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
  section("ACCOUNT", [
    { to: "/audit/mine", label: "My Activity" },
    { to: "/profile", label: "Profile" },
  ]),
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
  section("ACCOUNT", [
    { to: "/audit/mine", label: "My Activity" },
    { to: "/profile", label: "Profile" },
  ]),
];

// VENDOR: only its own work. The API fences a vendor out of every other
// route, so nothing else (not even Profile/Policies pages that call other
// endpoints) is linked.
const VENDOR_SECTIONS = [
  section("ACCOUNT", [{ to: "/dashboard", label: "Dashboard" }]),
  section("OPERATIONS", [{ to: "/vendor/orders", label: "My Orders" }]),
];

function sectionsFor(role) {
  switch (role) {
    case "VENDOR":
      return VENDOR_SECTIONS;
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
// `fulfilmentMode` ("manual" default | "provider") hides items tagged with
// the other `mode` (Orders to fulfil vs. E-Stamp Provider).
export function getSidebarSections(role, permissions, fulfilmentMode = "manual") {
  const hasPerm = (permission) => {
    if (!permission) return true;
    if (!Array.isArray(permissions)) return true;
    return permissions.includes(permission);
  };
  const filtered = sectionsFor(role).map((sec) => ({ heading: sec.heading, items: sec.items.filter((item) => hasPerm(item.permission) && (!item.mode || item.mode === fulfilmentMode)) }));
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
export function getFlatSidebarItems(role, permissions, fulfilmentMode) {
  return getSidebarSections(role, permissions, fulfilmentMode).flatMap((sec) => sec.items);
}

// Backward-compatible flat-array export (unchanged pre-Phase-21 behavior for
// any other consumer) - role only, no permission filtering.
export function getSidebarItems(role) {
  return sectionsFor(role).flatMap((sec) => sec.items);
}

// Picks the ONE sidebar item to highlight for the current URL (or null).
// - Items with a querystring (e.g. /users?role=ADMIN) match only when the
//   pathname is equal and every one of their query params is present with the
//   same value - so Manage Users and Manage Admins are told apart. Extra
//   params (?role=ADMIN&page=2) still match. An exact query match always wins.
// - Plain items match their own path or any nested path (/orders/123 ->
//   /orders); the longest matching path wins.
export function getActiveItem(items, pathname, search = "") {
  const current = new URLSearchParams(search);
  let best = null;
  let bestScore = -1;
  for (const item of items) {
    const [itemPath, itemQuery] = item.to.split("?");
    let score = -1;
    if (itemQuery) {
      const wanted = new URLSearchParams(itemQuery);
      const allMatch = [...wanted.entries()].every(([k, v]) => current.get(k) === v);
      if (pathname === itemPath && allMatch) score = 100000 + itemPath.length;
    } else if (pathname === itemPath || pathname.startsWith(`${itemPath}/`)) {
      score = itemPath.length;
    }
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }
  return best;
}
