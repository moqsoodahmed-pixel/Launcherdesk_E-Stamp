import { describe, it, expect } from "vitest";
import "./setup";
import { Organization } from "../src/models/index.js";
import { OrganizationStatus } from "@launcherdesk/shared";
import { enableEstampServiceForActiveOrgs } from "../src/scripts/enable-estamp-service-bulk.js";

function makeOrg(overrides = {}) {
  return Organization.create({
    name: `Org ${Date.now()}-${Math.random()}`,
    contactEmail: `org-${Date.now()}-${Math.random()}@test.com`,
    contactPhone: "1",
    createdBy: "000000000000000000000000",
    status: OrganizationStatus.ACTIVE,
    isEstampServiceEnabled: false,
    ...overrides,
  });
}

describe("enableEstampServiceForActiveOrgs - bulk E-Stamp service enable", () => {
  it("enables the service for every ACTIVE org that doesn't already have it", async () => {
    const off1 = await makeOrg();
    const off2 = await makeOrg();

    const result = await enableEstampServiceForActiveOrgs();

    expect(result.modifiedCount).toBe(2);
    expect(result.matchedOrgs.map((o) => o.id).sort()).toEqual([off1._id.toString(), off2._id.toString()].sort());

    expect((await Organization.findById(off1._id)).isEstampServiceEnabled).toBe(true);
    expect((await Organization.findById(off2._id)).isEstampServiceEnabled).toBe(true);
  });

  it("leaves non-ACTIVE organizations untouched", async () => {
    const pending = await makeOrg({ status: OrganizationStatus.PENDING_APPROVAL });

    await enableEstampServiceForActiveOrgs();

    expect((await Organization.findById(pending._id)).isEstampServiceEnabled).toBe(false);
  });

  it("is idempotent - a second run modifies nothing further", async () => {
    await makeOrg();
    await enableEstampServiceForActiveOrgs();

    const result = await enableEstampServiceForActiveOrgs();

    expect(result.modifiedCount).toBe(0);
  });
});
