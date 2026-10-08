import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import RequestsListPage from "./RequestsListPage";
import { apiClient } from "../../api/client";
import { useAuth } from "../../context/AuthContext";

vi.mock("../../api/client", () => ({
  apiClient: { get: vi.fn() },
}));
vi.mock("../../context/AuthContext", () => ({
  useAuth: vi.fn(),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <RequestsListPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ user: { role: "USER", permissions: [] } });
  apiClient.get.mockImplementation((url) => {
    if (url === "/articles/states") return Promise.resolve({ data: { data: ["MH", "KA"] } });
    return Promise.resolve({ data: { data: { items: [], total: 0 } } });
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("RequestsListPage - accessibility (Phase 38)", () => {
  it("gives every filter control an accessible name", async () => {
    renderPage();
    await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
    expect(screen.getByLabelText("Search requests")).toBeInTheDocument();
    expect(screen.getByLabelText("Status")).toBeInTheDocument();
    expect(screen.getByLabelText("State")).toBeInTheDocument();
    expect(screen.getByLabelText("Created from")).toBeInTheDocument();
    expect(screen.getByLabelText("Created to")).toBeInTheDocument();
  });
});

describe("RequestsListPage - mobile responsiveness (Phase 38)", () => {
  it("wraps the table in a horizontally scrollable container instead of clipping it with overflow-hidden", async () => {
    apiClient.get.mockImplementation((url) => {
      if (url === "/articles/states") return Promise.resolve({ data: { data: [] } });
      return Promise.resolve({
        data: { data: { items: [{ _id: "r1", requestNumber: "REQ-1", stateCode: "MH", status: "LOCKED", calculatedStampDuty: 500, createdAt: new Date().toISOString() }], total: 1 } },
      });
    });
    renderPage();
    const table = await screen.findByRole("table");
    expect(table.parentElement).toHaveClass("overflow-x-auto");
  });
});
