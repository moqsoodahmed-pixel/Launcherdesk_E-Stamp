import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ProfilePage from "./ProfilePage";
import { apiClient } from "../../api/client";

vi.mock("../../api/client", () => ({ apiClient: { get: vi.fn(), patch: vi.fn(), post: vi.fn() } }));
const changePassword = vi.fn();
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: { role: "USER" }, changePassword }) }));

const ME = { _id: "u1", name: "Asha", email: "asha@example.com", role: "SUPER_ADMIN", phone: "9999999", passwordHash: "SECRET_HASH" };
const ok = (data) => Promise.resolve({ data: { data } });

beforeEach(() => vi.clearAllMocks());

describe("ProfilePage", () => {
  it("shows loading, then email and role read-only with editable name/phone, and never a hash", async () => {
    apiClient.get.mockReturnValue(ok(ME));
    render(<ProfilePage />);
    expect(screen.getByRole("status")).toHaveTextContent(/Loading/);
    expect(await screen.findByText("asha@example.com")).toBeInTheDocument();
    expect(screen.getByText("Super Admin")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Asha");
    expect(screen.getByLabelText("Phone (optional)")).toHaveValue("9999999");
    expect(screen.queryByText(/SECRET_HASH/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Email/)).not.toBeInTheDocument();
  });

  it("shows an error with Retry that reloads", async () => {
    apiClient.get.mockRejectedValueOnce({ response: { status: 500, data: { message: "Boom" } } }).mockReturnValueOnce(ok(ME));
    render(<ProfilePage />);
    expect(await screen.findByText("Boom")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("asha@example.com")).toBeInTheDocument();
  });

  it("saves only name and phone via PATCH /profile", async () => {
    apiClient.get.mockReturnValue(ok(ME));
    apiClient.patch.mockReturnValue(ok({ ...ME, name: "Asha K", phone: "" }));
    render(<ProfilePage />);
    const name = await screen.findByLabelText("Name");
    await userEvent.clear(name);
    await userEvent.type(name, "Asha K");
    await userEvent.clear(screen.getByLabelText("Phone (optional)"));
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledWith("/profile", { name: "Asha K", phone: "" }));
    expect(await screen.findByText("Profile updated.")).toBeInTheDocument();
  });

  it("change-password section reuses AuthContext.changePassword", async () => {
    apiClient.get.mockReturnValue(ok(ME));
    changePassword.mockResolvedValue({});
    render(<ProfilePage />);
    await screen.findByText("asha@example.com");
    await userEvent.type(screen.getByLabelText("Current password"), "OldPass!123");
    await userEvent.type(screen.getByLabelText("New password"), "NewPass!456");
    await userEvent.type(screen.getByLabelText("Confirm new password"), "NewPass!456");
    await userEvent.click(screen.getByRole("button", { name: "Change password" }));
    await waitFor(() => expect(changePassword).toHaveBeenCalledWith("OldPass!123", "NewPass!456"));
    expect(await screen.findByText(/Password changed/)).toBeInTheDocument();
  });
});
