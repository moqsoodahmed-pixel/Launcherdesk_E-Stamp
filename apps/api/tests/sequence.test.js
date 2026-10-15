import { describe, it, expect } from "vitest";
import "./setup";
import { Counter } from "../src/models/index.js";
import { nextSequence } from "../src/utils/sequence.js";

describe("nextSequence", () => {
  it("starts at 1 for a counter that has never been used", async () => {
    const seq = await nextSequence("TEST-FRESH");
    expect(seq).toBe(1);
  });

  it("increments by 1 on each call, in order", async () => {
    const a = await nextSequence("TEST-INCR");
    const b = await nextSequence("TEST-INCR");
    const c = await nextSequence("TEST-INCR");
    expect([a, b, c]).toEqual([1, 2, 3]);
  });

  it("never hands the same number to concurrent callers", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => nextSequence("TEST-CONCURRENT"))
    );
    const unique = new Set(results);
    expect(unique.size).toBe(20);
    expect(Math.max(...results)).toBe(20);
  });

  it("restarts at 1 after the Counter document is deleted (reset)", async () => {
    await nextSequence("TEST-RESET");
    await nextSequence("TEST-RESET");
    await Counter.deleteOne({ _id: "TEST-RESET" });
    const seq = await nextSequence("TEST-RESET");
    expect(seq).toBe(1);
  });

  it("keeps independent sequences for different names", async () => {
    const a = await nextSequence("TEST-NAME-A");
    const b = await nextSequence("TEST-NAME-B");
    expect(a).toBe(1);
    expect(b).toBe(1);
  });
});
