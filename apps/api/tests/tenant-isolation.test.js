import { describe, it, expect } from "vitest";
import "./setup";
import mongoose from "mongoose";
import { EStampRequest, Organization } from "../src/models/index.js";

describe("Tenant isolation", () => {
  it("Company A's requests are excluded when querying scoped to Company B", async () => {
    const creator = new mongoose.Types.ObjectId();
    const orgA = await Organization.create({ name: "A", contactEmail: "a@x.com", contactPhone: "1", createdBy: creator });
    const orgB = await Organization.create({ name: "B", contactEmail: "b@x.com", contactPhone: "1", createdBy: creator });

    await EStampRequest.create({
      requestNumber: "LDE-REQ-TEST-1",
      organizationId: orgA._id,
      createdBy: creator,
      stateCode: "KA",
      articleId: new mongoose.Types.ObjectId(),
      articleVersionUsed: 1,
      firstParty: "X",
      secondParty: "Y",
      descriptionOfDocument: "Test",
      considerationPrice: 0,
      stampDutyPaidBy: "X",
      numberOfEStamps: 1,
      calculatedStampDuty: 100,
      status: "MODIFICATION_WINDOW",
      modificationDeadline: new Date(Date.now() + 1000 * 60 * 20),
    });

    const resultsForOrgB = await EStampRequest.find({ organizationId: orgB._id });
    expect(resultsForOrgB.length).toBe(0);

    const resultsForOrgA = await EStampRequest.find({ organizationId: orgA._id });
    expect(resultsForOrgA.length).toBe(1);
  });
});
