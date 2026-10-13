import { describe, it, expect } from "vitest";
import { clientRequestSteps, clientOrderTimeline } from "./clientTimeline";

const labels = (steps) => steps.map((s) => s.label);

describe("clientRequestSteps", () => {
  const base = { createdAt: "2026-10-01T10:00:00Z" };

  it("in the edit window shows Submitted and a not-yet-started Being prepared", () => {
    const steps = clientRequestSteps({ ...base, status: "MODIFICATION_WINDOW" }, null);
    expect(labels(steps)).toEqual(["Submitted", "Being prepared"]);
    expect(steps[1]).toMatchObject({ done: false, pending: false });
  });

  it("provider mode (locked, submitted to provider, processing) reads Being prepared, in progress", () => {
    const order = { order: { eStampStatus: "PROCESSING", submittedAt: "2026-10-01T10:30:00Z" } };
    const steps = clientRequestSteps({ ...base, status: "PROCESSING", lockedAt: "2026-10-01T10:20:00Z" }, order);
    expect(labels(steps)).toEqual(["Submitted", "Being prepared"]);
    expect(steps[1]).toMatchObject({ at: "2026-10-01T10:20:00.000Z", pending: true });
  });

  it("issued, failed and cancelled end the timeline", () => {
    expect(labels(clientRequestSteps({ ...base, status: "DOWNLOAD_AVAILABLE", lockedAt: base.createdAt }, { order: { eStampStatus: "ISSUED", issuedAt: "x" } }))).toEqual(["Submitted", "Being prepared", "Issued"]);
    expect(labels(clientRequestSteps({ ...base, status: "FAILED" }, { order: { eStampStatus: "FAILED", failureReason: "r" } }))).toEqual(["Submitted", "Being prepared", "Failed"]);
    expect(labels(clientRequestSteps({ ...base, status: "CANCELLED" }, null))).toEqual(["Submitted", "Cancelled"]);
  });
});

describe("clientOrderTimeline", () => {
  it("folds manual steps into Submitted, Being prepared, Issued", () => {
    const out = clientOrderTimeline([
      { key: "submitted", label: "Submitted", at: "2026-10-01T10:00:00Z" },
      { key: "window", label: "Window ends", at: "2026-10-01T10:20:00Z" },
      { key: "queued", label: "Queued", at: "2026-10-01T10:20:00Z" },
      { key: "in_progress", label: "In progress", at: "2026-10-01T11:00:00Z" },
      { key: "issued", label: "Issued", at: "2026-10-01T12:00:00Z", downloadable: true },
    ]);
    expect(labels(out)).toEqual(["Submitted", "Being prepared", "Issued"]);
    expect(out[2].downloadable).toBe(true);
  });

  it("folds provider steps the same way and drops the document event", () => {
    const out = clientOrderTimeline([
      { label: "Request created", at: "a" },
      { label: "Order created", at: "2026-10-01T10:20:00Z" },
      { label: "Submitted to provider", at: "2026-10-01T10:21:00Z" },
      { label: "Last status sync", at: "2026-10-01T10:25:00Z" },
    ]);
    expect(labels(out)).toEqual(["Submitted", "Being prepared"]);
    expect(out[1].inProgress).toBe(true);
  });

  it("an upcoming window end shows Being prepared as upcoming", () => {
    const out = clientOrderTimeline([
      { key: "submitted", label: "Submitted", at: "a" },
      { key: "window", label: "Window ends", at: "b", upcoming: true },
    ]);
    expect(out[1]).toEqual({ label: "Being prepared", at: "b", upcoming: true });
  });
});
