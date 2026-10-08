import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PaymentsListPage from "./PaymentsListPage";
import { apiClient } from "../../api/client";
import { useAuth } from "../../context/AuthContext";

vi.mock("../../api/client", () => ({
  apiClient: { get: vi.fn() },
}));
vi.mock("../../context/AuthContext", () => ({
  useAuth: vi.fn(),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <PaymentsListPage />
    </MemoryRouter>
  );
}

function tenantUser(permissions = ["payment.view"]) {
  return { role: "SUPER_ADMIN", organizationId: "org-1", permissions };
}
function internalUser(permissions = ["payment.view"]) {
  return { role: "MASTER_ADMIN", permissions };
}

function emptyPage(total = 0) {
  return { data: { data: { items: [], total } } };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PaymentsListPage - status filter", () => {
  it("offers exactly the backend PaymentStatus enum values, nothing invented", async () => {
    useAuth.mockReturnValue({ user: tenantUser() });
    apiClient.get.mockResolvedValue(emptyPage());
    renderPage();
    await screen.findAllByText("No payments found");

    const select = screen.getByLabelText("Status");
    const values = Array.from(select.querySelectorAll("option")).map((o) => o.value);
    expect(values).toEqual(["", "CREATED", "SUCCESS", "FAILED", "REFUNDED"]);
  });
});

describe("PaymentsListPage - search", () => {
  it("debounces input and sends the typed value as the search param", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    useAuth.mockReturnValue({ user: tenantUser() });
    apiClient.get.mockResolvedValue(emptyPage());

    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });
    renderPage();

    const callsBefore = apiClient.get.mock.calls.length;
    await user.type(screen.getByLabelText("Search payments"), "order_abc");

    // Before the debounce window elapses, no new search-bearing call yet.
    expect(apiClient.get.mock.calls.length).toBe(callsBefore);

    vi.advanceTimersByTime(400);
    await vi.waitFor(() => {
      const last = apiClient.get.mock.calls.at(-1);
      expect(last[1].params.search).toBe("order_abc");
    });
    vi.useRealTimers();
  });
});

describe("PaymentsListPage - pagination", () => {
  it("shows page state and total, and Next/Previous call the API with the new page", async () => {
    useAuth.mockReturnValue({ user: tenantUser() });
    apiClient.get.mockImplementation((url, config) =>
      Promise.resolve({
        data: {
          data: {
            items: [{ _id: "p1", amount: 10, status: "SUCCESS", razorpayOrderId: "order_1", createdAt: new Date().toISOString() }],
            total: 45,
          },
        },
      })
    );

    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText("Page 1 of 3 (45 total)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => {
      const last = apiClient.get.mock.calls.at(-1);
      expect(last[1].params.page).toBe(2);
    });
  });

  it("never fetches an unbounded dataset - every request is paginated with a limit", async () => {
    useAuth.mockReturnValue({ user: tenantUser() });
    apiClient.get.mockResolvedValue(emptyPage());
    renderPage();
    await screen.findAllByText("No payments found");
    const [, config] = apiClient.get.mock.calls[0];
    expect(config.params.limit).toBeGreaterThan(0);
    expect(config.params.limit).toBeLessThanOrEqual(100);
  });
});

describe("PaymentsListPage - organization filter / tenant isolation", () => {
  it("shows the organization filter for internal actors", async () => {
    useAuth.mockReturnValue({ user: internalUser() });
    apiClient.get.mockImplementation((url) => {
      if (url === "/organizations") return Promise.resolve({ data: { data: { items: [{ _id: "o1", name: "Acme" }] } } });
      return Promise.resolve(emptyPage());
    });
    renderPage();
    expect(await screen.findByLabelText("Organization")).toBeInTheDocument();
  });

  it("hides the organization filter for tenant actors - they can never pick another org", async () => {
    useAuth.mockReturnValue({ user: tenantUser() });
    apiClient.get.mockResolvedValue(emptyPage());
    renderPage();
    await screen.findAllByText("No payments found");
    expect(screen.queryByLabelText("Organization")).not.toBeInTheDocument();
    // No tenant request ever includes an organizationId filter the user set.
    const last = apiClient.get.mock.calls.at(-1);
    expect(last[1].params.organizationId).toBeUndefined();
  });
});

describe("PaymentsListPage - access control", () => {
  it("shows a no-access message without payment.view, and never calls the payments API", () => {
    useAuth.mockReturnValue({ user: tenantUser([]) });
    renderPage();
    expect(screen.getByText("You do not currently have financial access.")).toBeInTheDocument();
    expect(apiClient.get).not.toHaveBeenCalled();
  });
});
