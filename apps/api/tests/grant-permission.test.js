import { describe, it, expect } from "vitest";
import "./setup";
import { User } from "../src/models/index.js";
import { Role } from "@launcherdesk/shared";
import { grantPermission } from "../src/scripts/grant-permission.js";

describe("grantPermission - reusable per-user permission grant", () => {
  it("adds the permission to a user who doesn't have it", async () => {
    const user = await User.create({ name: "Test Assistant", email: `assistant-${Date.now()}@test.com`, passwordHash: "x", role: Role.ASSISTANT_MASTER_ADMIN, permissions: ["order.view"] });

    const result = await grantPermission(user.email, "order.manage");

    expect(result.found).toBe(true);
    expect(result.alreadyHadIt).toBe(false);
    expect(result.permissions).toContain("order.manage");
    expect(result.permissions).toContain("order.view");

    const reloaded = await User.findById(user._id);
    expect(reloaded.permissions.filter((p) => p === "order.manage").length).toBe(1);
  });

  it("is idempotent - never duplicates an already-granted permission", async () => {
    const user = await User.create({ name: "Test Assistant 2", email: `assistant-${Date.now()}@test.com`, passwordHash: "x", role: Role.ASSISTANT_MASTER_ADMIN, permissions: ["order.view", "order.manage"] });

    const result = await grantPermission(user.email, "order.manage");

    expect(result.found).toBe(true);
    expect(result.alreadyHadIt).toBe(true);
    const reloaded = await User.findById(user._id);
    expect(reloaded.permissions.filter((p) => p === "order.manage").length).toBe(1);
  });

  it("reports not found for a nonexistent email without throwing", async () => {
    const result = await grantPermission("nobody-here@test.com", "order.manage");
    expect(result.found).toBe(false);
  });
});
