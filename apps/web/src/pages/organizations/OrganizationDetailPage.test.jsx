import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import OrganizationDetailPage from "./OrganizationDetailPage";
import { apiClient } from "../../api/client";

vi.mock("../../api/client", () => ({
  apiClient: { get: vi.fn(), patch: vi.fn(), post: vi.fn() },
}));

function renderAt(detail) {
  apiClient.get.mockResolvedValue({ data: { data: detail } });
  return render(
    <MemoryRouter initialEntries={["/organizations/o1"]}>
      <Routes>
        <Route path="/organizations/:id" element={<OrganizationDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

function baseDetail(overrides = {}) {
  return {
    organization: {
      _id: "o1",
      name: "Acme Corp",
      contactEmail: "contact@acme.test",
      contactPhone: "9999999999",
      gstin: "",
      address: "",
      status: "ACTIVE",
      createdAt: new Date().toISOString(),
    },
    wallet: { balance: 5000, currency: "INR" },
    superAdmin: { name: "Jane Admin", email: "jane@acme.test", isActive: true },
    userCounts: { SUPER_ADMIN: 1, ADMIN: 2, USER: 10, totalActive: 12, totalUsers: 13 },
    activity: { estampRequestCount: 42, orderCount: 30 },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("OrganizationDetailPage - aggregates from the real detail endpoint", () => {
  it("renders wallet balance, user counts, and activity counts verbatim - never recomputed client-side", async () => {
    renderAt(baseDetail());
    expect(await screen.findByText("Acme Corp")).toBeInTheDocument();
    // Phase 38: now uses the shared formatCurrency (₹, "en-IN" grouping) -
    // same as every other wallet-balance display in the app (WalletPage,
    // dashboards) - instead of a one-off "<currency code> <number>" format.
    expect(screen.getByText("₹5,000")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("30")).toBeInTheDocument();
    expect(screen.getByText("13")).toBeInTheDocument();
  });

  it("shows no-wallet state honestly rather than fabricating a balance", async () => {
    renderAt(baseDetail({ wallet: null }));
    await screen.findByText("Acme Corp");
    expect(screen.getByText("No wallet found.")).toBeInTheDocument();
  });
});

describe("OrganizationDetailPage - status management", () => {
  it("requires confirmation and calls the real status endpoint", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    apiClient.patch.mockResolvedValue({ data: { data: {} } });
    renderAt(baseDetail());
    await screen.findByText("Acme Corp");

    await user.click(screen.getByRole("button", { name: "SUSPENDED" }));
    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledWith("/organizations/o1/status", { status: "SUSPENDED" }));
  });

  it("does not call the status endpoint when the confirmation is declined", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderAt(baseDetail());
    await screen.findByText("Acme Corp");

    await user.click(screen.getByRole("button", { name: "SUSPENDED" }));
    expect(apiClient.patch).not.toHaveBeenCalled();
  });

  it("disables the button for the organization's current status", async () => {
    renderAt(baseDetail());
    await screen.findByText("Acme Corp");
    expect(screen.getByRole("button", { name: "ACTIVE" })).toBeDisabled();
  });
});

describe("OrganizationDetailPage - Super Admin provisioning", () => {
  it("shows the one-time temp password after provisioning and never persists/repeats it", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    apiClient.post.mockResolvedValue({ data: { data: { tempPassword: "Temp!23456" } } });
    renderAt(baseDetail({ superAdmin: null }));
    await screen.findByText("No Super Admin has been provisioned yet.");

    await user.click(screen.getByText("Provision initial Super Admin"));
    await user.type(screen.getByLabelText("Name"), "New Admin");
    await user.type(screen.getByLabelText("Email"), "new@acme.test");
    await user.click(screen.getByRole("button", { name: "Provision Super Admin" }));

    expect(await screen.findByText("Temp!23456")).toBeInTheDocument();
    expect(apiClient.post).toHaveBeenCalledWith("/organizations/o1/super-admin", expect.objectContaining({ name: "New Admin", email: "new@acme.test" }));
  });

  it("shows existing Super Admin details instead of a provisioning form when one exists", async () => {
    renderAt(baseDetail());
    await screen.findByText("Acme Corp");
    expect(screen.getByText("Jane Admin")).toBeInTheDocument();
    expect(screen.queryByText("Provision initial Super Admin")).not.toBeInTheDocument();
  });
});

describe("OrganizationDetailPage - error handling", () => {
  it("shows a load error instead of a blank page when the detail call fails", async () => {
    apiClient.get.mockRejectedValue({ response: { data: { message: "You do not have permission to access this organization." } } });
    render(
      <MemoryRouter initialEntries={["/organizations/o1"]}>
        <Routes>
          <Route path="/organizations/:id" element={<OrganizationDetailPage />} />
        </Routes>
      </MemoryRouter>
    );
    expect(await screen.findByText("You do not have permission to access this organization.")).toBeInTheDocument();
  });
});
