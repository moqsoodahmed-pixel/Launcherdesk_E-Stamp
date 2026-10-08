import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import GlobalSearch from "./GlobalSearch";
import { apiClient } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { PERMISSIONS } from "../utils/permissions";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});
vi.mock("../api/client", () => ({
  apiClient: { get: vi.fn() },
}));
vi.mock("../context/AuthContext", () => ({
  useAuth: vi.fn(),
}));

function masterAdmin() {
  // /auth/me already returns the resolved EFFECTIVE permission set (see
  // utils/permissions.js's header note) - for a real Master Admin that is
  // every permission, never an empty array.
  return { role: "MASTER_ADMIN", permissions: Object.values(PERMISSIONS) };
}
function tenantNoPerms() {
  return { role: "USER", permissions: [] };
}
function tenantWithOrders() {
  return { role: "SUPER_ADMIN", organizationId: "org1", permissions: ["order.view"] };
}

function renderSearch() {
  return render(
    <MemoryRouter>
      <GlobalSearch />
    </MemoryRouter>
  );
}

function page(items = []) {
  return Promise.resolve({ data: { data: { items, total: items.length } } });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GlobalSearch - permission gating", () => {
  it("renders nothing for a user with none of the five view permissions", () => {
    useAuth.mockReturnValue({ user: tenantNoPerms() });
    const { container } = renderSearch();
    expect(container.firstChild).toBeNull();
  });

  it("only queries the one endpoint the actor actually holds permission for", async () => {
    useAuth.mockReturnValue({ user: tenantWithOrders() });
    apiClient.get.mockResolvedValue(page([]));
    renderSearch();

    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });
    await user.type(screen.getByRole("searchbox"), "ab");
    vi.advanceTimersByTime(400);

    await vi.waitFor(() => expect(apiClient.get).toHaveBeenCalled());
    expect(apiClient.get).toHaveBeenCalledTimes(1);
    expect(apiClient.get).toHaveBeenCalledWith("/orders", expect.objectContaining({ params: expect.objectContaining({ search: "ab" }) }));
  });
});

describe("GlobalSearch - query behavior", () => {
  it("does not search below the minimum query length", async () => {
    useAuth.mockReturnValue({ user: masterAdmin() });
    apiClient.get.mockResolvedValue(page([]));
    renderSearch();

    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });
    await user.type(screen.getByRole("searchbox"), "a");
    vi.advanceTimersByTime(500);
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it("debounces - does not fire on every keystroke", async () => {
    useAuth.mockReturnValue({ user: masterAdmin() });
    apiClient.get.mockResolvedValue(page([]));
    renderSearch();

    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });
    await user.type(screen.getByRole("searchbox"), "acme");
    // Before the debounce window elapses, nothing fired yet.
    expect(apiClient.get).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    await vi.waitFor(() => expect(apiClient.get).toHaveBeenCalled());
    // One settled search round per permitted group, not one per keystroke.
    const callsForOrgs = apiClient.get.mock.calls.filter((c) => c[0] === "/organizations");
    expect(callsForOrgs.length).toBe(1);
  });

  it("shows a loading state while searching", async () => {
    useAuth.mockReturnValue({ user: masterAdmin() });
    let resolvers = [];
    apiClient.get.mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)));
    renderSearch();

    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });
    await user.type(screen.getByRole("searchbox"), "acme");
    vi.advanceTimersByTime(400);

    expect(await screen.findByText("Searching...")).toBeInTheDocument();
    resolvers.forEach((r) => r({ data: { data: { items: [] } } }));
  });

  it('shows "No results" when every permitted group returns empty', async () => {
    useAuth.mockReturnValue({ user: masterAdmin() });
    apiClient.get.mockResolvedValue(page([]));
    renderSearch();

    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });
    await user.type(screen.getByRole("searchbox"), "zzz");
    vi.advanceTimersByTime(400);
    // Flush the pending Promise.allSettled().then() microtask chain before
    // asserting - under fake timers, a bare findByText can race ahead of it.
    await vi.waitFor(() => expect(apiClient.get).toHaveBeenCalled());

    expect(await screen.findByText('No results for "zzz".')).toBeInTheDocument();
  });

  it("isolates one failing group's error from the rest - a failed group yields no results for it, others still render", async () => {
    useAuth.mockReturnValue({ user: masterAdmin() });
    apiClient.get.mockImplementation((url) => {
      if (url === "/organizations") return Promise.reject(new Error("boom"));
      if (url === "/users") return page([{ _id: "u1", name: "Acme User", email: "u@acme.test" }]);
      return page([]);
    });
    renderSearch();

    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });
    await user.type(screen.getByRole("searchbox"), "acme");
    vi.advanceTimersByTime(400);

    expect(await screen.findByText("Acme User")).toBeInTheDocument();
  });
});

