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
});
