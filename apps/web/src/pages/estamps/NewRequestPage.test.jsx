import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import NewRequestPage from "./NewRequestPage";
import { apiClient } from "../../api/client";

vi.mock("../../api/client", () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));
let mockUser;
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: mockUser }) }));

function mockApi({ balance = 0, statesFail = false } = {}) {
  apiClient.get.mockImplementation((url) => {
    if (url === "/wallet/balance") return Promise.resolve({ data: { data: { balance } } });
    if (url === "/states") return statesFail ? Promise.reject({ response: { status: 500, data: {} } }) : Promise.resolve({ data: { data: [{ code: "KA", name: "Karnataka" }] } });
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

describe("NewRequestPage - State & Article step uses the full state master", () => {
  it("lists every seeded state by full name and shows a no-articles message for a state with none imported", async () => {
    apiClient.get.mockImplementation((url, config) => {
      if (url === "/wallet/balance") return Promise.resolve({ data: { data: { balance: 1000 } } });
      if (url === "/states") {
        return Promise.resolve({
          data: {
            data: [
              { code: "DL", name: "Delhi" },
              { code: "KA", name: "Karnataka" },
            ],
          },
        });
      }
      if (url === "/articles") {
        const stateCode = config?.params?.stateCode;
        if (stateCode === "KA") {
          return Promise.resolve({ data: { data: [{ _id: "a1", articleCode: "41(e)", title: "Power of Attorney" }] } });
        }
        return Promise.resolve({ data: { data: [] } });
      }
      return Promise.resolve({ data: { data: [] } });
    });
    renderPage();

    // Fill required step-0 fields, then advance to Step 2 (State & Article).
    const inputs = screen.getAllByRole("textbox");
    // firstParty, secondParty, descriptionOfDocument are the first three text inputs.
    fireEvent.change(inputs[0], { target: { value: "Alice" } });
    fireEvent.change(inputs[1], { target: { value: "Bob" } });
    fireEvent.change(inputs[2], { target: { value: "Agreement for testing purposes only" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    const stateSelect = await screen.findByRole("combobox", { name: /state/i });
    expect(screen.getByRole("option", { name: "Delhi" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Karnataka" })).toBeInTheDocument();

    fireEvent.change(stateSelect, { target: { value: "DL" } });
    await waitFor(() => expect(screen.getByText("No official articles have been imported for this state yet.")).toBeInTheDocument());

    fireEvent.change(stateSelect, { target: { value: "KA" } });
    await waitFor(() => expect(screen.getByRole("option", { name: /41\(e\) - Power of Attorney/ })).toBeInTheDocument());
    expect(screen.queryByText("No official articles have been imported for this state yet.")).not.toBeInTheDocument();
  });
});

describe("NewRequestPage - Review & Submit", () => {
  function mockFullFlow({ submitError } = {}) {
    apiClient.get.mockImplementation((url, config) => {
      if (url === "/wallet/balance") return Promise.resolve({ data: { data: { balance: 1000 } } });
      if (url === "/states") return Promise.resolve({ data: { data: [{ code: "KA", name: "Karnataka" }] } });
      if (url === "/articles") {
        if (config?.params?.stateCode === "KA") {
          return Promise.resolve({ data: { data: [{ _id: "a1", articleCode: "5", title: "General Agreement" }] } });
        }
        return Promise.resolve({ data: { data: [] } });
      }
      return Promise.resolve({ data: { data: [] } });
    });
    apiClient.post.mockImplementation((url) => {
      if (url === "/estamps/calculate") return Promise.resolve({ data: { data: { amount: 0, articleVersionUsed: 1 } } });
      if (url === "/estamps") {
        return submitError ? Promise.reject(submitError) : Promise.resolve({ data: { data: { request: { _id: "r1", requestNumber: "LDE-REQ-1", calculatedStampDuty: 0 } } } });
      }
      return Promise.resolve({ data: { data: {} } });
    });
  }

  async function navigateToReview() {
    renderPage();
    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[0], { target: { value: "Alice" } });
    fireEvent.change(inputs[1], { target: { value: "Bob" } });
    fireEvent.change(inputs[2], { target: { value: "Agreement for testing purposes only" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    const stateSelect = await screen.findByRole("combobox", { name: /state/i });
    fireEvent.change(stateSelect, { target: { value: "KA" } });
    const articleSelect = await screen.findByRole("combobox", { name: /article/i });
    await waitFor(() => expect(screen.getByRole("option", { name: /5 - General Agreement/ })).toBeInTheDocument());
    fireEvent.change(articleSelect, { target: { value: "a1" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    const considerationInput = await screen.findByLabelText(/Consideration Price/);
    fireEvent.change(considerationInput, { target: { value: "100" } });
    fireEvent.click(await screen.findByText("Alice (First Party)"));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.click(await screen.findByRole("button", { name: "Calculate Stamp Duty" }));
    await screen.findByText("Estimated stamp duty:");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Create Request");
  }

  it("shows the selected Article and State by full name on the review screen", async () => {
    mockFullFlow();
    await navigateToReview();
    expect(screen.getByText("5 - General Agreement")).toBeInTheDocument();
    expect(screen.getByText("Karnataka")).toBeInTheDocument();
  });

  it("warns clearly when the calculated duty is ₹0 instead of silently showing it as a normal amount", async () => {
    mockFullFlow();
    await navigateToReview();
    expect(screen.getByText(/stamp duty rate has not been configured yet/)).toBeInTheDocument();
  });

  it("shows the backend's real reason on a submission 403, not a generic permission message", async () => {
    mockFullFlow({ submitError: { response: { status: 403, data: { message: "E-Stamp service is not enabled for your organization" } } } });
    await navigateToReview();
    fireEvent.click(screen.getByRole("button", { name: "Create Request" }));
    expect(await screen.findByText("E-Stamp service is not enabled for your organization")).toBeInTheDocument();
    expect(screen.queryByText("You do not have permission to view this.")).not.toBeInTheDocument();
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
