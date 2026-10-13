import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import RequestDetailPage from "./RequestDetailPage";
import { apiClient } from "../../api/client";

vi.mock("../../api/client", () => ({
  apiClient: { get: vi.fn(), patch: vi.fn(), post: vi.fn() },
}));
let mockUser = { role: "SUPER_ADMIN", permissions: ["estamp.view", "estamp.modify", "estamp.cancel"] };
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: mockUser }) }));

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

describe("RequestDetailPage - modification window and permissions", () => {
  const open = (seconds) => request({ status: "MODIFICATION_WINDOW", canModify: true, canCancel: true, windowRemainingSeconds: seconds });
  afterEach(() => {
    vi.useRealTimers();
    mockUser = { role: "SUPER_ADMIN", permissions: ["estamp.view", "estamp.modify", "estamp.cancel"] };
  });

  it("shows the countdown as m:ss", async () => {
    apiClient.get.mockResolvedValue({ data: { data: open(1199) } });
    renderAt();
    expect(await screen.findByText("19:59")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel Request" })).toBeEnabled();
  });

  it("closes Edit and Cancel when the countdown reaches zero", async () => {
    apiClient.get.mockResolvedValue({ data: { data: open(1) } });
    renderAt();
    expect(await screen.findByRole("button", { name: "Edit details" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Modification window has closed.")).toBeInTheDocument(), { timeout: 2500 });
    expect(screen.queryByRole("button", { name: "Edit details" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel Request" })).toBeDisabled();
  });

  it("hides Edit and Cancel from a USER who lacks estamp.modify / estamp.cancel", async () => {
    mockUser = { role: "USER", permissions: ["estamp.view"] };
    apiClient.get.mockResolvedValue({ data: { data: open(600) } });
    renderAt();
    await screen.findByText("REQ-0001");
    expect(screen.queryByRole("button", { name: "Edit details" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel Request" })).not.toBeInTheDocument();
  });

  it("an ADMIN (modify, no cancel) can edit but sees no Cancel button", async () => {
    mockUser = { role: "ADMIN", permissions: ["estamp.view", "estamp.modify"] };
    apiClient.get.mockResolvedValue({ data: { data: open(600) } });
    renderAt();
    expect(await screen.findByRole("button", { name: "Edit details" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel Request" })).not.toBeInTheDocument();
  });
});

describe("RequestDetailPage - editing who pays the stamp duty", () => {
  const open = (overrides = {}) => request({ status: "MODIFICATION_WINDOW", canModify: true, canCancel: true, windowRemainingSeconds: 600, ...overrides });

  beforeEach(() => {
    mockUser = { role: "SUPER_ADMIN", permissions: ["estamp.view", "estamp.modify", "estamp.cancel"] };
  });

  it("pre-selects the party that already matches the stored payer", async () => {
    apiClient.get.mockResolvedValue({ data: { data: open({ firstParty: "Alice", secondParty: "Bob", stampDutyPaidBy: "Bob" }) } });
    renderAt();
    fireEvent.click(await screen.findByRole("button", { name: "Edit details" }));
    expect(await screen.findByRole("button", { name: "Bob (Second Party)" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Alice (First Party)" })).toHaveAttribute("aria-pressed", "false");
  });

  it("selects only ONE party when both parties share a name - the bug this fixes", async () => {
    apiClient.get.mockResolvedValue({ data: { data: open({ firstParty: "das", secondParty: "das", stampDutyPaidBy: "das" }) } });
    renderAt();
    fireEvent.click(await screen.findByRole("button", { name: "Edit details" }));

    const first = await screen.findByRole("button", { name: "das (First Party)" });
    const second = screen.getByRole("button", { name: "das (Second Party)" });
    // With an ambiguous stored name, neither is auto-selected rather than both.
    expect(first).toHaveAttribute("aria-pressed", "false");
    expect(second).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(first);
    expect(first).toHaveAttribute("aria-pressed", "true");
    expect(second).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(second);
    expect(first).toHaveAttribute("aria-pressed", "false");
    expect(second).toHaveAttribute("aria-pressed", "true");
  });

  it("saving sends the chosen party's name, and the button is disabled with neither picked", async () => {
    apiClient.get.mockResolvedValue({ data: { data: open({ firstParty: "das", secondParty: "das", stampDutyPaidBy: "das" }) } });
    apiClient.patch.mockResolvedValue({ data: { data: {} } });
    renderAt();
    fireEvent.click(await screen.findByRole("button", { name: "Edit details" }));

    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    fireEvent.click(await screen.findByRole("button", { name: "das (Second Party)" }));
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(apiClient.patch).toHaveBeenCalled());
    expect(apiClient.patch.mock.calls[0][1]).toMatchObject({ stampDutyPaidBy: "das" });
  });

  it("falls back to a plain text box when only one party is on the request", async () => {
    apiClient.get.mockResolvedValue({ data: { data: open({ firstParty: "Alice", secondParty: "", stampDutyPaidBy: "Alice" }) } });
    renderAt();
    fireEvent.click(await screen.findByRole("button", { name: "Edit details" }));
    expect(await screen.findByLabelText("Stamp Duty Paid By")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Who pays the stamp duty?" })).not.toBeInTheDocument();
  });
});

describe("RequestDetailPage - cancel confirmation dialog", () => {
  const open = (seconds) => request({ status: "MODIFICATION_WINDOW", canModify: true, canCancel: true, windowRemainingSeconds: seconds });

  it("asks in a dialog, does nothing on Go back, and cancels only after confirming", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const u = userEvent.setup();
    apiClient.get.mockResolvedValue({ data: { data: open(1199) } });
    apiClient.post.mockResolvedValue({ data: { data: {} } });
    renderAt();
    const cancelBtn = await screen.findByRole("button", { name: "Cancel Request" });

    await u.click(cancelBtn);
    expect(await screen.findByRole("dialog", { name: "Cancel this E-Stamp request?" })).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Go back" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(cancelBtn).toHaveFocus();
    expect(apiClient.post).not.toHaveBeenCalled();

    await u.click(cancelBtn);
    await u.click(await screen.findByRole("button", { name: "Cancel the request" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/estamps/r1/cancel"));
  });
});
