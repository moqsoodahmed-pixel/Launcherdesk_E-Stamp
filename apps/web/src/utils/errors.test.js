import { describe, it, expect } from "vitest";
import { getErrorMessage, RATE_LIMIT_MESSAGE, NETWORK_ERROR_MESSAGE, TIMEOUT_MESSAGE } from "./errors";

describe("getErrorMessage", () => {
  it("prefers the server's message", () => {
    expect(getErrorMessage({ response: { status: 400, data: { message: "Email taken" } } }, "x")).toBe("Email taken");
  });
  it("uses the fallback when the server sent no message", () => {
    expect(getErrorMessage({ response: { status: 500, data: {} } }, "Failed to load.")).toBe("Failed to load.");
  });
  it("explains 429, timeouts and network failures", () => {
    expect(getErrorMessage({ response: { status: 429, data: { message: "rl" } } }, "x")).toBe(RATE_LIMIT_MESSAGE);
    expect(getErrorMessage({ code: "ECONNABORTED", isAxiosError: true }, "x")).toBe(TIMEOUT_MESSAGE);
    expect(getErrorMessage({ isAxiosError: true, request: {} }, "x")).toBe(NETWORK_ERROR_MESSAGE);
  });
  // A bare "Validation failed" told the user nothing they could act on - the
  // real reason was sitting unused in details.fieldErrors (Zod's flatten()).
  it("appends the specific Zod field error instead of a bare 'Validation failed'", () => {
    const err = {
      response: {
        status: 400,
        data: {
          message: "Validation failed",
          code: "VALIDATION_ERROR",
          details: { formErrors: [], fieldErrors: { phone: ["String must contain at least 6 character(s)"] } },
        },
      },
    };
    expect(getErrorMessage(err, "x")).toBe("Validation failed - phone: String must contain at least 6 character(s)");
  });
  it("joins multiple field errors and ignores fields with no messages", () => {
    const err = {
      response: {
        status: 400,
        data: {
          message: "Validation failed",
          details: { fieldErrors: { name: ["Too short"], email: [], role: ["Invalid enum value"] } },
        },
      },
    };
    expect(getErrorMessage(err, "x")).toBe("Validation failed - name: Too short; role: Invalid enum value");
  });
});
