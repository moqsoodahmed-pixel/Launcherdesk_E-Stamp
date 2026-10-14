import { describe, it, expect } from "vitest";
import "./setup";
import mongoose from "mongoose";
import { Organization, Wallet, Article, ArticleVersion, EStampRequest } from "../src/models/index.js";
import { Role, OrganizationStatus, getEffectivePermissions } from "@launcherdesk/shared";
import { EStampRequestService } from "../src/services/estamp-request.service.js";
import * as estampController from "../src/controllers/estamp-request.controller.js";
import { createEStampRequestSchema } from "@launcherdesk/validation";
import { makeReq, makeRes, runController } from "./helpers/http.js";

// Regression coverage for a real cross-tenant bug: verifyDocuments used to
// pass organizationId=undefined for EVERY internal actor (Master Admin and
// Assistant Master Admin alike), which meant the service's lookup query had
// NO org filter at all - an Assistant Master Admin holding only the default
// ESTAMP_VIEW permission (not even an explicit grant) could mark ANY
// organization's request as documents-verified, regardless of assignment.
// The fix derives organizationId from the REQUEST ITSELF and asserts org
// access before any mutation.

async function makeOrgWithRequest({ balance = 100000, fixedAmount = 500 } = {}) {
  const creator = new mongoose.Types.ObjectId();
  const org = await Organization.create({
    name: "Verify-Docs Test Co",
    contactEmail: `verifydocs-${new mongoose.Types.ObjectId()}@example.com`,
    contactPhone: "9999999999",
    createdBy: creator,
    status: OrganizationStatus.ACTIVE,
    isEstampServiceEnabled: true,
  });
  await Wallet.create({ organizationId: org._id, balance });
  const article = await Article.create({ stateCode: "KA", articleCode: `VD-${new mongoose.Types.ObjectId()}`, title: "Verify Docs Article", createdBy: creator, currentVersion: 1 });
  await ArticleVersion.create({ articleId: article._id, versionNumber: 1, calculationRule: { type: "FIXED", fixedAmount }, createdBy: creator });
  const body = createEStampRequestSchema.parse({
    stateCode: "KA",
    articleId: article._id.toString(),
    firstParty: "Alice",
    secondParty: "Bob",
    descriptionOfDocument: "Verify docs test agreement",
    considerationPrice: 0,
    stampDutyPaidBy: "Alice",
    numberOfEStamps: 1,
  });
  const { request } = await EStampRequestService.createRequest({ ...body, organizationId: org._id, createdBy: new mongoose.Types.ObjectId(), actorRole: Role.USER });
  return { org, request };
}

function assistantReq(requestId, overrides = {}) {
  return makeReq({
    user: { id: new mongoose.Types.ObjectId().toString(), role: Role.ASSISTANT_MASTER_ADMIN, organizationId: null, permissions: getEffectivePermissions(Role.ASSISTANT_MASTER_ADMIN, []) },
    params: { id: requestId.toString() },
    body: {},
    ...overrides,
  });
}

describe("verifyDocuments - tenant isolation for internal actors", () => {
  it("is rejected (403) for an Assistant Master Admin never assigned to the request's organization", async () => {
    const { org, request } = await makeOrgWithRequest();
    const { error } = await runController(estampController.verifyDocuments, assistantReq(request._id), makeRes());
    expect(error).not.toBeNull();
    expect(error.statusCode).toBe(403);
    const reloaded = await EStampRequest.findById(request._id);
    expect(reloaded.documentsVerified).not.toBe(true);
  });

  it("succeeds once the Assistant Master Admin IS assigned to the request's organization", async () => {
    const { org, request } = await makeOrgWithRequest();
    const assistantId = new mongoose.Types.ObjectId();
    await Organization.updateOne({ _id: org._id }, { assignedAssistantId: assistantId });
    const req = assistantReq(request._id, { user: { id: assistantId.toString(), role: Role.ASSISTANT_MASTER_ADMIN, organizationId: null, permissions: getEffectivePermissions(Role.ASSISTANT_MASTER_ADMIN, []) } });
    const { error, res } = await runController(estampController.verifyDocuments, req, makeRes());
    expect(error).toBeNull();
    expect(res.body.data.documentsVerified).toBe(true);
  });

  it("Master Admin (genuinely unrestricted) can verify documents on any organization's request", async () => {
    const { request } = await makeOrgWithRequest();
    const req = makeReq({
      user: { id: new mongoose.Types.ObjectId().toString(), role: Role.MASTER_ADMIN, organizationId: null, permissions: getEffectivePermissions(Role.MASTER_ADMIN, []) },
      params: { id: request._id.toString() },
      body: {},
    });
    const { error, res } = await runController(estampController.verifyDocuments, req, makeRes());
    expect(error).toBeNull();
    expect(res.body.data.documentsVerified).toBe(true);
  });

  it("a non-existent request id gives a clean 404, not a 403 that would confirm existence", async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const { error } = await runController(estampController.verifyDocuments, assistantReq(fakeId), makeRes());
    expect(error).not.toBeNull();
    expect(error.statusCode).toBe(404);
  });
});
