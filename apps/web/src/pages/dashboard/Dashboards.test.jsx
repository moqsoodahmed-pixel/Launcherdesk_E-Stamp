import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import SuperAdminDashboard from "./SuperAdminDashboard";
import AssistantDashboard from "./AssistantDashboard";
import AdminDashboard from "./AdminDashboard";
import UserDashboard from "./UserDashboard";
import DashboardPage from "./DashboardPage";
import { apiClient } from "../../api/client";

vi.mock("../../api/client", () => ({ apiClient: { get: vi.fn() } }));
let mockUser;
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: mockUser }) }));
// Recharts needs real layout; render chart children as nothing in jsdom.
vi.mock("recharts", async (orig) => {
  const actual = await orig();
  return { ...actual, ResponsiveContainer: () => null };
});

const SUMMARY = { requests: { total: 3, byStatus: {} }, orders: { total: 2, issued: 1, processing: 1, failed: 0 }, financial: null, organizations: null };
const ok = (data) => Promise.resolve({ data: { data } });
const fail = (message) => Promise.reject({ response: { status: 500, data: { message } } });

const renderIt = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  mockUser = {
    name: "Jeevan",
    role: "SUPER_ADMIN",
    permissions: ["estamp.create", "estamp.bulk_create", "user.view", "report.view", "report.financial_view"],
  };
});

describe("SuperAdminDashboard", () => {
  it("a failing panel shows its own error + Retry while the other panels still render", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const u = userEvent.setup();
    let activityFails = true;
    apiClient.get.mockImplementation((url) => {
      if (url === "/reports/dashboard") return ok(SUMMARY);
      if (url === "/reports/requests") return ok({ dailyTrend: [] });
      if (url === "/reports/financial") return ok({ payments: {}, wallet: { currentBalance: 500 } });
      if (url === "/reports/recent-activity") return activityFails ? fail("Activity down") : ok({ requests: [], orders: [] });
      return ok({});
    });
    renderIt(<SuperAdminDashboard />);
    expect((await screen.findAllByText("Activity down")).length).toBeGreaterThan(0);
    expect(screen.queryByText("Failed to load summary.")).not.toBeInTheDocument();
    activityFails = false;
    await u.click(screen.getAllByRole("button", { name: "Retry" })[0]);
    await waitFor(() => expect(screen.queryByText("Activity down")).not.toBeInTheDocument());
  });

  it("only shows quick-action tiles the user has permission for", async () => {
    mockUser = { ...mockUser, permissions: ["report.view"] };
    apiClient.get.mockImplementation((url) => (url === "/reports/dashboard" ? ok(SUMMARY) : ok({ dailyTrend: [], requests: [], orders: [] })));
    renderIt(<SuperAdminDashboard />);
    expect(await screen.findByText("Full Reports")).toBeInTheDocument();
    expect(screen.queryByText("New E-Stamp Request")).not.toBeInTheDocument();
    expect(screen.queryByText("Bulk Request")).not.toBeInTheDocument();
    expect(screen.queryByText("Manage Users")).not.toBeInTheDocument();
  });
});

// An ADMIN/USER created from Super Admin's "Add User" form must land on a
// real, working dashboard (not a blank page or a crash) - these two
// components previously had zero test coverage at all, which is exactly
// how a routing or permission regression here would go unnoticed.
describe("AdminDashboard - renders for an ADMIN created under a Super Admin's organization", () => {
  it("fetches its three data sources and renders the organization-scoped KPIs", async () => {
    mockUser = { name: "Priya", role: "ADMIN", permissions: ["estamp.create", "estamp.view", "estamp.bulk_create", "user.view", "report.view", "order.view"] };
    apiClient.get.mockImplementation((url) => {
      if (url === "/reports/dashboard") return ok(SUMMARY);
      if (url === "/reports/requests") return ok({ dailyTrend: [] });
      if (url === "/reports/recent-activity") return ok({ requests: [], orders: [] });
      return ok({});
    });
    renderIt(<AdminDashboard />);
    expect(await screen.findByText("Welcome back, Priya")).toBeInTheDocument();
    expect(await screen.findByText("Total requests")).toBeInTheDocument();
    // ADMIN never holds REPORT_FINANCIAL_VIEW by default - the financial KPI
    // must not appear even though /reports/dashboard succeeded.
    expect(screen.queryByText("Successful payments")).not.toBeInTheDocument();
    expect(await screen.findByText("New E-Stamp Request")).toBeInTheDocument();
  });

  it("a failing data source shows its own error without blanking the rest of the dashboard", async () => {
    mockUser = { name: "Priya", role: "ADMIN", permissions: ["estamp.view", "report.view", "order.view"] };
    apiClient.get.mockImplementation((url) => {
      if (url === "/reports/dashboard") return ok(SUMMARY);
      if (url === "/reports/requests") return fail("Request analytics down");
      if (url === "/reports/recent-activity") return ok({ requests: [], orders: [] });
      return ok({});
    });
    renderIt(<AdminDashboard />);
    expect(await screen.findByText("Request analytics down")).toBeInTheDocument();
    expect(await screen.findByText("Total requests")).toBeInTheDocument();
  });
});

