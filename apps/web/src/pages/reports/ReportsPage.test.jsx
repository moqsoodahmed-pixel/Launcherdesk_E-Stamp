import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import ReportsPage from "./ReportsPage";
import { apiClient } from "../../api/client";
import { useAuth } from "../../context/AuthContext";

vi.mock("../../api/client", () => ({
  apiClient: { get: vi.fn() },
}));
vi.mock("../../context/AuthContext", () => ({
  useAuth: vi.fn(),
}));

function masterAdmin() {
  return { role: "MASTER_ADMIN", permissions: [] };
}
function superAdmin(permissions = []) {
  return { role: "SUPER_ADMIN", organizationId: "org1", permissions };
}
function admin(permissions = []) {
  return { role: "ADMIN", organizationId: "org1", permissions };
}
function assistant(permissions = []) {
  return { role: "ASSISTANT_MASTER_ADMIN", permissions };
}

const dashboardData = (overrides = {}) => ({
  requests: { total: 10, byStatus: [] },
  orders: { total: 8, issued: 6, processing: 1, failed: 1 },
  financial: null,
  organizations: null,
  ...overrides,
});

const ordersData = (overrides = {}) => ({
  totals: { totalOrders: 8, issued: 6, processing: 1, failed: 1 },
  issuanceSuccessRate: 0.857,
  retryStats: { avg: 0.2, max: 2 },
  timing: { createdToIssuedSeconds: { avgSeconds: 120, sampleSize: 6 } },
  ...overrides,
});

const requestsData = (overrides = {}) => ({
  total: 10,
  dailyTrend: [],
  statusDistribution: [],
  stateDistribution: [],
  cancellationRate: 0.1,
  modificationRate: 0.05,
  ...overrides,
});

const bulkData = (overrides = {}) => ({
  statusDistribution: [],
  totals: { batchCount: 0, totalRows: 0, validRows: 0, invalidRows: 0, createdRequests: 0, failedRows: 0, totalStampDuty: 0 },
  ...overrides,
});

function mockRoutes(routes) {
  apiClient.get.mockImplementation((url) => {
    for (const [pattern, result] of routes) {
      if (pattern.test(url)) {
        return result.ok ? Promise.resolve({ data: { data: result.data } }) : Promise.reject(result.error);
      }
    }
    return Promise.reject(new Error(`Unhandled GET ${url}`));
  });
}

function defaultRoutes(overrides = {}) {
  const base = {
    dashboard: [/\/reports\/dashboard/, { ok: true, data: dashboardData() }],
    requests: [/\/reports\/requests/, { ok: true, data: requestsData() }],
    orders: [/\/reports\/orders/, { ok: true, data: ordersData() }],
    bulk: [/\/reports\/bulk/, { ok: true, data: bulkData() }],
    // Fetched only for roles that pass the relevant permission gate - a
    // harmless default stub so tests not exercising these sections never
    // hit an "unhandled route" rejection just because the actor happens to
    // be a Master Admin (who passes every gate).
    financial: [
      /\/reports\/financial/,
      { ok: true, data: { payments: { successfulAmount: 0, successfulCount: 0, failedAmount: 0, failedCount: 0 }, wallet: { currentBalance: 0 }, walletTransactions: { totalCredits: 0, totalDebits: 0, creditCount: 0, debitCount: 0 }, requestValue: { totalCalculatedStampDuty: 0, count: 0 } } },
    ],
    organizations: [/\/reports\/organizations/, { ok: true, data: { items: [], total: 0 } }],
    provider: [/\/reports\/provider/, { ok: true, data: { current: { status: "NOT_CONFIGURED", available: null, fetchedAt: null }, history: [] } }],
  };
  return Object.values({ ...base, ...overrides });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ReportsPage - dashboard KPIs", () => {
  it("renders real KPI values from the server", async () => {
    useAuth.mockReturnValue({ user: masterAdmin() });
    mockRoutes(defaultRoutes());
    render(<ReportsPage />);
    expect((await screen.findAllByText("Total requests")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("10").length).toBeGreaterThan(0);
  });

  it("shows a loading state before data arrives", async () => {
    useAuth.mockReturnValue({ user: masterAdmin() });
    let resolveDashboard;
    apiClient.get.mockImplementation((url) => {
      if (/\/reports\/dashboard/.test(url)) return new Promise((r) => (resolveDashboard = r));
      return Promise.resolve({ data: { data: requestsData() } });
    });
    render(<ReportsPage />);
    expect(screen.getByText("Loading reports...")).toBeInTheDocument();
    resolveDashboard({ data: { data: dashboardData() } });
  });

  it("shows a per-section error without blanking the rest of the page", async () => {
    useAuth.mockReturnValue({ user: masterAdmin() });
    mockRoutes(defaultRoutes({ dashboard: [/\/reports\/dashboard/, { ok: false, error: { response: { status: 500 }, message: "boom" } }] }));
    render(<ReportsPage />);
    expect(await screen.findByText("Failed to load dashboard summary.")).toBeInTheDocument();
    // Requests section still rendered independently.
    expect(screen.getByText("Order processing")).toBeInTheDocument();
  });

  it("shows a 403-specific message without leaking details", async () => {
    useAuth.mockReturnValue({ user: masterAdmin() });
    mockRoutes(defaultRoutes({ dashboard: [/\/reports\/dashboard/, { ok: false, error: { response: { status: 403 } } }] }));
    render(<ReportsPage />);
    expect(await screen.findByText("You do not have permission to view this.")).toBeInTheDocument();
  });
});

