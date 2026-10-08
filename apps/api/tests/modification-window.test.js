import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import "./setup";

// The service/error modules under test are plain CommonJS (require/module.exports).
// Loading them with `require` here (instead of ESM `import`) keeps them on the same
// module instance the rest of the CJS codebase uses - importing a CJS file via
// Vitest's ESM transform pipeline can otherwise produce a second, distinct copy of
// the module (and thus a second, unequal `ApiError` class), which breaks
// `instanceof` checks even though it's "the same file".
const require = createRequire(import.meta.url);
const { EStampRequestService } = require("../src/services/estamp-request.service.js");
const { ApiError } = require("../src/utils/ApiError.js");

describe("20-minute modification/cancellation window (backend-authoritative)", () => {
  it("allows cancellation within the window", () => {
    const request = {
      status: "MODIFICATION_WINDOW",
      modificationDeadline: new Date(Date.now() + 5 * 60 * 1000),
    };
    expect(() => EStampRequestService.assertWithinModificationWindow(request)).not.toThrow();
  });

  it("blocks cancellation once the deadline has passed, regardless of any client-supplied timer", () => {
    const request = {
      status: "MODIFICATION_WINDOW",
      modificationDeadline: new Date(Date.now() - 1000),
    };
    expect(() => EStampRequestService.assertWithinModificationWindow(request)).toThrow(ApiError);
  });

  it("blocks modification when the request is already locked", () => {
    const request = {
      status: "LOCKED",
      modificationDeadline: new Date(Date.now() + 5 * 60 * 1000),
    };
    expect(() => EStampRequestService.assertWithinModificationWindow(request)).toThrow(ApiError);
  });
});
