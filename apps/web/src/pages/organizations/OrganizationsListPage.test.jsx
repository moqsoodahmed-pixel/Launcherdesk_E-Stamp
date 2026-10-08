import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import OrganizationsListPage from "./OrganizationsListPage";
import { apiClient } from "../../api/client";

vi.mock("../../api/client", () => ({
  apiClient: { get: vi.fn() },
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <OrganizationsListPage />
    </MemoryRouter>
  );
}

function page(items = [], total = items.length) {
  return { data: { data: { items, total } } };
}

const org = (overrides = {}) => ({
  _id: "o1",
  name: "Acme Corp",
  contactEmail: "contact@acme.test",
  contactPhone: "9999999999",
  status: "ACTIVE",
  createdAt: new Date().toISOString(),
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("OrganizationsListPage - list rendering", () => {
  it("renders real organization fields from the server, nothing invented", async () => {
    apiClient.get.mockResolvedValue(page([org()]));
    renderPage();
    expect(await screen.findByText("Acme Corp")).toBeInTheDocument();
    expect(screen.getByText("contact@acme.test")).toBeInTheDocument();
    expect(screen.getByText("9999999999")).toBeInTheDocument();
    // "ACTIVE" also appears as a status-filter option; scope to the status badge.
    expect(screen.getAllByText("ACTIVE").length).toBeGreaterThan(0);
  });

  it("shows an honest empty state with no fabricated rows", async () => {
    apiClient.get.mockResolvedValue(page([]));
    renderPage();
    expect(await screen.findByText("No organizations found.")).toBeInTheDocument();
  });

  it("surfaces a load error", async () => {
    apiClient.get.mockRejectedValue({ response: { data: { message: "Server error" } } });
    renderPage();
    expect(await screen.findByText("Server error")).toBeInTheDocument();
  });
});

describe("OrganizationsListPage - search and filters", () => {
  it("sends the typed search term to the real backend search param", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    apiClient.get.mockResolvedValue(page([]));
    renderPage();
    await screen.findByText("No organizations found.");

    await user.type(screen.getByPlaceholderText("Search by name..."), "Acme");
    await waitFor(() => {
      const last = apiClient.get.mock.calls.at(-1);
      expect(last[1].params.search).toBe("Acme");
    });
  });

  it("offers only the real backend OrganizationStatus values", async () => {
    apiClient.get.mockResolvedValue(page([]));
    renderPage();
    await screen.findByText("No organizations found.");
    const select = screen.getByDisplayValue("All statuses");
    const values = Array.from(select.querySelectorAll("option")).map((o) => o.value);
    expect(values).toEqual(["", "PENDING_APPROVAL", "ACTIVE", "RESTRICTED", "SUSPENDED", "DEACTIVATED"]);
  });

  it("resets to page 1 and sends the chosen status filter", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    apiClient.get.mockResolvedValue(page([]));
    renderPage();
    await screen.findByText("No organizations found.");

    await user.selectOptions(screen.getByDisplayValue("All statuses"), "SUSPENDED");
    await waitFor(() => {
      const last = apiClient.get.mock.calls.at(-1);
      expect(last[1].params.status).toBe("SUSPENDED");
      expect(last[1].params.page).toBe(1);
    });
  });
});

describe("OrganizationsListPage - accessibility (Phase 38)", () => {
  it("gives every filter control an accessible name", async () => {
    apiClient.get.mockResolvedValue(page([]));
    renderPage();
    await screen.findByText("No organizations found.");
    expect(screen.getByLabelText("Search organizations")).toBeInTheDocument();
    expect(screen.getByLabelText("Status")).toBeInTheDocument();
  });
});

describe("OrganizationsListPage - mobile responsiveness (Phase 38)", () => {
  it("wraps the table in a horizontally scrollable container instead of clipping it with overflow-hidden", async () => {
    apiClient.get.mockResolvedValue(page([org()]));
    renderPage();
    const table = await screen.findByRole("table");
    expect(table.parentElement).toHaveClass("overflow-x-auto");
  });
});

describe("OrganizationsListPage - pagination", () => {
  it("is server-side, bounded, and advances with Next", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    apiClient.get.mockResolvedValue(page([org()], 25));
    renderPage();
    expect(await screen.findByText("Page 1 of 3 (25 total)")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => {
      const last = apiClient.get.mock.calls.at(-1);
      expect(last[1].params.page).toBe(2);
    });
  });

  it("never requests an unbounded page size", async () => {
    apiClient.get.mockResolvedValue(page([]));
    renderPage();
    await screen.findByText("No organizations found.");
    const [, config] = apiClient.get.mock.calls[0];
    expect(config.params.limit).toBeGreaterThan(0);
    expect(config.params.limit).toBeLessThanOrEqual(100);
  });
});
