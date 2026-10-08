import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 30000,
    hookTimeout: 30000,
    // Set BEFORE any test file's modules are evaluated (unlike setting
    // process.env inside a beforeAll hook, which runs too late relative to
    // whichever test file's copy of src/config/env.js gets evaluated first -
    // that module snapshots process.env.JWT_SECRET once, at import time,
    // so a late assignment only "wins" for files imported after it and
    // produces a token-signing/verification secret mismatch for others).
    env: {
      JWT_SECRET: "test_secret",
      JWT_REFRESH_SECRET: "test_refresh_secret",
    },
    // Each test file boots its own MongoMemoryServer, which downloads/locks a
    // shared binary cache file. Running test files concurrently makes them
    // race for that lock (UnableToUnlockLockfileError). Force sequential,
    // single-process execution so only one MongoMemoryServer instance is
    // ever starting up at a time.
    fileParallelism: false,
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
