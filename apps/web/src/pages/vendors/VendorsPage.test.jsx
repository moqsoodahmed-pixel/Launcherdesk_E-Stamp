import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import VendorsPage from "./VendorsPage";
import { apiClient } from "../../api/client";

vi.mock("../../api/client", () => ({ apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: { role: "MASTER_ADMIN", permissions: [] } }) }));

const ok = (data) => Promise.resolve({ data: { data } });
const VENDORS = [
  { _id: "v1", name: "Stamp Co", email: "stamp@co.test", isActive: true },
  { _id: "v2", name: "Paper Co", email: "paper@co.test", isActive: true },
];
const renderPage = () =>
  render(
    <MemoryRouter>
      <VendorsPage />
    </MemoryRouter>
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  apiClient.get.mockImplementation(() => ok({ items: VENDORS }));
});

describe("Reset password", () => {
  it("confirms, shows the one-time password panel with Copy, and clears it on dismiss", async () => {
    let resolve;
    apiClient.post.mockReturnValue(new Promise((r) => (resolve = r)));
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Reset password for Stamp Co" }));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("Stamp Co"));
    expect(apiClient.post).toHaveBeenCalledWith("/vendors/v1/reset-password");
    // Buttons for that row are disabled while submitting.
    expect(screen.getByRole("button", { name: "Delete Stamp Co" })).toBeDisabled();
    resolve({ data: { data: { tempPassword: "Tmp-Reset-987" } } });
    const panel = await screen.findByRole("region", { name: "New temporary password" });
    expect(within(panel).getByText("Tmp-Reset-987")).toBeInTheDocument();
    expect(within(panel).getByText("Shown once. Share it privately; they must change it at first login.")).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Copy temporary password" })).toBeInTheDocument();
    expect(setItem).not.toHaveBeenCalled();
    await userEvent.click(within(panel).getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("Tmp-Reset-987")).not.toBeInTheDocument();
    setItem.mockRestore();
  });

  it("does nothing when the confirm dialog is cancelled; the panel is gone after leaving the page", async () => {
    window.confirm.mockReturnValueOnce(false);
    apiClient.post.mockReturnValue(ok({ tempPassword: "Tmp-Leave-1" }));
    const { unmount } = renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Reset password for Stamp Co" }));
    expect(apiClient.post).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Reset password for Stamp Co" }));
    expect(await screen.findByText("Tmp-Leave-1")).toBeInTheDocument();
    unmount();
    renderPage();
    await screen.findByText("Stamp Co");
    expect(screen.queryByText("Tmp-Leave-1")).not.toBeInTheDocument();
  });

  it("shows the server error", async () => {
    apiClient.post.mockRejectedValue({ response: { status: 429, data: {} } });
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Reset password for Stamp Co" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many requests");
  });
});

describe("Delete vendor", () => {
  it("requires the vendor's email; a wrong email blocks the delete", async () => {
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Delete Stamp Co" }));
    const dialog = screen.getByRole("dialog", { name: "Delete Stamp Co" });
    expect(dialog).toHaveTextContent("stamp@co.test");
    await userEvent.type(within(dialog).getByLabelText("Vendor email to confirm"), "paper@co.test");
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete vendor" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("The email does not match");
    expect(apiClient.delete).not.toHaveBeenCalled();
  });

  it("deletes on the matching email and removes the row", async () => {
    apiClient.delete.mockReturnValue(ok({ deleted: "soft" }));
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Delete Stamp Co" }));
    const dialog = screen.getByRole("dialog", { name: "Delete Stamp Co" });
    await userEvent.type(within(dialog).getByLabelText("Vendor email to confirm"), "STAMP@co.test");
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete vendor" }));
    await waitFor(() => expect(apiClient.delete).toHaveBeenCalledWith("/vendors/v1"));
    await waitFor(() => expect(screen.queryByText("Stamp Co")).not.toBeInTheDocument());
    expect(screen.getByText("Paper Co")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the server's 409 message when orders are still with the vendor and keeps the row", async () => {
    apiClient.delete.mockRejectedValue({ response: { status: 409, data: { message: "2 orders are still with this vendor. Recall or reassign them first.", code: "VENDOR_HAS_OPEN_ORDERS" } } });
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Delete Stamp Co" }));
    const dialog = screen.getByRole("dialog", { name: "Delete Stamp Co" });
    await userEvent.type(within(dialog).getByLabelText("Vendor email to confirm"), "stamp@co.test");
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete vendor" }));
    expect(await within(dialog).findByText("2 orders are still with this vendor. Recall or reassign them first.")).toBeInTheDocument();
    expect(screen.getAllByText("Stamp Co").length).toBeGreaterThan(0);
  });

  it("shows loading and error with Retry for the list", async () => {
    apiClient.get.mockRejectedValueOnce({ response: { status: 500, data: {} } }).mockImplementation(() => ok({ items: VENDORS }));
    renderPage();
    expect(screen.getByRole("status")).toHaveTextContent("Loading vendors");
    await userEvent.click(await screen.findByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Stamp Co")).toBeInTheDocument();
  });
});
