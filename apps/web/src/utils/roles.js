// Mirrors packages/shared/src/roles.js ROLE_LEVEL (lower number = more
// authority). Not imported directly - see utils/permissions.js for why the
// shared CommonJS package can't be bundled by the web build.
export const ROLE_LEVEL = { MASTER_ADMIN: 1, ASSISTANT_MASTER_ADMIN: 2, SUPER_ADMIN: 3, ADMIN: 4, USER: 5, VENDOR: 6 };
export const CLIENT_ROLES = ["SUPER_ADMIN", "ADMIN", "USER"];

// Client roles the actor may manage: strictly lower authority, same rule as
// user.controller.js's assertCanActOn / createUser.
export function manageableRoles(actorRole) {
  const level = ROLE_LEVEL[actorRole];
  if (!level) return [];
  return CLIENT_ROLES.filter((r) => ROLE_LEVEL[r] > level);
}

// Roles that can be created through POST /users (an org's own staff). Super
// Admins are provisioned per organisation instead (organization.controller.js).
export function creatableRoles(actorRole) {
  return manageableRoles(actorRole).filter((r) => r !== "SUPER_ADMIN");
}

// VENDOR: external stamping partner (no organization). Never a client role
// and never manageable through /users - Master Admin manages vendors on /vendors.
export const VENDOR_ROLE = "VENDOR";

export const ROLE_LABELS = { SUPER_ADMIN: "Super Admin", ADMIN: "Admin", USER: "User", VENDOR: "Vendor" };
