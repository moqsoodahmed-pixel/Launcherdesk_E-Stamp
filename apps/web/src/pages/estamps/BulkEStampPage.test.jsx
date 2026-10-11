import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import BulkEStampPage from "./BulkEStampPage";
import BulkBatchDetailPage from "./BulkBatchDetailPage";
import { apiClient } from "../../api/client";

vi.mock("../../api/client", () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));
let mockUser;
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: mockUser }) }));

beforeEach(() => {
  vi.clearAllMocks();
  mockUser = { role: "SUPER_ADMIN", permissions: ["estamp.bulk_create"] };
  URL.createObjectURL = vi.fn(() => "blob:fake");
  URL.revokeObjectURL = vi.fn();
});

const renderList = () =>
  render(
    <MemoryRouter>
      <BulkEStampPage />
    </MemoryRouter>
  );

describe("BulkEStampPage", () => {
  it("downloads the CSV template through the authenticated client, not a bare link", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const u = userEvent.setup();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    apiClient.get.mockImplementation((url) =>
      url === "/bulk-estamps/template" ? Promise.resolve({ data: new Blob(["a,b"]), headers: {} }) : Promise.resolve({ data: { data: { items: [], total: 0 } } })
    );
    renderList();
    await screen.findByText("No bulk batches yet. Create one to get started.");
    await u.click(screen.getByRole("button", { name: "Download CSV template" }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(apiClient.get).toHaveBeenCalledWith("/bulk-estamps/template", expect.objectContaining({ responseType: "blob" }));
  });

  it("shows a load error with Retry instead of skeleton rows or an empty list", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const u = userEvent.setup();
    apiClient.get.mockRejectedValueOnce({ response: { status: 503, data: { message: "Bulk is disabled" } } }).mockResolvedValue({ data: { data: { items: [], total: 0 } } });
    renderList();
    expect(await screen.findByText("Bulk is disabled")).toBeInTheDocument();
    expect(screen.queryByText("No bulk batches yet. Create one to get started.")).not.toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("No bulk batches yet. Create one to get started.")).toBeInTheDocument();
  });

  it("hides Create Bulk Request from internal roles (they have no organization to charge)", async () => {
    mockUser = { role: "MASTER_ADMIN" };
    apiClient.get.mockResolvedValue({ data: { data: { items: [], total: 0 } } });
    renderList();
    await screen.findByText("No bulk batches yet. Create one to get started.");
    expect(screen.queryByRole("button", { name: "Create Bulk Request" })).not.toBeInTheDocument();
  });
});

describe("BulkBatchDetailPage - load failures", () => {
  const renderDetail = () =>
    render(
      <MemoryRouter initialEntries={["/estamps/bulk/b1"]}>
        <Routes>
          <Route path="/estamps/bulk/:batchId" element={<BulkBatchDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

  it("a 404 says not found", async () => {
    apiClient.get.mockRejectedValue({ response: { status: 404, data: { message: "Batch not found" } } });
    renderDetail();
    expect(await screen.findByText("This batch could not be found.")).toBeInTheDocument();
  });

  it("a server error offers Retry instead of claiming not found", async () => {
    apiClient.get.mockRejectedValue({ response: { status: 500, data: { message: "Server error" } } });
    renderDetail();
    expect(await screen.findByText("Server error")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByText("This batch could not be found.")).not.toBeInTheDocument();
  });
});
