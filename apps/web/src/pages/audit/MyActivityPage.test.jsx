import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import MyActivityPage from "./MyActivityPage";
import { apiClient } from "../../api/client";

vi.mock("../../api/client", () => ({
  apiClient: { get: vi.fn() },
}));

function page(items = [], total = items.length) {
  return { data: { data: { items, total, page: 1, limit: 20 } } };
}

const entry = (overrides = {}) => ({
  _id: "a1",
  action: "LOGIN",
  entityType: null,
  entityId: null,
  createdAt: new Date().toISOString(),
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("MyActivityPage - available to any authenticated user, self-scoped only", () => {
  it("renders real activity rows without requiring any permission check", async () => {
    apiClient.get.mockResolvedValue(page([entry({ entityType: "EStampRequest", entityId: "r1" })]));
    render(<MyActivityPage />);
    expect(await screen.findByText("LOGIN")).toBeInTheDocument();
    expect(screen.getByText("EStampRequest #r1")).toBeInTheDocument();
  });

  it("always calls /audit/mine with no organizationId or actor filter - the backend hard-scopes to the caller", async () => {
    apiClient.get.mockResolvedValue(page([]));
    render(<MyActivityPage />);
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/audit/mine", { params: { page: 1, limit: 20 } }));
  });

  it("shows an honest empty state", async () => {
    apiClient.get.mockResolvedValue(page([]));
    render(<MyActivityPage />);
    expect(await screen.findByText("No activity recorded yet.")).toBeInTheDocument();
  });

  it("shows a load error instead of a blank page", async () => {
    apiClient.get.mockRejectedValue({ response: { data: { message: "Failed hard" } } });
    render(<MyActivityPage />);
    expect(await screen.findByText("Failed hard")).toBeInTheDocument();
  });

  it("paginates server-side and advances with Next", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    apiClient.get.mockResolvedValue(page([entry()], 45));
    render(<MyActivityPage />);
    expect(await screen.findByText("Page 1 of 3 (45 total)")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => {
      const last = apiClient.get.mock.calls.at(-1);
      expect(last[1].params.page).toBe(2);
    });
  });

  it("never renders any edit, delete, or export control", async () => {
    apiClient.get.mockResolvedValue(page([entry()]));
    render(<MyActivityPage />);
    await screen.findByText("LOGIN");
    for (const forbidden of ["Edit", "Delete", "Export", "Clear"]) {
      expect(screen.queryByRole("button", { name: forbidden })).not.toBeInTheDocument();
    }
  });
});
