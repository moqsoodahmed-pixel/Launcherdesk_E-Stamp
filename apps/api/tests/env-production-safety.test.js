// Phase 34 - Production Deployment & Release Readiness.
//
// Regression test for a genuine deployment blocker found in config/env.js's
// required() helper: JWT_SECRET, JWT_REFRESH_SECRET and MONGODB_URI were all
// declared via required(name, fallback) with a non-undefined dev fallback,
// which meant the "throw in production when missing" branch could never
// actually run - the fallback always made `val` defined, so an operator who
// forgot to set JWT_SECRET in production would silently get a well-known,
// publicly-visible insecure default instead of a startup failure. This test
// does not touch mongodb-memory-server/setup.js - it loads config/env.js in
// isolation (fresh module registry) under controlled process.env values.
import { describe, it, expect, afterEach, vi } from "vitest";
import os from "node:os";

const ENV_MODULE = "../src/config/env.js";

// vitest.config.js injects JWT_SECRET/JWT_REFRESH_SECRET into process.env for
// every test file (so token signing/verification is consistent across the
// whole suite) - these specific keys must be explicitly cleared here, not
// just left out of `overrides`, or they'd leak in and mask the very
// missing-secret scenarios this file tests.
const ALWAYS_CLEAR = ["JWT_SECRET", "JWT_REFRESH_SECRET", "MONGODB_URI", "NODE_ENV"];

async function loadEnvWithProcessEnv(overrides) {
  const previous = { ...process.env };
  const previousCwd = process.cwd();
  ALWAYS_CLEAR.forEach((k) => delete process.env[k]);
  Object.assign(process.env, overrides);
  // config/env.js calls dotenv.config(), which reads a .env file from the
  // current working directory and - critically - only fills in keys NOT
  // already present in process.env. Running from the real repo cwd would
  // let the real dev .env file silently repopulate the very vars this test
  // just deleted (defeating the "unset in production" scenarios below), so
  // this import runs from the OS tmp dir instead, where dotenv finds no
  // .env file and is a no-op.
  process.chdir(os.tmpdir());
  vi.resetModules();
  try {
    // A plain `import(ENV_MODULE)` can resolve to a stale, previously
    // evaluated copy of this CJS module under vite-node's SSR cache even
    // after vi.resetModules() - appending a unique query string forces a
    // genuinely fresh module evaluation against the process.env set above.
    return await import(`${ENV_MODULE}?t=${Date.now()}-${Math.random()}`);
  } finally {
    process.chdir(previousCwd);
    ALWAYS_CLEAR.forEach((k) => delete process.env[k]);
    Object.assign(process.env, previous);
  }
}

describe("config/env.js production secret safety", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("throws on startup in production when JWT_SECRET is unset, instead of falling back to the dev default", async () => {
    await expect(
      loadEnvWithProcessEnv({
        NODE_ENV: "production",
        MONGODB_URI: "mongodb://example-prod-host/launcherdesk",
        JWT_REFRESH_SECRET: "a-real-refresh-secret",
      })
    ).rejects.toThrow(/JWT_SECRET/);
  });

  it("throws on startup in production when JWT_REFRESH_SECRET is unset", async () => {
    await expect(
      loadEnvWithProcessEnv({
        NODE_ENV: "production",
        MONGODB_URI: "mongodb://example-prod-host/launcherdesk",
        JWT_SECRET: "a-real-jwt-secret",
      })
    ).rejects.toThrow(/JWT_REFRESH_SECRET/);
  });

  it("throws on startup in production when MONGODB_URI is unset", async () => {
    await expect(
      loadEnvWithProcessEnv({
        NODE_ENV: "production",
        JWT_SECRET: "a-real-jwt-secret",
        JWT_REFRESH_SECRET: "a-real-refresh-secret",
      })
    ).rejects.toThrow(/MONGODB_URI/);
  });

  it("still allows the dev-only fallback outside production (non-breaking for local/dev workflows)", async () => {
    const mod = await loadEnvWithProcessEnv({
      NODE_ENV: "development",
    });
    expect(mod.env.JWT_SECRET).toBe("dev_only_insecure_secret_change_me");
    expect(mod.env.MONGODB_URI).toBe("mongodb://localhost:27017/launcherdesk_estamping");
  });

  it("loads cleanly in production when all required secrets are explicitly set", async () => {
    const mod = await loadEnvWithProcessEnv({
      NODE_ENV: "production",
      MONGODB_URI: "mongodb://example-prod-host/launcherdesk",
      JWT_SECRET: "a-real-jwt-secret",
      JWT_REFRESH_SECRET: "a-real-refresh-secret",
    });
    expect(mod.env.NODE_ENV).toBe("production");
    expect(mod.env.JWT_SECRET).toBe("a-real-jwt-secret");
  });
});
