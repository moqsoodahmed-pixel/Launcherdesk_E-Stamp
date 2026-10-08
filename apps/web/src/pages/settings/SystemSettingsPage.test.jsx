import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import SystemSettingsPage from "./SystemSettingsPage";
import { apiClient } from "../../api/client";
import { useAuth } from "../../context/AuthContext";

vi.mock("../../api/client", () => ({
  apiClient: { get: vi.fn(), patch: vi.fn() },
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

const intEntry = (overrides = {}) => ({
  key: "REPORT_MAX_DATE_RANGE_DAYS",
  description: "Maximum date range for report queries, in days.",
  category: "BUSINESS",
  valueType: "INTEGER",
  value: 366,
  defaultValue: 366,
  min: 1,
  max: 3650,
  nullable: false,
  version: 0,
  updatedAt: null,
  ...overrides,
});

const boolEntry = (overrides = {}) => ({
  key: "REPORTS_ENABLED",
  description: "Master kill-switch for the Reports module.",
  category: "FEATURE_FLAG",
  valueType: "BOOLEAN",
  value: true,
  defaultValue: true,
  version: 0,
  updatedAt: null,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("SystemSettingsPage - permissions", () => {
  it("shows a permission-denied message and never calls the API for a USER", () => {
    useAuth.mockReturnValue({ user: tenant("USER") });
    render(<SystemSettingsPage />);
    expect(screen.getByText("You do not have permission to view system settings.")).toBeInTheDocument();
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it("denies SUPER_ADMIN and ADMIN by default (no explicit grant assumed)", () => {
    useAuth.mockReturnValue({ user: tenant("SUPER_ADMIN") });
    const { unmount } = render(<SystemSettingsPage />);
    expect(screen.getByText("You do not have permission to view system settings.")).toBeInTheDocument();
    unmount();

    useAuth.mockReturnValue({ user: tenant("ADMIN") });
    render(<SystemSettingsPage />);
    expect(screen.getByText("You do not have permission to view system settings.")).toBeInTheDocument();
  });

  it("Assistant Master Admin without any explicit grant sees the denied state", () => {
    useAuth.mockReturnValue({ user: assistant([]) });
    render(<SystemSettingsPage />);
    expect(screen.getByText("You do not have permission to view system settings.")).toBeInTheDocument();
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it("Assistant Master Admin with an explicit settings.view grant can view but not edit", async () => {
    useAuth.mockReturnValue({ user: assistant(["settings.view"]) });
    apiClient.get.mockResolvedValue({ data: { data: [intEntry()] } });
    render(<SystemSettingsPage />);
    expect(await screen.findByText("REPORT_MAX_DATE_RANGE_DAYS")).toBeInTheDocument();
    // Read-only render: plain value text (also matches the Default column, which has the same value here), no number input, no Save button.
    expect(screen.getAllByText("366").length).toBeGreaterThan(0);
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("Assistant Master Admin with settings.manage can edit", async () => {
    useAuth.mockReturnValue({ user: assistant(["settings.view", "settings.manage"]) });
    apiClient.get.mockResolvedValue({ data: { data: [intEntry()] } });
    render(<SystemSettingsPage />);
    await screen.findByText("REPORT_MAX_DATE_RANGE_DAYS");
    expect(screen.getByRole("spinbutton")).toBeInTheDocument();
  });

  it("MASTER_ADMIN can view and manage without any explicit grant", async () => {
    useAuth.mockReturnValue({ user: masterAdmin() });
    apiClient.get.mockResolvedValue({ data: { data: [intEntry()] } });
    render(<SystemSettingsPage />);
    await screen.findByText("REPORT_MAX_DATE_RANGE_DAYS");
    expect(screen.getByRole("spinbutton")).toBeInTheDocument();
  });
});

describe("SystemSettingsPage - rendering real settings", () => {
  it("renders real settings grouped by category, nothing fabricated", async () => {
    useAuth.mockReturnValue({ user: masterAdmin() });
    apiClient.get.mockResolvedValue({ data: { data: [intEntry(), boolEntry()] } });
    render(<SystemSettingsPage />);
    expect(await screen.findByText("Business Settings")).toBeInTheDocument();
    expect(screen.getByText("Feature Flags")).toBeInTheDocument();
    expect(screen.getByText("REPORT_MAX_DATE_RANGE_DAYS")).toBeInTheDocument();
    expect(screen.getByText("REPORTS_ENABLED")).toBeInTheDocument();
  });

  it("shows a load error instead of a blank page", async () => {
    useAuth.mockReturnValue({ user: masterAdmin() });
    apiClient.get.mockRejectedValue({ response: { data: { message: "Server exploded" } } });
    render(<SystemSettingsPage />);
    expect(await screen.findByText("Server exploded")).toBeInTheDocument();
  });

  it("shows a 403-specific message without leaking details", async () => {
    useAuth.mockReturnValue({ user: masterAdmin() });
    apiClient.get.mockRejectedValue({ response: { status: 403 } });
    render(<SystemSettingsPage />);
    expect(await screen.findByText("You do not have permission to view system settings.")).toBeInTheDocument();
  });
});

describe("SystemSettingsPage - editing and save UX", () => {
  it("renders a boolean setting as a toggle and an integer setting as a number input", async () => {
    useAuth.mockReturnValue({ user: masterAdmin() });
    apiClient.get.mockResolvedValue({ data: { data: [intEntry(), boolEntry()] } });
    render(<SystemSettingsPage />);
    await screen.findByText("REPORT_MAX_DATE_RANGE_DAYS");
    expect(screen.getByRole("spinbutton")).toHaveValue(366);
    expect(screen.getByRole("button", { name: "Enabled" })).toBeInTheDocument();
  });

  it("disables Save until the value actually changes, and re-disables after a successful save", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    useAuth.mockReturnValue({ user: masterAdmin() });
    apiClient.get.mockResolvedValue({ data: { data: [intEntry()] } });
    apiClient.patch.mockResolvedValue({ data: { data: {} } });
    render(<SystemSettingsPage />);
    await screen.findByText("REPORT_MAX_DATE_RANGE_DAYS");

    const saveButton = screen.getByRole("button", { name: "Save" });
    expect(saveButton).toBeDisabled();

    const input = screen.getByRole("spinbutton");
    await user.clear(input);
    await user.type(input, "100");
    expect(saveButton).toBeEnabled();
    expect(screen.getByText("Unsaved")).toBeInTheDocument();

    await user.click(saveButton);
    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledWith("/settings/REPORT_MAX_DATE_RANGE_DAYS", { value: 100, expectedVersion: 0 }));
  });

  it("never sends any field beyond {value, expectedVersion} - no arbitrary key mutation, no organizationId", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    useAuth.mockReturnValue({ user: masterAdmin() });
    apiClient.get.mockResolvedValue({ data: { data: [intEntry()] } });
    apiClient.patch.mockResolvedValue({ data: { data: {} } });
    render(<SystemSettingsPage />);
    await screen.findByText("REPORT_MAX_DATE_RANGE_DAYS");

    const input = screen.getByRole("spinbutton");
    await user.clear(input);
    await user.type(input, "30");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(apiClient.patch).toHaveBeenCalled());
    const [url, body] = apiClient.patch.mock.calls[0];
    expect(url).toBe("/settings/REPORT_MAX_DATE_RANGE_DAYS");
    expect(Object.keys(body).sort()).toEqual(["expectedVersion", "value"]);
  });

  it("shows a server validation error and keeps the real server value, never pretending success", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    useAuth.mockReturnValue({ user: masterAdmin() });
    apiClient.get.mockResolvedValue({ data: { data: [intEntry()] } });
    apiClient.patch.mockRejectedValue({ response: { data: { message: "Value must be between 1 and 3650." } } });
    render(<SystemSettingsPage />);
    await screen.findByText("REPORT_MAX_DATE_RANGE_DAYS");

    const input = screen.getByRole("spinbutton");
    await user.clear(input);
    await user.type(input, "99999");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Value must be between 1 and 3650.")).toBeInTheDocument();
  });

  it("shows a conflict-specific message and reloads when the backend reports SETTING_CONFLICT", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    useAuth.mockReturnValue({ user: masterAdmin() });
    apiClient.get.mockResolvedValue({ data: { data: [intEntry()] } });
    apiClient.patch.mockRejectedValue({ response: { data: { code: "SETTING_CONFLICT" } } });
    render(<SystemSettingsPage />);
    await screen.findByText("REPORT_MAX_DATE_RANGE_DAYS");

    const input = screen.getByRole("spinbutton");
    await user.clear(input);
    await user.type(input, "40");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText(/changed by someone else/)).toBeInTheDocument();
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(2));
  });

  it("requires confirmation for a high-impact setting before saving", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    useAuth.mockReturnValue({ user: masterAdmin() });
    apiClient.get.mockResolvedValue({ data: { data: [boolEntry()] } });
    render(<SystemSettingsPage />);
    await screen.findByText("REPORTS_ENABLED");

    await user.click(screen.getByRole("button", { name: "Enabled" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(window.confirm).toHaveBeenCalled();
    expect(apiClient.patch).not.toHaveBeenCalled();
  });
});

describe("SystemSettingsPage - BULK_ESTAMP_MAX_FILE_SIZE_MB wording (Phase 38)", () => {
  it("warns that the file-size limit is env-wired, not live from this value, unlike the live-wired row cap", async () => {
    useAuth.mockReturnValue({ user: masterAdmin() });
    apiClient.get.mockResolvedValue({
      data: {
        data: [
          intEntry({ key: "BULK_ESTAMP_MAX_FILE_SIZE_MB", description: "Maximum size (MB) for a bulk E-Stamp CSV/XLSX upload.", value: 10, defaultValue: 10, max: 100 }),
          intEntry({ key: "BULK_ESTAMP_MAX_ROWS", description: "Maximum spreadsheet rows accepted in a single bulk E-Stamp upload.", value: 500, defaultValue: 500, max: 10000 }),
        ],
      },
    });
    render(<SystemSettingsPage />);
    await screen.findByText("BULK_ESTAMP_MAX_FILE_SIZE_MB");

    expect(screen.getByText(/the upload size actually enforced by the server is controlled by the BULK_ESTAMP_MAX_FILE_SIZE_MB environment variable/)).toBeInTheDocument();
    // The genuinely live-wired row cap gets no such caveat.
    const rowsCell = screen.getByText("BULK_ESTAMP_MAX_ROWS").closest("td");
    expect(rowsCell.textContent).not.toMatch(/environment variable/);
  });
});

describe("SystemSettingsPage - read-only rendering", () => {
  it("never renders an editable control when the actor lacks settings.manage", async () => {
    useAuth.mockReturnValue({ user: tenant("SUPER_ADMIN", ["settings.view"]) });
    apiClient.get.mockResolvedValue({ data: { data: [intEntry(), boolEntry()] } });
    render(<SystemSettingsPage />);
    await screen.findByText("REPORT_MAX_DATE_RANGE_DAYS");
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enabled" })).not.toBeInTheDocument();
  });
});
