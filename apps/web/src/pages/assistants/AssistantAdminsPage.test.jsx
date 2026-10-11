import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AssistantAdminsPage from "./AssistantAdminsPage";
import { apiClient } from "../../api/client";

vi.mock("../../api/client", () => ({ apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));

const AA = { _id: "a1", name: "Ravi", email: "ravi@ld.local", isActive: true, permissions: ["client.view", "order.view"] };
const ok = (data) => Promise.resolve({ data: { data } });

beforeEach(() => vi.clearAllMocks());

describe("AssistantAdminsPage", () => {
  it("lists users filtered to ASSISTANT_MASTER_ADMIN", async () => {
    apiClient.get.mockReturnValue(ok({ items: [AA], total: 1 }));
    render(<AssistantAdminsPage />);
    expect(screen.getByRole("status")).toHaveTextContent(/Loading/);
    expect(await screen.findByText("Ravi")).toBeInTheDocument();
    expect(apiClient.get).toHaveBeenCalledWith("/users", expect.objectContaining({ params: expect.objectContaining({ role: "ASSISTANT_MASTER_ADMIN", page: 1 }) }));
  });

  it("shows the empty state", async () => {
    apiClient.get.mockReturnValue(ok({ items: [], total: 0 }));
    render(<AssistantAdminsPage />);
    expect(await screen.findByText("No Assistant Master Admins yet")).toBeInTheDocument();
  });

  it("shows an error with Retry", async () => {
    apiClient.get.mockRejectedValueOnce({ response: { status: 500, data: {} } }).mockReturnValueOnce(ok({ items: [AA], total: 1 }));
    render(<AssistantAdminsPage />);
    expect(await screen.findByText("Failed to load Assistant Master Admins.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Ravi")).toBeInTheDocument();
  });

  it("creating an assistant shows the temporary password once, dismissible", async () => {
    apiClient.get.mockReturnValue(ok({ items: [], total: 0 }));
    apiClient.post.mockReturnValue(ok({ user: { _id: "a2", email: "new@ld.local" }, tempPassword: "TmpPw-XYZ" }));
    render(<AssistantAdminsPage />);
    await screen.findByText("No Assistant Master Admins yet");
    await userEvent.click(screen.getByRole("button", { name: "New Assistant Admin" }));
    await userEvent.type(screen.getByLabelText("Name"), "New Person");
    await userEvent.type(screen.getByLabelText("Email"), "new@ld.local");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/users/assistant-admins", { name: "New Person", email: "new@ld.local" }));
    expect(await screen.findByText("TmpPw-XYZ")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("TmpPw-XYZ")).not.toBeInTheDocument();
  });

  it("shows a clear message for a 409 duplicate email", async () => {
    apiClient.get.mockReturnValue(ok({ items: [], total: 0 }));
    apiClient.post.mockRejectedValue({ response: { status: 409, data: {} } });
    render(<AssistantAdminsPage />);
    await screen.findByText("No Assistant Master Admins yet");
    await userEvent.click(screen.getByRole("button", { name: "New Assistant Admin" }));
    await userEvent.type(screen.getByLabelText("Name"), "Dup Person");
    await userEvent.type(screen.getByLabelText("Email"), "dup@ld.local");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText("A user with this email already exists.")).toBeInTheDocument();
  });

  it("deactivates via PATCH /users/:id/status", async () => {
    apiClient.get.mockReturnValue(ok({ items: [AA], total: 1 }));
    apiClient.patch.mockReturnValue(ok({}));
    render(<AssistantAdminsPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Deactivate" }));
    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledWith("/users/a1/status", { isActive: false }));
  });

  it("permission edit sends the FULL selected set (grants and revokes)", async () => {
    apiClient.get.mockReturnValue(ok({ items: [AA], total: 1 }));
    apiClient.patch.mockReturnValue(ok({}));
    render(<AssistantAdminsPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Edit permissions" }));
    const dialog = screen.getByRole("dialog", { name: "Permissions for Ravi" });
    await userEvent.click(within(dialog).getByLabelText("client.view")); // revoke
    await userEvent.click(within(dialog).getByLabelText("report.view")); // grant
    await userEvent.click(within(dialog).getByRole("button", { name: "Save permissions" }));
    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledWith("/users/a1/permissions", { permissions: ["order.view", "report.view"] }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
