import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import NewRequestPage from "./NewRequestPage";
import { apiClient } from "../../api/client";

vi.mock("../../api/client", () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));
let mockUser;
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: mockUser }) }));

function mockApi({ balance = 0, statesFail = false } = {}) {
  apiClient.get.mockImplementation((url) => {
    if (url === "/wallet/balance") return Promise.resolve({ data: { data: { balance } } });
    if (url === "/articles/states") return statesFail ? Promise.reject({ response: { status: 500, data: {} } }) : Promise.resolve({ data: { data: ["KA"] } });
    return Promise.resolve({ data: { data: [] } });
  });
}
const renderPage = () =>
  render(
    <MemoryRouter>
      <NewRequestPage />
    </MemoryRouter>
  );

beforeEach(() => {
  vi.clearAllMocks();
  mockUser = { role: "SUPER_ADMIN", permissions: ["estamp.create", "wallet.view"] };
});

describe("NewRequestPage - wallet balance and lookups", () => {
  it("links a Super Admin to /wallet when the balance is zero", async () => {
    mockApi({ balance: 0 });
    renderPage();
    expect(await screen.findByRole("link", { name: "Add money to the wallet" })).toHaveAttribute("href", "/wallet");
  });

  it("tells a USER (no wallet access) to ask the Super Admin instead of linking", async () => {
    mockUser = { role: "USER", permissions: ["estamp.create"] };
    mockApi({ balance: 0 });
    renderPage();
    expect(await screen.findByText("Ask your Super Admin to add funds.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Add money to the wallet" })).not.toBeInTheDocument();
  });

  it("shows an error when states cannot be loaded instead of an empty dropdown", async () => {
    mockApi({ balance: 1000, statesFail: true });
    renderPage();
    expect(await screen.findByText("Could not load states. Refresh the page to try again.")).toBeInTheDocument();
  });
});

describe("NewRequestPage - available balance (ledger flow)", () => {
  it("uses the AVAILABLE balance (balance minus reserved) and warns with links to Wallet and Payments when it is zero", async () => {
    apiClient.get.mockImplementation((url) => {
      if (url === "/wallet/balance") return Promise.resolve({ data: { data: { balance: 500, reservedBalance: 500, availableBalance: 0 } } });
      return Promise.resolve({ data: { data: ["KA"] } });
    });
    renderPage();
    expect(await screen.findByText(/available balance is ₹0/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Payments" })).toHaveAttribute("href", "/payments");
    expect(screen.getByRole("link", { name: "Add money to the wallet" })).toHaveAttribute("href", "/wallet");
  });
});
