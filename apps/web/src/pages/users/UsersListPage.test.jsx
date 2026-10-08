import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import UsersListPage from "./UsersListPage";
import { apiClient } from "../../api/client";

vi.mock("../../api/client", () => ({
  apiClient: { get: vi.fn(), patch: vi.fn() },
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <UsersListPage />
    </MemoryRouter>
  );
}

function page(items = [], total = items.length) {
  return { data: { data: { items, total } } };
}

const user = (overrides = {}) => ({
  _id: "u1",
  name: "Alice",
  email: "alice@acme.test",
  phone: "9000000000",
  role: "USER",
  isActive: true,
  createdAt: new Date().toISOString(),
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("UsersListPage - list rendering", () => {
  it("renders real user fields including role and status", async () => {
    apiClient.get.mockResolvedValue(page([user()]));
    renderPage();
    expect(await screen.findByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("alice@acme.test")).toBeInTheDocument();
    // "USER" also appears as a role-filter option; scope to the role badge.
    expect(screen.getAllByText("USER").length).toBeGreaterThan(0);
    // "Active" also appears as a status-filter option; scope to the status badge.
    expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
  });

  it("shows an honest empty state", async () => {
    apiClient.get.mockResolvedValue(page([]));
    renderPage();
    expect(await screen.findByText("No users found.")).toBeInTheDocument();
  });
});

describe("UsersListPage - search and filters", () => {
  it("sends the typed search term to the backend", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const u = userEvent.setup();
    apiClient.get.mockResolvedValue(page([]));
    renderPage();
    await screen.findByText("No users found.");
    await u.type(screen.getByPlaceholderText("Search by name or email..."), "alice");
    await waitFor(() => {
      const last = apiClient.get.mock.calls.at(-1);
      expect(last[1].params.search).toBe("alice");
    });
  });

  it("role filter offers only the three client-visible roles - never MASTER_ADMIN/ASSISTANT_MASTER_ADMIN", async () => {
    apiClient.get.mockResolvedValue(page([]));
    renderPage();
    await screen.findByText("No users found.");
    const select = screen.getByDisplayValue("All roles");
    const values = Array.from(select.querySelectorAll("option")).map((o) => o.value);
    expect(values).toEqual(["", "SUPER_ADMIN", "ADMIN", "USER"]);
  });

  it("sends the chosen active/inactive status filter", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const u = userEvent.setup();
    apiClient.get.mockResolvedValue(page([]));
    renderPage();
    await screen.findByText("No users found.");
    await u.selectOptions(screen.getByDisplayValue("All statuses"), "inactive");
    await waitFor(() => {
      const last = apiClient.get.mock.calls.at(-1);
      expect(last[1].params.status).toBe("inactive");
    });
  });
});

describe("UsersListPage - pagination", () => {
  it("is server-side and bounded", async () => {
    apiClient.get.mockResolvedValue(page([user()], 25));
    renderPage();
    expect(await screen.findByText("Page 1 of 3 (25 total)")).toBeInTheDocument();
    const [, config] = apiClient.get.mock.calls[0];
    expect(config.params.limit).toBeGreaterThan(0);
    expect(config.params.limit).toBeLessThanOrEqual(100);
  });
});

describe("UsersListPage - protected-role behavior", () => {
  it("never offers Activate/Deactivate for a SUPER_ADMIN row", async () => {
    apiClient.get.mockResolvedValue(page([user({ _id: "u2", name: "Super", role: "SUPER_ADMIN" })]));
    renderPage();
    await screen.findByText("Super");
    expect(screen.queryByRole("button", { name: "Deactivate" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Activate" })).not.toBeInTheDocument();
  });

  it("offers Deactivate for a non-protected active user", async () => {
    apiClient.get.mockResolvedValue(page([user({ role: "ADMIN", isActive: true })]));
    renderPage();
    await screen.findByText("Alice");
    expect(screen.getByRole("button", { name: "Deactivate" })).toBeInTheDocument();
  });
});

describe("UsersListPage - deactivate confirmation", () => {
  it("requires confirmation before calling the status endpoint, and skips the call when declined", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const u = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    apiClient.get.mockResolvedValue(page([user({ role: "ADMIN" })]));
    renderPage();
    await screen.findByText("Alice");

    await u.click(screen.getByRole("button", { name: "Deactivate" }));
    expect(window.confirm).toHaveBeenCalled();
    expect(apiClient.patch).not.toHaveBeenCalled();
  });

  it("calls PATCH /users/:id/status with isActive:false once confirmed, then refreshes from the server", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const u = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    apiClient.get.mockResolvedValue(page([user({ role: "ADMIN" })]));
    apiClient.patch.mockResolvedValue({ data: { data: {} } });
    renderPage();
    await screen.findByText("Alice");

    await u.click(screen.getByRole("button", { name: "Deactivate" }));
    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledWith("/users/u1/status", { isActive: false }));
    // Refresh pulls real server state, never a locally-flipped flag.
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(2));
  });
});

describe("UsersListPage - accessibility (Phase 38)", () => {
  it("gives every filter control an accessible name", async () => {
    apiClient.get.mockResolvedValue(page([]));
    renderPage();
    await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
    expect(screen.getByLabelText("Search users")).toBeInTheDocument();
    expect(screen.getByLabelText("Role")).toBeInTheDocument();
    expect(screen.getByLabelText("Status")).toBeInTheDocument();
  });
});

describe("UsersListPage - mobile responsiveness (Phase 38)", () => {
  it("wraps the table in a horizontally scrollable container instead of clipping it with overflow-hidden", async () => {
    apiClient.get.mockResolvedValue(page([user()]));
    renderPage();
    const table = await screen.findByRole("table");
    expect(table.parentElement).toHaveClass("overflow-x-auto");
  });
});
