// errorHandler: client-facing 4xx `details` (validation errors, failed bulk
// batch) must survive in production; 5xx details and stacks must not.
import { describe, it, expect, afterEach } from "vitest";
import { createRequire } from "node:module";
// Same CommonJS instances the handler itself uses (an ESM import can yield a
// separate copy, breaking `instanceof ApiError` and the shared env object).
const require = createRequire(import.meta.url);
const { errorHandler } = require("../src/middleware/errorHandler.js");
const { ApiError } = require("../src/utils/ApiError.js");
const { env } = require("../src/config/env.js");
import { makeReq, makeRes } from "./helpers/http.js";

const previous = env.NODE_ENV;
afterEach(() => {
  env.NODE_ENV = previous;
});

describe("errorHandler in production", () => {
  it("keeps details on a 4xx ApiError", () => {
    env.NODE_ENV = "production";
    const res = makeRes();
    errorHandler(ApiError.badRequest("Validation failed", "VALIDATION_ERROR", { fieldErrors: { phone: ["Too short"] } }), makeReq(), res, () => {});
    expect(res.statusCode).toBe(400);
    expect(res.body.details).toEqual({ fieldErrors: { phone: ["Too short"] } });
  });

  it("hides details on a 5xx ApiError and hides unhandled error internals", () => {
    env.NODE_ENV = "production";
    const res = makeRes();
    errorHandler(ApiError.internal("db exploded"), makeReq(), res, () => {});
    expect(res.body.details).toBeUndefined();
    const res2 = makeRes();
    errorHandler(new Error("secret internals"), makeReq(), res2, () => {});
    expect(res2.body.message).toBe("Internal server error");
    expect(res2.body.stack).toBeUndefined();
  });

  it("turns a malformed-ObjectId CastError into a 404", async () => {
    const mongoose = require("mongoose");
    const castError = new mongoose.Error.CastError("ObjectId", "abc", "_id");
    const res = makeRes();
    errorHandler(castError, makeReq(), res, () => {});
    expect(res.statusCode).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });
});
