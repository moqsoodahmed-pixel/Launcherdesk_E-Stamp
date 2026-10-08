"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TENANT_ROLES = exports.INTERNAL_ROLES = exports.ROLE_LEVEL = exports.Role = void 0;
// Canonical role hierarchy. Levels: lower number = higher authority.
var Role;
(function (Role) {
    Role["MASTER_ADMIN"] = "MASTER_ADMIN";
    Role["ASSISTANT_MASTER_ADMIN"] = "ASSISTANT_MASTER_ADMIN";
    Role["SUPER_ADMIN"] = "SUPER_ADMIN";
    Role["ADMIN"] = "ADMIN";
    Role["USER"] = "USER";
})(Role || (exports.Role = Role = {}));
exports.ROLE_LEVEL = {
    [Role.MASTER_ADMIN]: 1,
    [Role.ASSISTANT_MASTER_ADMIN]: 2,
    [Role.SUPER_ADMIN]: 3,
    [Role.ADMIN]: 4,
    [Role.USER]: 5,
};
// Roles that belong to OUR company (internal), not a client organization.
exports.INTERNAL_ROLES = [Role.MASTER_ADMIN, Role.ASSISTANT_MASTER_ADMIN];
// Roles that belong to a client organization (must have organizationId).
exports.TENANT_ROLES = [Role.SUPER_ADMIN, Role.ADMIN, Role.USER];
