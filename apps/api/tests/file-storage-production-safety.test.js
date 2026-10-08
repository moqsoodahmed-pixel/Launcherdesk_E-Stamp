// Phase 34 - Production Deployment & Release Readiness.
//
// Regression test for a genuine deployment blocker in services/file.service.js:
// FileService.upload() fell back to a non-persistent, fake "DEV mock adapter"
// (FileAsset with a cloudinaryPublicId like "mock/...") whenever
// CLOUDINARY_CLOUD_NAME was unset - including in production. Every other
// provider abstraction in this codebase (payment-providers, email-providers,
// estamp-providers) deliberately fails closed in production instead of
// silently mocking a real-looking success; file storage was the one
// exception, which would mean a production deployment that forgot to set
// CLOUDINARY_CLOUD_NAME would "successfully" accept certificate/document
// uploads that are never actually durably stored anywhere. This test pins
// the fix: upload() now throws the same class of configuration error in
// production, and still falls back to the dev mock outside production.
import { describe, it, expect, afterEach } from "vitest";
import "./setup";
import mongoose from "mongoose";
import { createRequire } from "node:module";

// config/env.js and file.service.js are plain CommonJS modules required via
// require(), not import - pulling `env` in through an ESM `import` here
// would resolve to a SEPARATE module instance from the one file.service.js's
// own require("../config/env") sees, so mutating it would silently have no
// effect on FileService's view of NODE_ENV (observed while writing this
// test). require() via createRequire guarantees the same CJS module/object
// instance FileService itself reads - the same pattern already used by
// estamp-processing.test.js/estamp-provider-balance.test.js for this exact
// reason.
const require = createRequire(import.meta.url);
const { env } = require("../src/config/env.js");
const { FileService } = require("../src/services/file.service.js");

describe("FileService production storage safety", () => {
  const originalNodeEnv = env.NODE_ENV;
  const originalCloudName = env.CLOUDINARY_CLOUD_NAME;

  afterEach(() => {
    env.NODE_ENV = originalNodeEnv;
    env.CLOUDINARY_CLOUD_NAME = originalCloudName;
  });

  it("refuses to upload (fails closed) in production when Cloudinary is not configured, instead of mocking storage", async () => {
    env.NODE_ENV = "production";
    env.CLOUDINARY_CLOUD_NAME = "";
    await expect(
      FileService.upload({
        organizationId: new mongoose.Types.ObjectId().toString(),
        ownerUserId: new mongoose.Types.ObjectId().toString(),
        fileType: "REQUEST_SUPPORTING_DOC",
        originalFileName: "test.pdf",
        mimeType: "application/pdf",
        fileBuffer: Buffer.from("%PDF-1.4 test content"),
      })
      // Note: ApiError.internal(message, code) ignores its second argument
      // in all callers across the codebase (every static ApiError.internal()
      // call always produces code "INTERNAL" - a pre-existing, inert
      // inconsistency shared with payment-providers/email-providers/
      // estamp-providers, not something newly introduced here), so this
      // asserts on statusCode/message rather than an invented "code" value.
    ).rejects.toMatchObject({
      statusCode: 500,
      code: "INTERNAL",
      message: expect.stringContaining("CLOUDINARY_CLOUD_NAME"),
    });
  });

  it("still falls back to the dev mock adapter outside production (non-breaking for local/dev/test workflows)", async () => {
    env.NODE_ENV = "development";
    env.CLOUDINARY_CLOUD_NAME = "";
    const asset = await FileService.upload({
      organizationId: new mongoose.Types.ObjectId().toString(),
      ownerUserId: new mongoose.Types.ObjectId().toString(),
      fileType: "REQUEST_SUPPORTING_DOC",
      originalFileName: "test.pdf",
      mimeType: "application/pdf",
      fileBuffer: Buffer.from("%PDF-1.4 test content"),
    });
    expect(asset.cloudinaryPublicId).toMatch(/^mock\//);
  });
});
