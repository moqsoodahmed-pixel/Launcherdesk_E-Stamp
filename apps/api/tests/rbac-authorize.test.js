// These tests exercise the authorization middleware directly with mock
// req/res/next objects - no database needed, since requireRole/requireMinLevel/
// requirePermission/requireOrganizationAccess are pure decision logic over
// req.user. This intentionally does NOT import "./setup" (no Mongo).
import { describe, it, expect } from "vitest";
import { Role, Permission, getEffectivePermissions } from "@launcherdesk/shared";
import {
  requireRole,
  requireMinLevel,
  requirePermission,
  requireOrganizationAccess,
} from "../src/middleware/authorize.js";
import { makeReq, makeRes, runMiddleware } from "./helpers/http.js";

function userReq(role, organizationId = null, permissions = [], extra = {}) {
  return makeReq({
    user: { id: "actor-id", role, organizationId, permissions },
    ...extra,
  });
}

describe("Test 1: Master Admin can access all organizations", () => {
  it("requireOrganizationAccess never blocks MASTER_ADMIN, for any org id", async () => {
    const req = userReq(Role.MASTER_ADMIN, null, [], { params: { organizationId: "org-999" } });
    const { threw } = await runMiddleware(requireOrganizationAccess(), req, makeRes());
    expect(threw).toBeNull();
  });
});

describe("Test 5/6/7: tenant roles cannot access another organization's data", () => {
  it("Super Admin is blocked from a different organizationId", async () => {
    const req = userReq(Role.SUPER_ADMIN, "org-A", [], { params: { organizationId: "org-B" } });
    const { threw } = await runMiddleware(requireOrganizationAccess(), req, makeRes());
    expect(threw).not.toBeNull();
    expect(threw.statusCode).toBe(403);
  });

  it("Admin is blocked from a different organizationId", async () => {
    const req = userReq(Role.ADMIN, "org-A", [], { params: { organizationId: "org-B" } });
    const { threw } = await runMiddleware(requireOrganizationAccess(), req, makeRes());
    expect(threw).not.toBeNull();
    expect(threw.statusCode).toBe(403);
  });

  it("User is blocked from a different organizationId", async () => {
    const req = userReq(Role.USER, "org-A", [], { params: { organizationId: "org-B" } });
    const { threw } = await runMiddleware(requireOrganizationAccess(), req, makeRes());
    expect(threw).not.toBeNull();
    expect(threw.statusCode).toBe(403);
  });

  it("Super Admin, Admin and User CAN access their own organizationId", async () => {
    for (const role of [Role.SUPER_ADMIN, Role.ADMIN, Role.USER]) {
      const req = userReq(role, "org-A", [], { params: { organizationId: "org-A" } });
      const { threw } = await runMiddleware(requireOrganizationAccess(), req, makeRes());
      expect(threw).toBeNull();
      expect(req.resolvedOrganizationId).toBe("org-A");
    }
  });

  it("a tenant user with no organizationId at all is forbidden outright", async () => {
    const req = userReq(Role.USER, null, []);
    const { threw } = await runMiddleware(requireOrganizationAccess(), req, makeRes());
    expect(threw).not.toBeNull();
    expect(threw.statusCode).toBe(403);
  });
});

describe("Test 8: client users cannot access Master-Admin-only routes", () => {
  const guard = requireRole(Role.MASTER_ADMIN);
  it.each([Role.ASSISTANT_MASTER_ADMIN, Role.SUPER_ADMIN, Role.ADMIN, Role.USER])(
    "%s is rejected by requireRole(MASTER_ADMIN)",
    async (role) => {
      const req = userReq(role);
      const { threw } = await runMiddleware(guard, req, makeRes());
      expect(threw).not.toBeNull();
      expect(threw.statusCode).toBe(403);
    }
  );
  it("MASTER_ADMIN passes", async () => {
    const req = userReq(Role.MASTER_ADMIN);
    const { threw } = await runMiddleware(guard, req, makeRes());
    expect(threw).toBeNull();
  });
});

describe("Test 9: client users cannot access Assistant-Master-Admin-management routes", () => {
  // Our Assistant Master Admin creation/permission-management routes are
  // gated with requireRole(MASTER_ADMIN) ONLY (see user.routes.js) - no
  // role, including ASSISTANT_MASTER_ADMIN itself, other than MASTER_ADMIN
  // may reach them.
  const guard = requireRole(Role.MASTER_ADMIN);
  it.each([Role.SUPER_ADMIN, Role.ADMIN, Role.USER])(
    "%s cannot reach Assistant-Master-Admin management routes",
    async (role) => {
      const req = userReq(role);
      const { threw } = await runMiddleware(guard, req, makeRes());
      expect(threw).not.toBeNull();
      expect(threw.statusCode).toBe(403);
    }
  );
});

describe("Test 4: Assistant Master Admin cannot elevate its own permissions", () => {
  it("is rejected outright by requireRole(MASTER_ADMIN) on the permissions-management route", async () => {
    const req = userReq(Role.ASSISTANT_MASTER_ADMIN);
    const { threw } = await runMiddleware(requireRole(Role.MASTER_ADMIN), req, makeRes());
    expect(threw).not.toBeNull();
    expect(threw.statusCode).toBe(403);
  });
});

describe("Test 2: Assistant Master Admin access requires permission (not just role)", () => {
  it("an Assistant Master Admin with NO granted permissions is denied by requirePermission", async () => {
    const permissions = getEffectivePermissions(Role.ASSISTANT_MASTER_ADMIN, []);
    const req = userReq(Role.ASSISTANT_MASTER_ADMIN, null, permissions);
    const { threw } = await runMiddleware(requirePermission(Permission.WALLET_MANAGE), req, makeRes());
    expect(threw).not.toBeNull();
    expect(threw.statusCode).toBe(403);
  });

  it("an Assistant Master Admin explicitly granted the permission is allowed", async () => {
    const permissions = getEffectivePermissions(Role.ASSISTANT_MASTER_ADMIN, [Permission.WALLET_MANAGE]);
    const req = userReq(Role.ASSISTANT_MASTER_ADMIN, null, permissions);
    const { threw } = await runMiddleware(requirePermission(Permission.WALLET_MANAGE), req, makeRes());
    expect(threw).toBeNull();
  });

  it("revoking the permission (an empty overwrite) removes access again", async () => {
    // Simulates Master Admin calling PATCH /users/:id/permissions with [] -
    // this is the crux of the "permission-based, revocable" requirement.
    const granted = getEffectivePermissions(Role.ASSISTANT_MASTER_ADMIN, [Permission.WALLET_MANAGE]);
    expect(granted).toContain(Permission.WALLET_MANAGE);
    const revoked = getEffectivePermissions(Role.ASSISTANT_MASTER_ADMIN, []);
    expect(revoked).not.toContain(Permission.WALLET_MANAGE);
  });
});

describe("requireMinLevel", () => {
  it("MASTER_ADMIN satisfies a MASTER_ADMIN-level requirement", async () => {
    const req = userReq(Role.MASTER_ADMIN);
    const { threw } = await runMiddleware(requireMinLevel(Role.MASTER_ADMIN), req, makeRes());
    expect(threw).toBeNull();
  });
  it("a lower-authority role (higher ROLE_LEVEL number) fails a MASTER_ADMIN-level requirement", async () => {
    const req = userReq(Role.SUPER_ADMIN);
    const { threw } = await runMiddleware(requireMinLevel(Role.MASTER_ADMIN), req, makeRes());
    expect(threw).not.toBeNull();
    expect(threw.statusCode).toBe(403);
  });
});