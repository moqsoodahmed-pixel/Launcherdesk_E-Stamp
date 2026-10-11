import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { parseDateTo } = require("../src/utils/dateRange.js");

describe("parseDateTo", () => {
  it("treats a date-only value as the end of that day, so the last day is included", () => {
    expect(parseDateTo("2026-10-11").toISOString()).toBe("2026-10-11T23:59:59.999Z");
  });
  it("uses a full timestamp exactly as given", () => {
    expect(parseDateTo("2026-10-11T08:30:00.000Z").toISOString()).toBe("2026-10-11T08:30:00.000Z");
  });
  it("leaves invalid input invalid so the controller's own validation rejects it", () => {
    expect(Number.isNaN(parseDateTo("not-a-date").getTime())).toBe(true);
  });
});
