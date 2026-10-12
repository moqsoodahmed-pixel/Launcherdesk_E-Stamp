import { describe, it, expect } from "vitest";
import "./setup";
import { State, Article } from "../src/models/index.js";
import { Role, Permission } from "@launcherdesk/shared";
import * as stateController from "../src/controllers/state.controller.js";
import { makeReq, makeRes, runController } from "./helpers/http.js";
import { seedStates } from "../src/scripts/seed-states.js";

describe("GET /states - full master list independent of article coverage", () => {
  it("returns every seeded state/UT, including ones with zero imported articles", async () => {
    await seedStates();
    // Only Karnataka has any Article at all in this test's data.
    await Article.create({ stateCode: "KA", articleCode: `SM-${Date.now()}`, title: "Sample", createdBy: "000000000000000000000000", currentVersion: 1 });

    const req = makeReq({ user: { id: "u", role: Role.SUPER_ADMIN, organizationId: "org-1", permissions: [Permission.ARTICLE_VIEW] } });
    const { res, error } = await runController(stateController.listAllStates, req, makeRes());

    expect(error).toBeNull();
    const states = res.body.data;
    expect(states.length).toBe(36);
    const codes = states.map((s) => s.code);
    expect(codes).toContain("DL"); // Delhi - has no Article in this test, still must be listed
    expect(codes).toContain("KA");
    const delhi = states.find((s) => s.code === "DL");
    expect(delhi.name).toBe("Delhi");
  });

  it("seeding twice never duplicates a state", async () => {
    await seedStates();
    const first = await State.countDocuments();
    await seedStates();
    const second = await State.countDocuments();
    expect(second).toBe(first);
  });
});