describe("GlobalSearch - grouped results and navigation", () => {
  it("renders grouped results with a primary and secondary field, and navigates to the real detail route on click", async () => {
    useAuth.mockReturnValue({ user: masterAdmin() });
    apiClient.get.mockImplementation((url) => {
      if (url === "/organizations") return page([{ _id: "o1", name: "Acme Corp", contactEmail: "contact@acme.test" }]);
      return page([]);
    });
    renderSearch();

    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });
    await user.type(screen.getByRole("searchbox"), "acme");
    vi.advanceTimersByTime(400);

    expect(await screen.findByText("Organizations")).toBeInTheDocument();
    expect(screen.getByText("Acme Corp")).toBeInTheDocument();
    expect(screen.getByText("contact@acme.test")).toBeInTheDocument();

    await user.click(screen.getByText("Acme Corp"));
    expect(mockNavigate).toHaveBeenCalledWith("/organizations/o1");
  });

  it("navigates an E-Stamp Request result to its real detail route (/estamps/requests/:id, not the /estamps list endpoint path)", async () => {
    useAuth.mockReturnValue({ user: masterAdmin() });
    apiClient.get.mockImplementation((url) => (url === "/estamps" ? page([{ _id: "r1", requestNumber: "REQ-100", stateCode: "KA" }]) : page([])));
    renderSearch();

    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });
    await user.type(screen.getByRole("searchbox"), "re100");
    vi.advanceTimersByTime(400);

    await user.click(await screen.findByText("REQ-100"));
    expect(mockNavigate).toHaveBeenCalledWith("/estamps/requests/r1");
  });

  it("navigates an Order result to its real detail route", async () => {
    useAuth.mockReturnValue({ user: masterAdmin() });
    apiClient.get.mockImplementation((url) => (url === "/orders" ? page([{ _id: "ord1", orderNumber: "ORD-200", eStampStatus: "ISSUED" }]) : page([])));
    renderSearch();

    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });
    await user.type(screen.getByRole("searchbox"), "ord200");
    vi.advanceTimersByTime(400);

    await user.click(await screen.findByText("ORD-200"));
    expect(mockNavigate).toHaveBeenCalledWith("/orders/ord1");
  });

  it("navigates a Payment result to its real detail route", async () => {
    useAuth.mockReturnValue({ user: masterAdmin() });
    apiClient.get.mockImplementation((url) => (url === "/payments" ? page([{ _id: "p1", razorpayOrderId: "order_abc", status: "SUCCESS" }]) : page([])));
    renderSearch();

    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });
    await user.type(screen.getByRole("searchbox"), "order_abc");
    vi.advanceTimersByTime(400);

    await user.click(await screen.findByText("order_abc"));
    expect(mockNavigate).toHaveBeenCalledWith("/payments/p1");
  });
});

describe("GlobalSearch - close behavior", () => {
  it("closes the result panel on Escape", async () => {
    useAuth.mockReturnValue({ user: masterAdmin() });
    apiClient.get.mockImplementation((url) => (url === "/organizations" ? page([{ _id: "o1", name: "Acme Corp", contactEmail: "c@acme.test" }]) : page([])));
    renderSearch();

    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });
    const input = screen.getByRole("searchbox");
    await user.type(input, "acme");
    vi.advanceTimersByTime(400);
    await screen.findByText("Acme Corp");

    await user.type(input, "{Escape}");
    expect(screen.queryByText("Acme Corp")).not.toBeInTheDocument();
  });

  it("closes the result panel when clicking outside", async () => {
    useAuth.mockReturnValue({ user: masterAdmin() });
    apiClient.get.mockImplementation((url) => (url === "/organizations" ? page([{ _id: "o1", name: "Acme Corp", contactEmail: "c@acme.test" }]) : page([])));
    render(
      <MemoryRouter>
        <div>
          <GlobalSearch />
          <button>Outside</button>
        </div>
      </MemoryRouter>
    );

    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });
    await user.type(screen.getByRole("searchbox"), "acme");
    vi.advanceTimersByTime(400);
    await screen.findByText("Acme Corp");

    await user.click(screen.getByText("Outside"));
    expect(screen.queryByText("Acme Corp")).not.toBeInTheDocument();
  });
});