describe("ReportsPage - financial section: gate-then-fetch, never fake data", () => {
  it("never calls /reports/financial for a role without REPORT_FINANCIAL_VIEW", async () => {
    useAuth.mockReturnValue({ user: admin([]) });
    mockRoutes(defaultRoutes());
    render(<ReportsPage />);
    await screen.findAllByText("Total requests");
    expect(apiClient.get).not.toHaveBeenCalledWith("/reports/financial", expect.anything());
    expect(screen.queryByText("Financial")).not.toBeInTheDocument();
  });

  it("fetches and renders real financial totals for a role with REPORT_FINANCIAL_VIEW, never computed client-side", async () => {
    useAuth.mockReturnValue({ user: superAdmin() }); // SUPER_ADMIN has financial:true by default
    mockRoutes(
      defaultRoutes({
        financial: [
          /\/reports\/financial/,
          {
            ok: true,
            data: {
              payments: { successfulAmount: 50000, successfulCount: 5, failedAmount: 0, failedCount: 1 },
              wallet: { currentBalance: 12000 },
              walletTransactions: { totalCredits: 44000, totalDebits: 10000, creditCount: 5, debitCount: 2 },
              requestValue: { totalCalculatedStampDuty: 8000, count: 10 },
            },
          },
        ],
      })
    );
    render(<ReportsPage />);
    expect(await screen.findByText("Financial")).toBeInTheDocument();
    expect(screen.getByText("₹50,000")).toBeInTheDocument();
    expect(screen.getByText("₹12,000")).toBeInTheDocument();
  });

  it("shows an error instead of a fake zero when financial fails to load", async () => {
    useAuth.mockReturnValue({ user: superAdmin() });
    mockRoutes(defaultRoutes({ financial: [/\/reports\/financial/, { ok: false, error: { response: { status: 500 }, message: "db down" } }] }));
    render(<ReportsPage />);
    expect(await screen.findByText("Failed to load financial report.")).toBeInTheDocument();
    expect(screen.queryByText("₹0")).not.toBeInTheDocument();
  });
});

describe("ReportsPage - provider section: gate-then-fetch", () => {
  it("never calls /reports/provider for a role without ESTAMP_PROVIDER_VIEW", async () => {
    useAuth.mockReturnValue({ user: superAdmin() }); // SUPER_ADMIN lacks provider view by default
    mockRoutes(defaultRoutes());
    render(<ReportsPage />);
    await screen.findAllByText("Total requests");
    expect(apiClient.get).not.toHaveBeenCalledWith("/reports/provider", expect.anything());
    expect(screen.queryByText("E-Stamp Provider")).not.toBeInTheDocument();
  });

  it("renders the honest not-configured state rather than fabricating a balance", async () => {
    useAuth.mockReturnValue({ user: masterAdmin() });
    mockRoutes(
      defaultRoutes({
        provider: [/\/reports\/provider/, { ok: true, data: { current: { status: "NOT_CONFIGURED", available: null, fetchedAt: null }, history: [] } }],
      })
    );
    render(<ReportsPage />);
    expect(await screen.findByText("E-Stamp Provider")).toBeInTheDocument();
    expect(screen.getByText("Real E-Stamp provider is not configured. Balance unavailable.")).toBeInTheDocument();
  });

  it("renders real mock-labeled balance data when available", async () => {
    useAuth.mockReturnValue({ user: masterAdmin() });
    mockRoutes(
      defaultRoutes({
        provider: [
          /\/reports\/provider/,
          { ok: true, data: { current: { status: "AVAILABLE", available: 99999, unit: "stamps", source: "mock", fetchedAt: new Date().toISOString() }, history: [{}, {}] } },
        ],
      })
    );
    render(<ReportsPage />);
    expect(await screen.findByText("Mock (dev/test)")).toBeInTheDocument();
    expect(screen.getByText("99,999 stamps")).toBeInTheDocument();
  });
});

