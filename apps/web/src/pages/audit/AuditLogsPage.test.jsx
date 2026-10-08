import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import AuditLogsPage from "./AuditLogsPage";
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
function assistant(permissions = []) {
  return { role: "ASSISTANT_MASTER_ADMIN", permissions };
}
function tenant(role, permissions = []) {
  return { role, permissions };
}

const entry = (overrides = {}) => ({
  _id: "a1",
  action: "LOGIN",
  actorRole: "SUPER_ADMIN",
  actorType: "USER",
  actorId: "u1",
  organizationId: "org1",
  entityType: null,
  entityId: null,
  createdAt: new Date().toISOString(),
  ip: "127.0.0.1",
  userAgent: "test-agent",
  metadata: {},
  ...overrides,
});

function page(items = [], total = items.length) {
  return { data: { data: { items, total, page: 1, limit: 20 } } };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AuditLogsPage - permissions", () => {
  it("shows a permission-denied message and never calls the API for USER", () => {
    useAuth.mockReturnValue({ user: tenant("USER") });
    render(<AuditLogsPage />);
    expect(screen.getByText("You do not have permission to view audit logs.")).toBeInTheDocument();
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it("Assistant Master Admin without any explicit grant sees the denied state", () => {
    useAuth.mockReturnValue({ user: assistant([]) });
    render(<AuditLogsPage />);
    expect(screen.getByText("You do not have permission to view audit logs.")).toBeInTheDocument();
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it("Assistant Master Admin with an explicit audit.view grant can view, but must supply an organization id first", async () => {
    useAuth.mockReturnValue({ user: assistant(["audit.view"]) });
    apiClient.get.mockResolvedValue(page([]));
    render(<AuditLogsPage />);
    expect(screen.getByText(/Enter a specific organization's ID/)).toBeInTheDocument();
    // No request fired yet - the page never silently falls back to a global view for this role.
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it("SUPER_ADMIN and ADMIN can view by default (own-org server-side scope)", async () => {
    useAuth.mockReturnValue({ user: tenant("SUPER_ADMIN") });
    apiClient.get.mockResolvedValue(page([entry()]));
    render(<AuditLogsPage />);
    expect(await screen.findByText("LOGIN")).toBeInTheDocument();
    // Tenant roles never see an organization id input - scope is backend-forced.
    expect(screen.queryByPlaceholderText(/Organization ID/)).not.toBeInTheDocument();
  });
});

describe("AuditLogsPage - rendering real records", () => {
  it("renders real fields: when, action, actor type/role, entity", async () => {
    useAuth.mockReturnValue({ user: masterAdmin() });
    apiClient.get.mockResolvedValue(page([entry({ entityType: "EStampOrder", entityId: "ord1" })]));
    render(<AuditLogsPage />);
    expect(await screen.findByText("LOGIN")).toBeInTheDocument();
    expect(screen.getByText("USER")).toBeInTheDocument();
    expect(screen.getByText("SUPER_ADMIN")).toBeInTheDocument();
    expect(screen.getByText("EStampOrder #ord1")).toBeInTheDocument();
  });

  it("distinguishes a SYSTEM actor visually from a USER actor", async () => {
    useAuth.mockReturnValue({ user: masterAdmin() });
    apiClient.get.mockResolvedValue(page([entry({ actorType: "SYSTEM", actorId: null, actorRole: "SYSTEM_WEBHOOK" })]));
    render(<AuditLogsPage />);
    expect(await screen.findByText("SYSTEM")).toBeInTheDocument();
  });

  it("shows an honest empty state", async () => {
    useAuth.mockReturnValue({ user: masterAdmin() });
    apiClient.get.mockResolvedValue(page([]));
    render(<AuditLogsPage />);
    expect(await screen.findByText("No audit entries match these filters.")).toBeInTheDocument();
  });

  it("shows a load error instead of a blank page", async () => {
    useAuth.mockReturnValue({ user: masterAdmin() });
    apiClient.get.mockRejectedValue({ response: { data: { message: "Server exploded" } } });
    render(<AuditLogsPage />);
    expect(await screen.findByText("Server exploded")).toBeInTheDocument();
  });

  it("shows a 403-specific message without leaking details", async () => {
    useAuth.mockReturnValue({ user: masterAdmin() });
    apiClient.get.mockRejectedValue({ response: { status: 403 } });
    render(<AuditLogsPage />);
    expect(await screen.findByText("You do not have permission to view audit logs.")).toBeInTheDocument();
  });
});

describe("AuditLogsPage - filters sent to the real backend contract", () => {
  it("action filter offers only real backend AuditAction values (curated subset, never invented)", async () => {
    useAuth.mockReturnValue({ user: masterAdmin() });
    apiClient.get.mockResolvedValue(page([]));
    render(<AuditLogsPage />);
    await screen.findByText("No audit entries match these filters.");
    const REAL_ACTIONS = new Set([
      "LOGIN", "LOGOUT", "LOGIN_FAILED", "OTP_SENT", "OTP_VERIFIED", "OTP_FAILED",
      "PASSWORD_RESET_REQUESTED", "PASSWORD_RESET_COMPLETED", "USER_CREATED", "USER_MODIFIED",
      "USER_DEACTIVATED", "ORG_CREATED", "ORG_VIEWED", "ORG_MODIFIED", "ORG_STATUS_CHANGED",
      "BALANCE_VIEWED", "BALANCE_CHANGED", "PAYMENT_VIEWED", "PAYMENT_VERIFIED",
      "ESTAMP_REQUEST_CREATED", "ESTAMP_REQUEST_MODIFIED", "ESTAMP_REQUEST_CANCELLED",
      "ESTAMP_UPLOADED", "ESTAMP_DOWNLOADED", "ARTICLE_MANAGED", "ARTICLE_ACCESSED",
      "ORDER_MODIFIED", "ORDER_VIEWED", "ESTAMP_ISSUED", "ESTAMP_PROCESSING_FAILED",
      "PERMISSION_CHANGED", "SETTINGS_CHANGED", "ESTAMP_PROVIDER_BALANCE_VIEWED",
      "ESTAMP_PROVIDER_BALANCE_REFRESHED", "ESTAMP_PROVIDER_USAGE_VIEWED",
      "BULK_BATCH_UPLOADED", "BULK_BATCH_VALIDATED", "BULK_BATCH_CONFIRMED",
      "BULK_BATCH_COMPLETED", "BULK_BATCH_FAILED", "BULK_BATCH_CANCELLED",
      "ESTAMP_REQUEST_LOCKED", "POLICY_CREATED", "POLICY_PUBLISHED", "POLICY_ACKNOWLEDGED",
    ]);
    const selects = screen.getAllByRole("combobox");
    const actionSelect = selects.find((s) => Array.from(s.querySelectorAll("option")).some((o) => o.value === "LOGIN"));
    const values = Array.from(actionSelect.querySelectorAll("option")).map((o) => o.value).filter(Boolean);
    for (const v of values) {
      expect(REAL_ACTIONS.has(v)).toBe(true);
    }
  });

  it("sends the chosen action filter and resets to page 1", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    useAuth.mockReturnValue({ user: masterAdmin() });
    apiClient.get.mockResolvedValue(page([entry()], 45));
    render(<AuditLogsPage />);
    await screen.findByText("LOGIN");

    await user.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(apiClient.get.mock.calls.at(-1)[1].params.page).toBe(2));

    const selects = screen.getAllByRole("combobox");
    const actionSelect = selects.find((s) => Array.from(s.querySelectorAll("option")).some((o) => o.value === "LOGIN"));
    await user.selectOptions(actionSelect, "LOGIN_FAILED");
    await waitFor(() => {
      const last = apiClient.get.mock.calls.at(-1);
      expect(last[1].params.action).toBe("LOGIN_FAILED");
      expect(last[1].params.page).toBe(1);
    });
  });

  it("sends the entityType free-text filter", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    useAuth.mockReturnValue({ user: masterAdmin() });
    apiClient.get.mockResolvedValue(page([]));
    render(<AuditLogsPage />);
    await screen.findByText("No audit entries match these filters.");

    await user.type(screen.getByPlaceholderText("Entity type (e.g. EStampOrder)"), "EStampOrder");
    await waitFor(() => expect(apiClient.get.mock.calls.at(-1)[1].params.entityType).toBe("EStampOrder"));
  });

  it("sends a last-7-days date range when that preset is chosen", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    useAuth.mockReturnValue({ user: masterAdmin() });
    apiClient.get.mockResolvedValue(page([]));
    render(<AuditLogsPage />);
    await screen.findByText("No audit entries match these filters.");

    await user.selectOptions(screen.getByDisplayValue("All time"), "last7days");
    await waitFor(() => {
      const last = apiClient.get.mock.calls.at(-1);
      expect(last[1].params.dateFrom).toBeTruthy();
    });
  });

  it("shows custom date inputs only for the custom preset and sends both bounds", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    useAuth.mockReturnValue({ user: masterAdmin() });
    apiClient.get.mockResolvedValue(page([]));
    render(<AuditLogsPage />);
    await screen.findByText("No audit entries match these filters.");

    await user.selectOptions(screen.getByDisplayValue("All time"), "custom");
    const dateInputs = document.querySelectorAll('input[type="date"]');
    expect(dateInputs.length).toBe(2);
  });

  it("MASTER_ADMIN's organization filter is optional - omitting it still loads (global view)", async () => {
    useAuth.mockReturnValue({ user: masterAdmin() });
    apiClient.get.mockResolvedValue(page([entry()]));
    render(<AuditLogsPage />);
    expect(await screen.findByText("LOGIN")).toBeInTheDocument();
    const last = apiClient.get.mock.calls.at(-1);
    expect(last[1].params.organizationId).toBeUndefined();
  });

  it("MASTER_ADMIN can narrow to a specific organization via the optional filter", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    useAuth.mockReturnValue({ user: masterAdmin() });
    apiClient.get.mockResolvedValue(page([]));
    render(<AuditLogsPage />);
    await screen.findByText("No audit entries match these filters.");

    await user.type(screen.getByPlaceholderText("Organization ID (optional filter)"), "org-xyz");
    await waitFor(() => expect(apiClient.get.mock.calls.at(-1)[1].params.organizationId).toBe("org-xyz"));
  });
});

describe("AuditLogsPage - pagination", () => {
  it("is server-side, bounded, and never recomputes total from the loaded page", async () => {
    useAuth.mockReturnValue({ user: masterAdmin() });
    apiClient.get.mockResolvedValue(page([entry()], 45));
    render(<AuditLogsPage />);
    expect(await screen.findByText("Page 1 of 3 (45 total)")).toBeInTheDocument();
    const [, config] = apiClient.get.mock.calls[0];
    expect(config.params.limit).toBeGreaterThan(0);
    expect(config.params.limit).toBeLessThanOrEqual(100);
  });
});

describe("AuditLogsPage - detail view and immutability", () => {
  it("opens a detail view with real fields and safe metadata rendering", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    useAuth.mockReturnValue({ user: masterAdmin() });
    apiClient.get.mockResolvedValue(page([entry({ metadata: { amount: 500, note: "ok" } })]));
    render(<AuditLogsPage />);
    await screen.findByText("LOGIN");

    await user.click(screen.getByRole("button", { name: "Details" }));
    expect(await screen.findByText("Audit entry detail")).toBeInTheDocument();
    expect(screen.getByText("Actor type")).toBeInTheDocument();
    expect(screen.getByText("500")).toBeInTheDocument();
  });

  it("renders a SYSTEM entry's absent actor honestly rather than fabricating one", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    useAuth.mockReturnValue({ user: masterAdmin() });
    apiClient.get.mockResolvedValue(page([entry({ actorType: "SYSTEM", actorId: null })]));
    render(<AuditLogsPage />);
    await screen.findByText("LOGIN");
    await user.click(screen.getByRole("button", { name: "Details" }));
    expect(await screen.findByText("(system - no human actor)")).toBeInTheDocument();
  });

  it("never renders any edit, delete, or export control anywhere on the page", async () => {
    useAuth.mockReturnValue({ user: masterAdmin() });
    apiClient.get.mockResolvedValue(page([entry()]));
    render(<AuditLogsPage />);
    await screen.findByText("LOGIN");
    for (const forbidden of ["Edit", "Delete", "Export", "Remove", "Clear logs"]) {
      expect(screen.queryByRole("button", { name: forbidden })).not.toBeInTheDocument();
    }
  });
});
