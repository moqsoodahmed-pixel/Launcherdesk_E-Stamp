import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import EStampProviderPage from "./EStampProviderPage";
import { apiClient } from "../../api/client";

vi.mock("../../api/client", () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), defaults: { baseURL: "" } },
}));

function mockLoad({ balance, usage }) {
  apiClient.get.mockImplementation((url) => {
    if (url === "/estamp-provider/balance") return Promise.resolve({ data: { data: balance } });
    if (url === "/estamp-provider/usage") return Promise.resolve({ data: { data: usage } });
    return Promise.reject(new Error(`unexpected url ${url}`));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("EStampProviderPage - financial display consistency (Phase 38)", () => {
  it("formats internal usage stamp-value totals the same way as every other amount in the app (₹ + en-IN grouping)", async () => {
    mockLoad({
      balance: { status: "AVAILABLE", available: 100000, currency: "INR", source: "mock", fetchedAt: new Date().toISOString() },
      usage: {
        from: new Date().toISOString(),
        to: new Date().toISOString(),
        totals: { totalOrders: 2, issued: 1, processing: 1, failed: 0, totalStampValue: 1234567 },
        breakdown: [{ key: "org-1", totalOrders: 2, issued: 1, processing: 1, failed: 0, totalStampValue: 1234567 }],
      },
    });
    render(<EStampProviderPage />);

    // Before the fix this rendered as the bare, ungrouped "₹1234567".
    expect(await screen.findAllByText("₹12,34,567")).toHaveLength(2);
  });

  it("gives the group-by selector an accessible name", async () => {
    mockLoad({
      balance: { status: "NOT_CONFIGURED", available: null, currency: null, source: "none", fetchedAt: null },
      usage: { from: new Date().toISOString(), to: new Date().toISOString(), totals: { totalOrders: 0, issued: 0, processing: 0, failed: 0, totalStampValue: 0 }, breakdown: [] },
    });
    render(<EStampProviderPage />);
    expect(await screen.findByLabelText("Group by")).toBeInTheDocument();
  });
});
