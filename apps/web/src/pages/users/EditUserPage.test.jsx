import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import EditUserPage from "./EditUserPage";
import { apiClient } from "../../api/client";

vi.mock("../../api/client", () => ({
  apiClient: { get: vi.fn(), patch: vi.fn(), post: vi.fn() },
}));
const SUPER_ADMIN = { role: "SUPER_ADMIN", permissions: ["user.view", "user.create", "user.manage"] };
let mockMe = SUPER_ADMIN;
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: mockMe }) }));

function renderAt(user) {
  apiClient.get.mockResolvedValue({ data: { data: user } });
  return render(
    <MemoryRouter initialEntries={["/users/u1"]}>
      <Routes>
        <Route path="/users/:id" element={<EditUserPage />} />
      </Routes>
    </MemoryRouter>
  );
}

function makeUser(overrides = {}) {
  return { _id: "u1", name: "Alice", email: "alice@acme.test", phone: "9000000000", role: "USER", isActive: true, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockMe = SUPER_ADMIN;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("EditUserPage - role management respects hierarchy", () => {
  it("offers a USER<->ADMIN toggle for an ADMIN/USER target, never any other role", async () => {
    renderAt(makeUser({ role: "USER" }));
    await screen.findByText("Alice");
    expect(screen.getByText("Change to Admin")).toBeInTheDocument();
    // No select/dropdown offering SUPER_ADMIN, MASTER_ADMIN, or ASSISTANT_MASTER_ADMIN exists anywhere on the page.
    expect(screen.queryByText(/SUPER_ADMIN/)).not.toBeInTheDocument();
    expect(screen.queryByText(/MASTER_ADMIN/)).not.toBeInTheDocument();
  });

  it("flips the toggle label for an ADMIN target", async () => {
    renderAt(makeUser({ role: "ADMIN" }));
    await screen.findByText("Alice");
    expect(screen.getByText("Change to User")).toBeInTheDocument();
  });

  it("hides the Role panel entirely for a protected role (SUPER_ADMIN) - no role-change control is offered at all", async () => {
    renderAt(makeUser({ role: "SUPER_ADMIN" }));
    await screen.findByText("Alice");
    expect(screen.queryByText("Role")).not.toBeInTheDocument();
    expect(screen.queryByText(/Change to/)).not.toBeInTheDocument();
  });

  it("requires confirmation and calls the real role endpoint with the exact target role", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const u = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    apiClient.patch.mockResolvedValue({ data: { data: {} } });
    renderAt(makeUser({ role: "USER" }));
    await screen.findByText("Alice");

    await u.click(screen.getByText("Change to Admin"));
    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledWith("/users/u1/role", { role: "ADMIN" }));
  });

  it("does not call the role endpoint when confirmation is declined", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const u = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderAt(makeUser({ role: "USER" }));
    await screen.findByText("Alice");

    await u.click(screen.getByText("Change to Admin"));
    expect(apiClient.patch).not.toHaveBeenCalled();
  });
});

describe("EditUserPage - profile editing", () => {
  it("saves profile fields via PATCH and refreshes from the server", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const u = userEvent.setup();
    apiClient.patch.mockResolvedValue({ data: { data: {} } });
    renderAt(makeUser());
    await screen.findByText("Alice");

    await u.clear(screen.getByLabelText("Phone (optional)"));
    await u.type(screen.getByLabelText("Phone (optional)"), "9111111111");
    await u.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledWith("/users/u1", expect.objectContaining({ phone: "9111111111" })));
  });

  it("never sends organizationId, role, or isActive through the profile save - those are separate endpoints", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const u = userEvent.setup();
    apiClient.patch.mockResolvedValue({ data: { data: {} } });
    renderAt(makeUser());
    await screen.findByText("Alice");
    await u.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(apiClient.patch).toHaveBeenCalled());
    const [, body] = apiClient.patch.mock.calls[0];
    expect(body).not.toHaveProperty("organizationId");
    expect(body).not.toHaveProperty("role");
    expect(body).not.toHaveProperty("isActive");
  });
});