describe("ReportsPage - bulk E-Stamp section", () => {
  it("renders real bulk totals when batches exist", async () => {
    useAuth.mockReturnValue({ user: masterAdmin() });
    mockRoutes(
      defaultRoutes({
        bulk: [
          /\/reports\/bulk/,
          { ok: true, data: { statusDistribution: [], totals: { batchCount: 3, totalRows: 100, validRows: 90, invalidRows: 5, createdRequests: 90, failedRows: 5, totalStampDuty: 15000 } } },
        ],
      })
    );
    render(<ReportsPage />);
    expect(await screen.findByText("Bulk E-Stamp")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("₹15,000")).toBeInTheDocument();
  });

  it("shows an honest empty state with zero batches, not fabricated figures", async () => {
    useAuth.mockReturnValue({ user: masterAdmin() });
    mockRoutes(defaultRoutes());
    render(<ReportsPage />);
    expect(await screen.findByText("No bulk batches in this range.")).toBeInTheDocument();
  });
});

describe("ReportsPage - organizations section (REPORT_GLOBAL_VIEW)", () => {
  it("never calls /reports/organizations without REPORT_GLOBAL_VIEW", async () => {
    useAuth.mockReturnValue({ user: superAdmin() });
    mockRoutes(defaultRoutes());
    render(<ReportsPage />);
    await screen.findAllByText("Total requests");
    expect(apiClient.get).not.toHaveBeenCalledWith("/reports/organizations", expect.anything());
  });

  it("renders the organizations table for a global caller", async () => {
    useAuth.mockReturnValue({ user: masterAdmin() });
    mockRoutes(
      defaultRoutes({
        organizations: [/\/reports\/organizations/, { ok: true, data: { items: [{ _id: "o1", name: "Acme", status: "ACTIVE", requestCount: 5, orderCount: 4, walletBalance: 3000 }], total: 1 } }],
      })
    );
    render(<ReportsPage />);
    expect(await screen.findByText("Acme")).toBeInTheDocument();
  });
});

describe("ReportsPage - Assistant Master Admin organization-required scope", () => {
  it("short-circuits and fetches nothing until an organization id is supplied", async () => {
    useAuth.mockReturnValue({ user: assistant(["report.view"]) });
    mockRoutes(defaultRoutes());
    render(<ReportsPage />);
    expect(screen.getByText(/You do not hold platform-wide report access/)).toBeInTheDocument();
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it("loads scoped reports once an organization id is entered", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    useAuth.mockReturnValue({ user: assistant(["report.view"]) });
    mockRoutes(defaultRoutes());
    render(<ReportsPage />);

    await user.type(screen.getByPlaceholderText("Organization ID (required)"), "org-xyz");
    await waitFor(() => {
      const calls = apiClient.get.mock.calls.filter((c) => c[0] === "/reports/dashboard");
      expect(calls.at(-1)[1].params.organizationId).toBe("org-xyz");
    });
  });
});

describe("ReportsPage - date range", () => {
  it("sends the chosen preset to every date-scoped endpoint", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    useAuth.mockReturnValue({ user: masterAdmin() });
    mockRoutes(defaultRoutes());
    render(<ReportsPage />);
    await screen.findAllByText("Total requests");

    await user.selectOptions(screen.getByDisplayValue("Last 30 days"), "last7days");
    await waitFor(() => {
      const calls = apiClient.get.mock.calls.filter((c) => c[0] === "/reports/requests");
      expect(calls.at(-1)[1].params.preset).toBe("last7days");
    });
  });

  it("surfaces the backend's real validation error for an oversized custom range rather than silently substituting one", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    useAuth.mockReturnValue({ user: masterAdmin() });
    mockRoutes(
      defaultRoutes({
        requests: [/\/reports\/requests/, { ok: false, error: { response: { status: 400, data: { message: "Date range exceeds the maximum allowed." } } } }],
      })
    );
    render(<ReportsPage />);
    await screen.findAllByText("Total requests");
    await user.selectOptions(screen.getByDisplayValue("Last 30 days"), "custom");
    expect((await screen.findAllByText("Date range exceeds the maximum allowed.")).length).toBeGreaterThan(0);
  });
});
