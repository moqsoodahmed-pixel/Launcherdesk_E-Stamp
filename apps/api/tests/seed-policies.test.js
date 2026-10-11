import { describe, it, expect } from "vitest";
import "./setup";
import { User, Policy } from "../src/models/index.js";
import { Role } from "@launcherdesk/shared";
import { seedDraftPolicies } from "../src/scripts/seed-policies.js";

describe("seed-policies", () => {
  it("creates one DRAFT per missing type, marked as placeholder, and is safe to re-run", async () => {
    await User.create({ name: "MA", email: `ma-${Date.now()}@ld.local`, passwordHash: "x", role: Role.MASTER_ADMIN });
    await Policy.create({ type: "TERMS", version: "1.0", title: "Terms", content: "Real terms", status: "PUBLISHED", createdBy: (await User.findOne())._id });
    const created = await seedDraftPolicies();
    expect(created.sort()).toEqual(["PRIVACY", "REFUND"]);
    const drafts = await Policy.find({ status: "DRAFT" });
    expect(drafts).toHaveLength(2);
    drafts.forEach((p) => expect(p.content).toMatch(/^DRAFT - REPLACE BEFORE LAUNCH/));
    // The existing TERMS policy is untouched; a second run creates nothing.
    expect(await Policy.countDocuments({ type: "TERMS" })).toBe(1);
    expect(await seedDraftPolicies()).toEqual([]);
  });
});
