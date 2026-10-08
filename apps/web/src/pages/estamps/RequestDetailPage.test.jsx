import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import RequestDetailPage from "./RequestDetailPage";
import { apiClient } from "../../api/client";

vi.mock("../../api/client", () => ({
  apiClient: { get: vi.fn(), patch: vi.fn(), post: vi.fn() },
}));

function renderAt(id = "r1") {
  return render(
    <MemoryRouter initialEntries={[`/estamps/requests/${id}`]}>
      <Routes>
        <Route path="/estamps/requests/:id" element={<RequestDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

function request(overrides = {}) {
  return {
    _id: "r1",
    requestNumber: "REQ-0001",
    status: "LOCKED",
    firstParty: "Alice",
    secondParty: "Bob",
    descriptionOfDocument: "Sale deed",
    propertyDescription: "",
    stampDutyPaidBy: "Alice",
    stateCode: "MH",
    articleVersionUsed: 1,
    numberOfEStamps: 1,
    considerationPrice: 100000,
    calculatedStampDuty: 5000,
    canModify: false,
    canCancel: false,
    createdAt: new Date().toISOString(),
    orderId: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("RequestDetailPage - happy path", () => {
  it("loads and renders the real request", async () => {
    apiClient.get.mockResolvedValue({ data: { data: request() } });
    renderAt();
    expect(await screen.findByText("REQ-0001")).toBeInTheDocument();
    expect(screen.getByText("Sale deed")).toBeInTheDocument();
  });
});

describe("RequestDetailPage - initial load failure (Phase 38 fix)", () => {
  it("shows a visible error with a retry option instead of an infinite Loading state", async () => {
    apiClient.get.mockRejectedValue({ response: { data: { message: "Request not found." } } });
    renderAt();

    // Before the fix, an unhandled rejection in the initial reload() left
    // `request` null forever, so the page never left "Loading...".
    expect(await screen.findByText("Request not found.")).toBeInTheDocument();
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("recovers via Retry once the server succeeds, without a full page refresh", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    apiClient.get.mockRejectedValueOnce({ response: { data: { message: "Request not found." } } });
    renderAt();
    await screen.findByRole("button", { name: "Retry" });

    apiClient.get.mockResolvedValue({ data: { data: request() } });
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("REQ-0001")).toBeInTheDocument();
  });
});
