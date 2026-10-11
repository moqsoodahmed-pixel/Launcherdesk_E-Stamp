import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import ArticlesPage from "./ArticlesPage";
import { apiClient } from "../../api/client";

vi.mock("../../api/client", () => ({ apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
let mockUser;
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: mockUser }) }));

const article = { _id: "a1", stateCode: "KA", articleCode: "5(a)", title: "Agreement", currentVersion: 1, isActive: true };

beforeEach(() => {
  vi.clearAllMocks();
  mockUser = { role: "SUPER_ADMIN", permissions: ["article.view"] };
});

describe("ArticlesPage", () => {
  it("renders articles from the plain-array response", async () => {
    apiClient.get.mockResolvedValue({ data: { data: [article] } });
    render(<ArticlesPage />);
    expect(await screen.findByText("Agreement")).toBeInTheDocument();
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
  });

  it("stops loading on failure, shows the error and recovers with Retry", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const u = userEvent.setup();
    apiClient.get.mockRejectedValueOnce({ code: "ECONNABORTED", isAxiosError: true }).mockResolvedValue({ data: { data: [article] } });
    render(<ArticlesPage />);
    expect(await screen.findByText("Request timed out. Please try again.")).toBeInTheDocument();
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Agreement")).toBeInTheDocument();
  });

  it("shows an empty state when no articles match", async () => {
    apiClient.get.mockResolvedValue({ data: { data: [] } });
    render(<ArticlesPage />);
    expect(await screen.findByText("No articles found.")).toBeInTheDocument();
  });

  it("debounces the title search into one request", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const u = userEvent.setup();
    apiClient.get.mockResolvedValue({ data: { data: [] } });
    render(<ArticlesPage />);
    await screen.findByText("No articles found.");
    await u.type(screen.getByLabelText("Search articles"), "lease");
    await waitFor(() => expect(apiClient.get.mock.calls.at(-1)[1].params.search).toBe("lease"));
    expect(apiClient.get).toHaveBeenCalledTimes(2);
  });

  it("hides management actions from client roles", async () => {
    apiClient.get.mockResolvedValue({ data: { data: [article] } });
    render(<ArticlesPage />);
    await screen.findByText("Agreement");
    expect(screen.queryByRole("button", { name: "+ New Article" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Deactivate" })).not.toBeInTheDocument();
  });
});

describe("ArticlesPage - management form (Phase 2)", () => {
  it("only offers rule types the form can fully configure, and requires the amount", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const u = userEvent.setup();
    mockUser = { role: "MASTER_ADMIN", permissions: ["article.view", "article.manage"] };
    apiClient.get.mockResolvedValue({ data: { data: [] } });
    render(<ArticlesPage />);
    await u.click(await screen.findByRole("button", { name: "+ New Article" }));
    const select = screen.getByRole("combobox");
    expect(Array.from(select.querySelectorAll("option")).map((o) => o.value)).toEqual(["FIXED", "PERCENTAGE"]);
    expect(screen.getByLabelText("Fixed amount (₹)")).toBeRequired();
  });
});