describe("UserDashboard - renders for a USER created under a Super Admin's organization", () => {
  it("fetches only the endpoints USER has permission for and renders its own activity", async () => {
    mockUser = { name: "Rohit", role: "USER", permissions: ["estamp.create", "estamp.view", "order.view"] };
    apiClient.get.mockImplementation((url) => {
      if (url === "/estamps") return ok({ total: 2, items: [] });
      if (url === "/orders") return ok({ total: 1, items: [] });
      return ok({});
    });
    renderIt(<UserDashboard />);
    expect(await screen.findByText("Welcome back, Rohit")).toBeInTheDocument();
    expect(await screen.findByText("My requests")).toBeInTheDocument();
    expect(await screen.findByText("Orders")).toBeInTheDocument();
    // USER never holds REPORT_VIEW by default - must never call /reports/*.
    expect(apiClient.get.mock.calls.some(([url]) => url.startsWith("/reports"))).toBe(false);
  });

  it("renders without its own Orders section when USER lacks ORDER_VIEW", async () => {
    mockUser = { name: "Rohit", role: "USER", permissions: ["estamp.view"] };
    apiClient.get.mockImplementation((url) => (url === "/estamps" ? ok({ total: 0, items: [] }) : ok({})));
    renderIt(<UserDashboard />);
    expect(await screen.findByText("Welcome back, Rohit")).toBeInTheDocument();
    expect(screen.queryByText("Orders")).not.toBeInTheDocument();
    expect(apiClient.get.mock.calls.some(([url]) => url === "/orders")).toBe(false);
  });
});

describe("DashboardPage - role dispatch", () => {
  it("routes ADMIN to AdminDashboard and USER to UserDashboard, not a blank fallback", async () => {
    apiClient.get.mockImplementation((url) => ok(url === "/reports/dashboard" ? SUMMARY : {}));

    mockUser = { name: "Priya", role: "ADMIN", permissions: ["report.view"] };
    const { unmount } = renderIt(<DashboardPage />);
    expect(await screen.findByText("Organization overview")).toBeInTheDocument();
    unmount();

    mockUser = { name: "Rohit", role: "USER", permissions: ["estamp.view"] };
    renderIt(<DashboardPage />);
    expect(await screen.findByText("Your E-Stamping activity")).toBeInTheDocument();
  });
});

describe("AssistantDashboard - organization id filter", () => {
  it("waits for a complete organization id before requesting reports", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const u = userEvent.setup();
    mockUser = { name: "Asha", role: "ASSISTANT_MASTER_ADMIN", permissions: ["report.view"] };
    apiClient.get.mockImplementation(() => ok(SUMMARY));
    renderIt(<AssistantDashboard />);
    const input = await screen.findByLabelText("Organization ID");
    await u.type(input, "507f1f77");
    expect(await screen.findByText("Enter the full 24-character organization ID.")).toBeInTheDocument();
    expect(apiClient.get.mock.calls.filter(([url]) => url.startsWith("/reports"))).toHaveLength(0);
    await u.type(input, "bcf86cd799439011");
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/reports/dashboard", { params: { organizationId: "507f1f77bcf86cd799439011" } }));
  });
});
