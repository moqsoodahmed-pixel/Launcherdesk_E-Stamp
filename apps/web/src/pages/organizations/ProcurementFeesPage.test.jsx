import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ProcurementFeesPage from "./ProcurementFeesPage";
import { apiClient } from "../../api/client";

vi.mock("../../api/client", () => ({
  apiClient: { get: vi.fn(), patch: vi.fn() },
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <ProcurementFeesPage />
    </MemoryRouter>
  );
}

function page(items = [], total = items.length) {
  return { data: { data: { items, total } } };
}

const org = (overrides = {}) => ({
  _id: "o1",
  name: "Acme Corp",
  procurementFeeOverride: null,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ProcurementFeesPage - listing", () => {
  it("shows 'Platform default' for an organization with no override", async () => {
    apiClient.get.mockResolvedValue(page([org()]));
    renderPage();
    expect(await screen.findByText("Acme Corp")).toBeInTheDocument();
    expect(screen.getByText("Platform default")).toBeInTheDocument();
  });

  it("shows the override amount with an '(override)' tag when one is set", async () => {
    apiClient.get.mockResolvedValue(page([org({ procurementFeeOverride: 40 })]));
    renderPage();
    await screen.findByText("Acme Corp");
    expect(screen.getByText("₹40")).toBeInTheDocument();
    expect(screen.getByText("(override)")).toBeInTheDocument();
  });

  it("searches organizations by name via the real endpoint", async () => {
    apiClient.get.mockResolvedValue(page([]));
    renderPage();
    await screen.findByText("No organizations found.");
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Search organizations"), "Acme");
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/organizations", expect.objectContaining({ params: expect.objectContaining({ search: "Acme" }) })));
  });
});

describe("ProcurementFeesPage - saving an override", () => {
  it("saves a new override via the real endpoint", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    apiClient.get.mockResolvedValue(page([org()]));
    apiClient.patch.mockResolvedValue({ data: { data: {} } });
    renderPage();
    await screen.findByText("Acme Corp");

    const input = screen.getByLabelText("Procurement fee override for Acme Corp");
    await user.type(input, "25");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledWith("/organizations/o1/procurement-fee", { procurementFee: 25 }));
    expect(await screen.findByText(/Acme Corp.*procurement fee set to.*₹25/)).toBeInTheDocument();
  });

  it("Clear reverts the organization to the platform default", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    apiClient.get.mockResolvedValue(page([org({ procurementFeeOverride: 25 })]));
    apiClient.patch.mockResolvedValue({ data: { data: {} } });
    renderPage();
    await screen.findByText("Acme Corp");

    await user.click(screen.getByRole("button", { name: "Clear" }));
    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledWith("/organizations/o1/procurement-fee", { procurementFee: null }));
  });

  it("shows a row-level error and never calls the API for a negative value", async () => {
    const { fireEvent } = await import("@testing-library/react");
    apiClient.get.mockResolvedValue(page([org()]));
    renderPage();
    await screen.findByText("Acme Corp");

    const input = screen.getByLabelText("Procurement fee override for Acme Corp");
    fireEvent.change(input, { target: { value: "-5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText(/non-negative number/)).toBeInTheDocument();
    expect(apiClient.patch).not.toHaveBeenCalled();
  });

  it("each row's draft is independent - editing one organization never touches another's value", async () => {
    apiClient.get.mockResolvedValue(page([org({ _id: "o1", name: "Acme Corp" }), org({ _id: "o2", name: "Beta Inc", procurementFeeOverride: 10 })]));
    renderPage();
    await screen.findByText("Acme Corp");

    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Procurement fee override for Acme Corp"), "99");

    expect(screen.getByLabelText("Procurement fee override for Acme Corp")).toHaveValue(99);
    expect(screen.getByLabelText("Procurement fee override for Beta Inc")).toHaveValue(10);
  });
});
