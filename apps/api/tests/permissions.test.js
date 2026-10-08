import { describe, it, expect } from "vitest";
import { Role, ROLE_LEVEL, DEFAULT_ROLE_PERMISSIONS, Permission, getEffectivePermissions } from "@launcherdesk/shared";

describe("Role/permission model", () => {
  it("Master Admin has the highest authority (lowest level number)", () => {
    expect(ROLE_LEVEL[Role.MASTER_ADMIN]).toBeLessThan(ROLE_LEVEL[Role.ASSISTANT_MASTER_ADMIN]);
    expect(ROLE_LEVEL[Role.ASSISTANT_MASTER_ADMIN]).toBeLessThan(ROLE_LEVEL[Role.SUPER_ADMIN]);
    expect(ROLE_LEVEL[Role.SUPER_ADMIN]).toBeLessThan(ROLE_LEVEL[Role.ADMIN]);
    expect(ROLE_LEVEL[Role.ADMIN]).toBeLessThan(ROLE_LEVEL[Role.USER]);
  });

  it("USER does not have article.manage or audit.view by default", () => {
    expect(DEFAULT_ROLE_PERMISSIONS[Role.USER]).not.toContain(Permission.ARTICLE_MANAGE);
    expect(DEFAULT_ROLE_PERMISSIONS[Role.USER]).not.toContain(Permission.AUDIT_VIEW);
  });

  it("only Master Admin has settings.manage by default", () => {
    expect(DEFAULT_ROLE_PERMISSIONS[Role.MASTER_ADMIN]).toContain(Permission.SETTINGS_MANAGE);
    expect(DEFAULT_ROLE_PERMISSIONS[Role.SUPER_ADMIN]).not.toContain(Permission.SETTINGS_MANAGE);
    expect(DEFAULT_ROLE_PERMISSIONS[Role.ADMIN]).not.toContain(Permission.SETTINGS_MANAGE);
  });

  it("no sixth administrative role exists", () => {
    expect(Object.values(Role).sort()).toEqual(
      [Role.MASTER_ADMIN, Role.ASSISTANT_MASTER_ADMIN, Role.SUPER_ADMIN, Role.ADMIN, Role.USER].sort()
    );
  });

  it("order.view / order.manage permissions exist and are assigned sensibly", () => {
    expect(Permission.ORDER_VIEW).toBe("order.view");
    expect(Permission.ORDER_MANAGE).toBe("order.manage");
    // Everyone gets to view their own scope's orders by default...
    for (const role of [Role.SUPER_ADMIN, Role.ADMIN, Role.USER, Role.ASSISTANT_MASTER_ADMIN]) {
      expect(DEFAULT_ROLE_PERMISSIONS[role]).toContain(Permission.ORDER_VIEW);
    }
    // ...but order.manage is not casually handed out to any of these by default.
    for (const role of [Role.SUPER_ADMIN, Role.ADMIN, Role.USER, Role.ASSISTANT_MASTER_ADMIN]) {
      expect(DEFAULT_ROLE_PERMISSIONS[role]).not.toContain(Permission.ORDER_MANAGE);
    }
  });

  describe("getEffectivePermissions (Assistant Master Admin permission-based access)", () => {
    it("an Assistant Master Admin with no assigned permissions has NONE - defaults are NOT auto-granted", () => {
      // This is the core "IMPORTANT: Do NOT simply assume every Assistant
      // Master Admin gets unrestricted access" requirement. Regression test
      // for the bug where authenticate.js used to union in role defaults
      // even for this role.
      const effective = getEffectivePermissions(Role.ASSISTANT_MASTER_ADMIN, []);
      expect(effective).toEqual([]);
    });

    it("an Assistant Master Admin gets exactly what Master Admin assigned, nothing more", () => {
      const assigned = [Permission.CLIENT_VIEW, Permission.ESTAMP_DOWNLOAD];
      const effective = getEffectivePermissions(Role.ASSISTANT_MASTER_ADMIN, assigned);
      expect(effective.sort()).toEqual(assigned.sort());
      expect(effective).not.toContain(Permission.CLIENT_MANAGE);
      expect(effective).not.toContain(Permission.SETTINGS_MANAGE);
    });

    it("permissions can be revoked from an Assistant Master Admin by overwriting with a smaller set", () => {
      const before = getEffectivePermissions(Role.ASSISTANT_MASTER_ADMIN, [
        Permission.CLIENT_VIEW,
        Permission.CLIENT_MANAGE,
      ]);
      expect(before).toContain(Permission.CLIENT_MANAGE);
      const after = getEffectivePermissions(Role.ASSISTANT_MASTER_ADMIN, [Permission.CLIENT_VIEW]);
      expect(after).toContain(Permission.CLIENT_VIEW);
      expect(after).not.toContain(Permission.CLIENT_MANAGE);
    });

    it("every OTHER role still gets role defaults UNION any extra per-user grants (unchanged behavior)", () => {
      const effective = getEffectivePermissions(Role.SUPER_ADMIN, [Permission.AUDIT_VIEW]);
      for (const p of DEFAULT_ROLE_PERMISSIONS[Role.SUPER_ADMIN]) {
        expect(effective).toContain(p);
      }
      expect(effective).toContain(Permission.AUDIT_VIEW);
    });

    it("Master Admin always has every permission regardless of user.permissions", () => {
      const effective = getEffectivePermissions(Role.MASTER_ADMIN, []);
      expect(effective.sort()).toEqual(Object.values(Permission).sort());
    });
  });
});