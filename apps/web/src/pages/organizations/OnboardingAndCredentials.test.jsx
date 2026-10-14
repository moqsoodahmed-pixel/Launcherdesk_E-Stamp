import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import CreateOrganizationPage from "./CreateOrganizationPage";
import OrganizationsListPage from "./OrganizationsListPage";
import UsersListPage from "../users/UsersListPage";
import VendorsPage from "../vendors/VendorsPage";
import TemporaryPasswordCell, { AUTO_HIDE_MS } from "../../components/common/TemporaryPasswordCell";
import { PERMISSIONS } from "../../utils/permissions";
import { apiClient } from "../../api/client";

vi.mock("../../api/client", () => ({ apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
let mockUser;
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: mockUser }) }));

const ok = (data) => Promise.resolve({ data: { data } });
const inRouter = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);
let writeText;

beforeEach(() => {
  vi.clearAllMocks();
  mockUser = { role: "MASTER_ADMIN", permissions: Object.values(PERMISSIONS) };
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});
afterEach(() => vi.useRealTimers());

describe("Create organization (one step)", () => {
  async function fillAndSubmit(extra) {
    await userEvent.type(screen.getByLabelText("Organization name"), "New Co");
    await userEvent.type(screen.getByLabelText("Contact email"), "owner@new.test");
    await userEvent.type(screen.getByLabelText("Contact phone"), "9999999999");
    await userEvent.type(screen.getByLabelText("Super Admin name"), "New Owner");
    if (extra) await extra();
    await userEvent.click(screen.getByRole("button", { name: "Create organization" }));
  }

  it("sends the Super Admin name and flags, then shows the result panel with the temporary password and Copy", async () => {
    apiClient.get.mockReturnValue(ok({ items: [] }));
    apiClient.post.mockReturnValue(ok({ organization: { _id: "o1", name: "New Co", status: "PENDING_APPROVAL", isEstampServiceEnabled: true }, superAdmin: { email: "owner@new.test" }, tempPassword: "Tmp-Org-55", emailSent: true }));
    inRouter(<CreateOrganizationPage />);
    expect(screen.getByText(/The contact email becomes this person's login/)).toBeInTheDocument();
    expect(screen.getByLabelText("Activate now")).toBeChecked();
    expect(screen.getByLabelText("Enable E-Stamp service")).toBeChecked();
    await fillAndSubmit(() => userEvent.click(screen.getByLabelText("Activate now")));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/organizations", expect.objectContaining({ superAdminName: "New Owner", activateNow: false, enableEstampService: true, contactEmail: "owner@new.test" }))
    );
    const panel = await screen.findByRole("region", { name: "Organization created" });
    expect(panel).toHaveTextContent("owner@new.test");
    expect(panel).toHaveTextContent("pending approval");
    expect(panel).toHaveTextContent("A welcome email was sent");
    expect(within(panel).getByText("Tmp-Org-55")).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole("button", { name: "Copy temporary password" }));
    expect(writeText).toHaveBeenCalledWith("Tmp-Org-55");
    expect(within(panel).getByRole("link", { name: "Open organization" })).toHaveAttribute("href", "/organizations/o1");
  });

  it("warns when the welcome email was not sent, and shows a 409 message", async () => {
    apiClient.get.mockReturnValue(ok({ items: [] }));
    apiClient.post
      .mockRejectedValueOnce({ response: { status: 409, data: { message: "A user with this email already exists. Use a different contact email for the new organization." } } })
      .mockReturnValueOnce(ok({ organization: { _id: "o2", name: "New Co", status: "ACTIVE", isEstampServiceEnabled: true }, superAdmin: { email: "owner@new.test" }, tempPassword: "Tmp-2", emailSent: false }));
    inRouter(<CreateOrganizationPage />);
    await fillAndSubmit();
    expect(await screen.findByText(/A user with this email already exists/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Create organization" }));
    expect(await screen.findByText(/welcome email could not be sent/)).toBeInTheDocument();
  });
});

describe("Organizations list Login column", () => {
  it("shows Ready, or a red No login badge with Create login", async () => {
    apiClient.get.mockReturnValue(ok({ items: [
      { _id: "a", name: "Has Login", contactEmail: "a@x.test", contactPhone: "1", status: "ACTIVE", createdAt: new Date().toISOString(), hasSuperAdmin: true },
      { _id: "b", name: "Legacy Co", contactEmail: "b@x.test", contactPhone: "1", status: "ACTIVE", createdAt: new Date().toISOString(), hasSuperAdmin: false },
    ], total: 2 }));
    inRouter(<OrganizationsListPage />);
    expect(await screen.findByText("Ready")).toBeInTheDocument();
    expect(screen.getByText("No login")).toHaveClass("text-red-700");
    expect(screen.getByRole("link", { name: "Create login for Legacy Co" })).toHaveAttribute("href", "/organizations/b?provision=1");
  });
});

describe("TemporaryPasswordCell", () => {
  it("shows the set-by label for a user-chosen password and never fetches", () => {
    render(<TemporaryPasswordCell userId="u1" passwordState="SET_BY_USER" setByLabel="Set by vendor" />);
    expect(screen.getByText("Set by vendor")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it("fetches only on Show, hides on Hide, and auto-hides after 30 seconds", async () => {
    apiClient.get.mockReturnValue(ok({ tempPassword: "Tmp-Shown-1", expiresAt: new Date().toISOString() }));
    render(<TemporaryPasswordCell userId="u1" passwordState="TEMPORARY" label="password" />);
    expect(screen.getByLabelText("Temporary password")).toHaveTextContent("••••••••");
    expect(apiClient.get).not.toHaveBeenCalled();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    await waitFor(() => expect(screen.getByLabelText("Temporary password")).toHaveTextContent("Tmp-Shown-1"));
    expect(apiClient.get).toHaveBeenCalledWith("/users/u1/temporary-password");
    act(() => vi.advanceTimersByTime(AUTO_HIDE_MS + 10));
    expect(screen.getByLabelText("Temporary password")).toHaveTextContent("••••••••");
    // Hidden again means forgotten: the next Show fetches again.
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(2));
    fireEvent.click(await screen.findByRole("button", { name: "Hide password" }));
    expect(screen.getByLabelText("Temporary password")).toHaveTextContent("••••••••");
  });

  it("Copy fetches and copies without displaying it; a 404 shows the server message", async () => {
    apiClient.get.mockReturnValueOnce(ok({ tempPassword: "Tmp-Copy-1" })).mockRejectedValueOnce({ response: { status: 404, data: { message: "No temporary password: the user has set their own, or it expired" } } });
    render(<TemporaryPasswordCell userId="u1" passwordState="TEMPORARY" label="password" />);
    await userEvent.click(screen.getByRole("button", { name: "Copy password" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Tmp-Copy-1"));
    expect(screen.getByLabelText("Temporary password")).toHaveTextContent("••••••••");
    await userEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("set their own");
  });
});

describe("Password columns", () => {
  it("Vendors page shows the Password column beside Last login, with row actions grouped and visible", async () => {
    apiClient.get.mockReturnValue(ok({ items: [
      { _id: "v1", name: "Temp Co", email: "t@co.test", isActive: true, passwordState: "TEMPORARY" },
      { _id: "v2", name: "Own Co", email: "o@co.test", isActive: true, passwordState: "SET_BY_USER" },
    ] }));
    inRouter(<VendorsPage />);
    await screen.findByText("Temp Co");
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers.indexOf("Password")).toBe(headers.indexOf("Last login") + 1);
    expect(screen.getByRole("button", { name: "Show password for Temp Co" })).toBeInTheDocument();
    expect(screen.getByText("Set by vendor")).toBeInTheDocument();
    for (const name of ["Temp Co", "Own Co"]) {
      const group = screen.getByRole("group", { name: `Actions for ${name}` });
      expect(within(group).getByRole("button", { name: `Reset password for ${name}` })).toBeVisible();
      expect(within(group).getByRole("button", { name: `Delete ${name}` })).toBeVisible();
      expect(within(group).getByRole("button", { name: `Deactivate ${name}` })).toBeVisible();
    }
    expect(apiClient.get).toHaveBeenCalledTimes(1);
  });

  it("Users page shows the Password column to Master Admin, Super Admin and Admin - but never to a role that can't reveal anyone's password", async () => {
    const items = [{ _id: "u1", name: "Emp", email: "e@x.test", role: "USER", isActive: true, createdAt: new Date().toISOString(), passwordState: "TEMPORARY" }];
    apiClient.get.mockReturnValue(ok({ items, total: 1 }));

    for (const role of ["MASTER_ADMIN", "SUPER_ADMIN", "ADMIN"]) {
      mockUser = { role, organizationId: "org1", permissions: [PERMISSIONS.USER_VIEW, PERMISSIONS.USER_MANAGE] };
      const { unmount } = inRouter(<UsersListPage />);
      await screen.findByText("Emp");
      expect(screen.getByRole("columnheader", { name: "Password" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Show password for Emp" })).toBeInTheDocument();
      unmount();
    }

    // Assistant Master Admin can view/manage client users but was never
    // granted password-reveal (GET /:id/temporary-password route-gates it
    // out) - the column must not appear and imply a capability it doesn't have.
    mockUser = { role: "ASSISTANT_MASTER_ADMIN", permissions: [PERMISSIONS.CLIENT_VIEW, PERMISSIONS.USER_VIEW] };
    inRouter(<UsersListPage />);
    await screen.findByText("Emp");
    expect(screen.queryByRole("columnheader", { name: "Password" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Show password/ })).not.toBeInTheDocument();
  });
});
