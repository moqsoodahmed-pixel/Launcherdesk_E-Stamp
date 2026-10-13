import { describe, it, expect } from "vitest";
import "./setup";
import { State, Article } from "../src/models/index.js";
import { Role, Permission } from "@launcherdesk/shared";
import * as stateController from "../src/controllers/state.controller.js";
import { makeReq, makeRes, runController } from "./helpers/http.js";
import { seedStates } from "../src/scripts/seed-states.js";

describe("GET /states - only states with an imported article catalog (temporary, until more are added)", () => {
  it("lists a state once it has at least one article, and omits states with none", async () => {
    await seedStates();
    // Only Karnataka has any Article at all in this test's data.
    await Article.create({ stateCode: "KA", articleCode: `SM-${Date.now()}`, title: "Sample", createdBy: "000000000000000000000000", currentVersion: 1 });

    const req = makeReq({ user: { id: "u", role: Role.SUPER_ADMIN, organizationId: "org-1", permissions: [Permission.ARTICLE_VIEW] } });
    const { res, error } = await runController(stateController.listAllStates, req, makeRes());

    expect(error).toBeNull();
    const states = res.body.data;
    expect(states.length).toBe(1);
    const codes = states.map((s) => s.code);
    expect(codes).toContain("KA");
    expect(codes).not.toContain("DL"); // Delhi has no Article in this test - must not be pickable
    expect(codes).not.toContain("AS"); // Assam has no Article in this test - must not be pickable
  });

  it("a state is removed from the list the moment its only article is deactivated", async () => {
    await seedStates();
    const article = await Article.create({ stateCode: "KA", articleCode: `SM2-${Date.now()}`, title: "Sample", createdBy: "000000000000000000000000", currentVersion: 1 });

    const req = makeReq({ user: { id: "u", role: Role.SUPER_ADMIN, organizationId: "org-1", permissions: [Permission.ARTICLE_VIEW] } });
    const before = await runController(stateController.listAllStates, req, makeRes());
    expect(before.res.body.data.map((s) => s.code)).toContain("KA");

    article.isActive = false;
    await article.save();
    const after = await runController(stateController.listAllStates, req, makeRes());
    expect(after.res.body.data.map((s) => s.code)).not.toContain("KA");
  });

  it("seeding twice never duplicates a state", async () => {
    await seedStates();
    const first = await State.countDocuments();
    await seedStates();
    const second = await State.countDocuments();
    expect(second).toBe(first);
  });
});
