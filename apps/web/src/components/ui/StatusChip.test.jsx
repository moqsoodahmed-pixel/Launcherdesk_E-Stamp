import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import StatusChip, { statusMeta } from "./StatusChip";
import { formatCountdown } from "./WindowCountdown";

describe("statusMeta", () => {
  it("maps every internal stage to Being prepared for clients", () => {
    for (const s of ["LOCKED", "PROCESSING", "SUBMITTING", "SUBMITTED", "ONGOING", "CONFIRMED"]) {
      expect(statusMeta(s, { client: true }).label).toBe("Being prepared");
    }
    for (const s of ["SENT", "ACCEPTED", "UPLOADED", "REJECTED", "APPROVED"]) {
      expect(statusMeta(s, { kind: "vendor", client: true }).label).toBe("Being prepared");
    }
  });

  it("keeps the enum for staff", () => {
    expect(statusMeta("LOCKED").label).toBe("LOCKED");
    expect(statusMeta("DOWNLOAD_AVAILABLE").label).toBe("DOWNLOAD AVAILABLE");
    expect(statusMeta("SENT", { kind: "vendor" }).label).toBe("To do");
  });

  it("gives issued, failed and balance states their tones", () => {
    expect(statusMeta("ISSUED", { client: true })).toEqual({ tone: "emerald", label: "Issued" });
    expect(statusMeta("FAILED", { client: true })).toEqual({ tone: "vermilion", label: "Failed" });
    expect(statusMeta("PENDING_CREDIT", { kind: "balance" })).toEqual({ tone: "marigold", label: "Awaiting balance update" });
  });
});

describe("StatusChip window countdown", () => {
  afterEach(() => vi.useRealTimers());

  it("counts down from the server's seconds and becomes Being prepared at zero", () => {
    vi.useFakeTimers();
    render(<StatusChip status="MODIFICATION_WINDOW" remainingSeconds={2} audience="client" />);
    expect(screen.getByText("0:02")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText("0:01")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText("Being prepared")).toBeInTheDocument();
  });

  it("formats minutes and hours", () => {
    expect(formatCountdown(872)).toBe("14:32");
    expect(formatCountdown(3725)).toBe("1:02:05");
    expect(formatCountdown(-5)).toBe("0:00");
  });
});