describe("EditUserPage - Super Admin/Admin can reset an existing user's password", () => {
  it("shows a Password section with a reset form when the actor can edit", async () => {
    renderAt(makeUser());
    await screen.findByText("Alice");
    expect(screen.getByText("Password")).toBeInTheDocument();
    expect(screen.getByLabelText("New password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset password" })).toBeInTheDocument();
  });

  it("submits the admin-chosen password to the real reset endpoint and shows it once on success", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const u = userEvent.setup();
    apiClient.post.mockResolvedValue({ data: { data: { tempPassword: "MyNewPass1" } } });
    renderAt(makeUser());
    await screen.findByText("Alice");

    await u.type(screen.getByLabelText("New password"), "MyNewPass1");
    await u.click(screen.getByRole("button", { name: "Reset password" }));

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/users/u1/reset-password", { password: "MyNewPass1" }));
    expect(await screen.findByText("MyNewPass1")).toBeInTheDocument();
  });

  it("shows a server error instead of silently failing", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const u = userEvent.setup();
    apiClient.post.mockRejectedValue({ response: { data: { message: "You cannot modify a user of this role" } } });
    renderAt(makeUser());
    await screen.findByText("Alice");

    await u.type(screen.getByLabelText("New password"), "MyNewPass1");
    await u.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByText("You cannot modify a user of this role")).toBeInTheDocument();
  });

  it("does not show a Password section for a read-only ADMIN viewer (user.view without user.manage)", async () => {
    mockMe = { role: "ADMIN", permissions: ["user.view"] };
    renderAt(makeUser());
    await screen.findByText("Alice");
    expect(screen.queryByText("Password")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reset password" })).not.toBeInTheDocument();
  });

  it("shows the current temporary-password reveal control when the backend reports one exists", async () => {
    renderAt(makeUser({ passwordState: "TEMPORARY" }));
    await screen.findByText("Alice");
    expect(screen.getByText("Current password:")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Show password/i })).toBeInTheDocument();
  });
});

describe("EditUserPage - error handling", () => {
  it("shows a load error instead of a blank page", async () => {
    apiClient.get.mockRejectedValue({ response: { data: { message: "User not found" } } });
    render(
      <MemoryRouter initialEntries={["/users/u1"]}>
        <Routes>
          <Route path="/users/:id" element={<EditUserPage />} />
        </Routes>
      </MemoryRouter>
    );
    expect(await screen.findByText("User not found")).toBeInTheDocument();
  });
});

describe("EditUserPage - Phase 2 fixes", () => {
  it("omits an empty phone instead of sending \"\" (the API rejects it)", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const u = userEvent.setup();
    apiClient.patch.mockResolvedValue({ data: { data: {} } });
    renderAt(makeUser({ phone: "" }));
    await screen.findByText("Alice");
    await u.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(apiClient.patch).toHaveBeenCalled());
    expect(apiClient.patch.mock.calls[0][1]).not.toHaveProperty("phone");
  });

  it("keeps the form on screen after saving (no Loading flash) and shows the notice", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const u = userEvent.setup();
    apiClient.patch.mockResolvedValue({ data: { data: {} } });
    renderAt(makeUser());
    await screen.findByText("Alice");
    await u.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("User updated.")).toBeInTheDocument();
    expect(screen.queryByText("Loading user...")).not.toBeInTheDocument();
  });

  it("is read-only for an ADMIN (user.view without user.manage)", async () => {
    mockMe = { role: "ADMIN", permissions: ["user.view"] };
    renderAt(makeUser());
    await screen.findByText("Alice");
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
    expect(screen.queryByText("Change to Admin")).not.toBeInTheDocument();
    expect(screen.getByText("You can view this user but not change them.")).toBeInTheDocument();
  });

  it("offers Retry when the user fails to load", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const u = userEvent.setup();
    apiClient.get.mockRejectedValueOnce({ response: { status: 500, data: { message: "Oops" } } }).mockResolvedValue({ data: { data: makeUser() } });
    render(
      <MemoryRouter initialEntries={["/users/u1"]}>
        <Routes>
          <Route path="/users/:id" element={<EditUserPage />} />
        </Routes>
      </MemoryRouter>
    );
    expect(await screen.findByText("Oops")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Alice")).toBeInTheDocument();
  });
});
