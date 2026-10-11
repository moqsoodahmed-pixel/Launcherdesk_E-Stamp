import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import SuperAdminDashboard from "./SuperAdminDashboard";
import AssistantDashboard from "./AssistantDashboard";
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
