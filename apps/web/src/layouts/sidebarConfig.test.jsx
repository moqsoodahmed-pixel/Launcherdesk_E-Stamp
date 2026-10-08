import { describe, it, expect } from "vitest";
import { getSidebarSections, getFlatSidebarItems } from "./sidebarConfig";
import { PERMISSIONS } from "../utils/permissions";

function flatTos(role, permissions) {
  return getFlatSidebarItems(role, permissions).map((i) => i.to);
}

describe("sidebarConfig - permission filtering", () => {
  it("MASTER_ADMIN sees every permission-gated item when granted every permission", () => {
    const tos = flatTos("MASTER_ADMIN", Object.values(PERMISSIONS));
    expect(tos).toContain("/organizations");
    expect(tos).toContain("/users");
    expect(tos).toContain("/settings");
    expect(tos).toContain("/audit");
    expect(tos).toContain("/reports");
    expect(tos).toContain("/wallet");
  });

  it("MASTER_ADMIN loses a specific item when that one permission is withheld, without losing unrelated items", () => {
    const allButSettings = Object.values(PERMISSIONS).filter((p) => p !== PERMISSIONS.SETTINGS_VIEW);
    const tos = flatTos("MASTER_ADMIN", allButSettings);
    expect(tos).not.toContain("/settings");
    expect(tos).toContain("/organizations"); // unrelated item unaffected
  });

  it("ASSISTANT_MASTER_ADMIN never sees Settings or the full Audit Logs link without an explicit grant, but always keeps Activity (no-permission item)", () => {
    const tos = flatTos("ASSISTANT_MASTER_ADMIN", []);
    expect(tos).not.toContain("/settings");
    expect(tos).not.toContain("/audit");
    expect(tos).toContain("/audit/mine"); // self-scoped Activity carries no permission at all
    expect(tos).toContain("/dashboard");
  });

  it("ASSISTANT_MASTER_ADMIN gains Settings and Audit Logs once explicitly granted those exact permissions", () => {
    const tos = flatTos("ASSISTANT_MASTER_ADMIN", [PERMISSIONS.SETTINGS_VIEW, PERMISSIONS.AUDIT_VIEW]);
    expect(tos).toContain("/settings");
    expect(tos).toContain("/audit");
  });

  it("SUPER_ADMIN never sees Settings, Organizations list, or User management - those aren't in the role's own section array at all", () => {
    const tos = flatTos("SUPER_ADMIN", Object.values(PERMISSIONS));
    expect(tos).not.toContain("/settings");
    expect(tos).not.toContain("/organizations");
    expect(tos).not.toContain("/assistant-admins");
  });

  it("USER sees no Reports, Audit, Settings, or Wallet/Payments links regardless of permission array contents - not present in that role's config at all", () => {
    const tos = flatTos("USER", Object.values(PERMISSIONS));
    expect(tos).not.toContain("/reports");
    expect(tos).not.toContain("/audit");
    expect(tos).not.toContain("/settings");
    expect(tos).not.toContain("/wallet");
    expect(tos).not.toContain("/payments");
    expect(tos).toContain("/dashboard");
  });

  it("fails open (shows the item) when permissions is not an array - a stale/malformed session never loses navigation", () => {
    const tos = flatTos("MASTER_ADMIN", undefined);
    expect(tos).toContain("/settings");
    expect(tos).toContain("/organizations");
  });
});

describe("sidebarConfig - structural integrity", () => {
  it("never renders an empty section heading for any role", () => {
    for (const role of ["MASTER_ADMIN", "ASSISTANT_MASTER_ADMIN", "SUPER_ADMIN", "ADMIN", "USER"]) {
      const sections = getSidebarSections(role, []);
      for (const sec of sections) {
        expect(sec.items.length).toBeGreaterThan(0);
      }
    }
  });

  it("never produces two sections sharing the same heading (would collide as React keys)", () => {
    for (const role of ["MASTER_ADMIN", "ASSISTANT_MASTER_ADMIN", "SUPER_ADMIN", "ADMIN", "USER"]) {
      const headings = getSidebarSections(role, Object.values(PERMISSIONS)).map((s) => s.heading);
      expect(new Set(headings).size).toBe(headings.length);
    }
  });

  it("every item's route is a real, non-empty path", () => {
    for (const role of ["MASTER_ADMIN", "ASSISTANT_MASTER_ADMIN", "SUPER_ADMIN", "ADMIN", "USER"]) {
      for (const item of getFlatSidebarItems(role, Object.values(PERMISSIONS))) {
        expect(item.to).toMatch(/^\//);
        expect(item.label).toBeTruthy();
      }
    }
  });
});
