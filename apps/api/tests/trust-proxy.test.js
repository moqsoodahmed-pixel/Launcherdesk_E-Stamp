// Regression test: app.js must trust the reverse proxy (Railway) so that
// req.ip - and therefore every express-rate-limit bucket - is the real client
// IP, not the proxy's. Without it, all users share one limiter bucket.
import { describe, it, expect, afterEach } from "vitest";
import { createApp } from "../src/app.js";

const original = process.env.TRUST_PROXY;

afterEach(() => {
  if (original === undefined) delete process.env.TRUST_PROXY;
  else process.env.TRUST_PROXY = original;
});

describe("trust proxy", () => {
  it("defaults to trusting one proxy hop", () => {
    delete process.env.TRUST_PROXY;
    const app = createApp();
    expect(app.get("trust proxy")).toBe(1);
    // With one trusted hop, the client IP is the last X-Forwarded-For entry.
    const ip = app.get("trust proxy fn");
    expect(ip("10.0.0.1", 0)).toBe(true);
    expect(ip("10.0.0.1", 1)).toBe(false);
  });

  it("honours TRUST_PROXY, including 0 to disable", () => {
    process.env.TRUST_PROXY = "2";
    expect(createApp().get("trust proxy")).toBe(2);
    process.env.TRUST_PROXY = "0";
    expect(createApp().get("trust proxy")).toBe(0);
  });

  it("falls back to 1 on an invalid value", () => {
    process.env.TRUST_PROXY = "yes";
    expect(createApp().get("trust proxy")).toBe(1);
  });
});
