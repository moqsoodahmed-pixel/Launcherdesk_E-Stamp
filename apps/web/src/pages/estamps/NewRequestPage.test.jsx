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

describe("NewRequestPage - who pays the stamp duty", () => {
  // Reproduces the reported bug: both parties entered as "das", which made
  // BOTH payer buttons render as selected at once.
  async function goToFinancialDetails({ firstParty = "das", secondParty = "das" } = {}) {
    apiClient.get.mockImplementation((url) => {
      if (url === "/wallet/balance") return Promise.resolve({ data: { data: { balance: 1000 } } });
      if (url === "/states") return Promise.resolve({ data: { data: [{ code: "KA", name: "Karnataka" }] } });
      if (url === "/articles") return Promise.resolve({ data: { data: [{ _id: "a1", articleCode: "5", title: "General Agreement" }] } });
      return Promise.resolve({ data: { data: [] } });
    });
    renderPage();
    fireEvent.change(screen.getByLabelText("First Party"), { target: { value: firstParty } });
    fireEvent.change(screen.getByLabelText("Second Party"), { target: { value: secondParty } });
    fireEvent.change(screen.getByLabelText("Description of Document"), { target: { value: "Agreement for testing purposes only" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    const stateSelect = await screen.findByRole("combobox", { name: /state/i });
    fireEvent.change(stateSelect, { target: { value: "KA" } });
    const articleSelect = await screen.findByRole("combobox", { name: /article/i });
    await waitFor(() => expect(screen.getByRole("option", { name: /5 - General Agreement/ })).toBeInTheDocument());
    fireEvent.change(articleSelect, { target: { value: "a1" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByLabelText(/Consideration Price/);
  }

  it("selects only ONE party when both parties share the same name", async () => {
    await goToFinancialDetails({ firstParty: "das", secondParty: "das" });
    const first = screen.getByRole("button", { name: "das (First Party)" });
    const second = screen.getByRole("button", { name: "das (Second Party)" });

    // Nothing is selected until the user picks.
    expect(first).toHaveAttribute("aria-pressed", "false");
    expect(second).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(first);
    expect(first).toHaveAttribute("aria-pressed", "true");
    expect(second).toHaveAttribute("aria-pressed", "false");

    // Picking the other identically-named party moves the selection
    // instead of lighting both up.
    fireEvent.click(second);
    expect(first).toHaveAttribute("aria-pressed", "false");
    expect(second).toHaveAttribute("aria-pressed", "true");
  });

  it("still selects exactly one party when the names differ", async () => {
    await goToFinancialDetails({ firstParty: "Alice", secondParty: "Bob" });
    fireEvent.click(screen.getByRole("button", { name: "Bob (Second Party)" }));
    expect(screen.getByRole("button", { name: "Alice (First Party)" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Bob (Second Party)" })).toHaveAttribute("aria-pressed", "true");
  });

  it("names which party pays on the review screen, not just the shared name", async () => {
    apiClient.post.mockImplementation((url) => {
      if (url === "/estamps/calculate") return Promise.resolve({ data: { data: { amount: 500, articleVersionUsed: 1, pricing: null } } });
      return Promise.resolve({ data: { data: {} } });
    });
    await goToFinancialDetails({ firstParty: "das", secondParty: "das" });
    fireEvent.change(screen.getByLabelText(/Consideration Price/), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "das (Second Party)" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await screen.findByText("Create Request");
    expect(screen.getByText("das (Second Party)")).toBeInTheDocument();
  });
});

describe("NewRequestPage - Review & Submit", () => {
  // The exact breakdown the backend returns for a ₹500 duty (and the exact
  // figures captured in LauncherDesk's own published price summary).
  const PRICING_500 = {
    stampDuty: 500,
    convenienceFee: 0,
    procurementFee: 15,
    feeTotal: 15,
    gst: 2.7,
    governmentFees: 500,
    totalAmount: 517.7,
  };
  const PRICING_UNKNOWN = {
    stampDuty: 0,
    convenienceFee: 0,
    procurementFee: 15,
    feeTotal: 15,
    gst: 2.7,
    governmentFees: 0,
    totalAmount: 17.7,
  };

  function mockFullFlow({ submitError, amount = 0, pricing = PRICING_UNKNOWN, calcError } = {}) {
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
      if (url === "/estamps/calculate") {
        return calcError ? Promise.reject(calcError) : Promise.resolve({ data: { data: { amount, articleVersionUsed: 1, pricing } } });
      }
      if (url === "/estamps") {
        return submitError ? Promise.reject(submitError) : Promise.resolve({ data: { data: { request: { _id: "r1", requestNumber: "LDE-REQ-1", calculatedStampDuty: amount } } } });
      }
      return Promise.resolve({ data: { data: {} } });
    });
  }

  // Four steps now - there is no Calculation step to click through; the
  // price is worked out automatically on arriving at Review.
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

    await screen.findByText("Create Request");
  }

  it("has no Calculation step - the wizard is four steps ending at Review & Submit", async () => {
    mockFullFlow();
    renderPage();
    await screen.findByText("1. Basic Details");
    expect(screen.queryByText(/Calculation/)).not.toBeInTheDocument();
    expect(screen.getByText("4. Review & Submit")).toBeInTheDocument();
    expect(screen.queryByText("5. Review & Submit")).not.toBeInTheDocument();
  });

  it("calculates automatically on reaching Review - no Calculate button to press", async () => {
    mockFullFlow({ amount: 500, pricing: PRICING_500 });
    await navigateToReview();
    expect(await screen.findByText("Price summary")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Calculate/ })).not.toBeInTheDocument();
    expect(apiClient.post).toHaveBeenCalledWith("/estamps/calculate", expect.objectContaining({ stateCode: "KA", articleId: "a1" }));
  });

  it("shows the selected Article and State by full name on the review screen", async () => {
    mockFullFlow();
    await navigateToReview();
    expect(screen.getByText("5 - General Agreement")).toBeInTheDocument();
    expect(screen.getByText("Karnataka")).toBeInTheDocument();
  });

  it("renders the full published breakdown verbatim from the server for a ₹500 duty", async () => {
    mockFullFlow({ amount: 500, pricing: PRICING_500 });
    await navigateToReview();
    await screen.findByText("Price summary");
    expect(screen.getByText("Convenience Fee")).toBeInTheDocument();
    expect(screen.getByText("Procurement Charge")).toBeInTheDocument();
    expect(screen.getByText("GST (18%)")).toBeInTheDocument();
    expect(screen.getByText("₹15")).toBeInTheDocument();
    expect(screen.getByText("₹2.7")).toBeInTheDocument();
    expect(screen.getByText("Total payable")).toBeInTheDocument();
    expect(screen.getByText("₹517.7")).toBeInTheDocument();
    // Stamp duty itself is a known, real number here - but Government Fees
    // is a disclosure that the duty is billed at the real government rate,
    // not a figure LauncherDesk invented, so it always reads "At Actuals"
    // even when that rate is already known.
    expect(screen.getByText("Government Fees").parentElement).toHaveTextContent("At Actuals");
    expect(screen.getByText("Stamp duty").parentElement).not.toHaveTextContent("At Actuals");
  });

  it("shows the real stamp duty amount (never 'At Actuals') while Government Fees keeps its own 'At Actuals' disclosure, and the total is always a real number", async () => {
    mockFullFlow({ amount: 0, pricing: PRICING_UNKNOWN });
    await navigateToReview();
    await screen.findByText("Price summary");
    // Stamp duty always shows the real figure (₹0 here, since the article's
    // duty isn't configured) - only Government Fees reads "At Actuals".
    expect(screen.getAllByText("At Actuals")).toHaveLength(1);
    expect(screen.getByText("Government Fees").parentElement).toHaveTextContent("At Actuals");
    expect(screen.getAllByText("Stamp Duty")[0].parentElement).not.toHaveTextContent("At Actuals");
    expect(screen.getByText("Stamp duty").parentElement).not.toHaveTextContent("At Actuals");
    // The total is never left blank/"-" - it's the known fee+GST portion,
    // even while the government duty component is still unknown.
    expect(screen.getByText("Total payable").parentElement).toHaveTextContent("₹17.7");
    expect(screen.getByText("Total payable").parentElement).not.toHaveTextContent("-");
    // The known fees are still quoted exactly, even with the duty unknown.
    expect(screen.getByText("Procurement Charge").parentElement).toHaveTextContent("₹15");
    expect(screen.getByText(/billed at the real government charge/)).toBeInTheDocument();
  });

  it("offers a Retry instead of looping forever when the price lookup fails", async () => {
    mockFullFlow({ calcError: { response: { status: 500, data: { message: "Pricing service down" } } } });
    await navigateToReview();
    expect(await screen.findByRole("button", { name: "Retry" })).toBeInTheDocument();
    const callsAfterFailure = apiClient.post.mock.calls.filter((c) => c[0] === "/estamps/calculate").length;
    expect(callsAfterFailure).toBe(1);
  });

  it("shows the backend's real reason on a submission 403, not a generic permission message", async () => {
    mockFullFlow({ amount: 500, pricing: PRICING_500, submitError: { response: { status: 403, data: { message: "E-Stamp service is not enabled for your organization" } } } });
    await navigateToReview();
    await screen.findByText("Price summary");
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
