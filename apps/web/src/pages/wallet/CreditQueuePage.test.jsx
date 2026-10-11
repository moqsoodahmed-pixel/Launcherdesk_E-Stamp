import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import CreditQueuePage from "./CreditQueuePage";
import { apiClient } from "../../api/client";

vi.mock("../../api/client", () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));

const PAYMENT = { _id: "p1", amount: 1500, status: "SUCCESS", balanceStatus: "PENDING_CREDIT", razorpayPaymentId: "pay_ABC", organizationName: "Acme", verifiedAt: "2026-10-01T10:00:00Z" };
const ok = (data) => Promise.resolve({ data: { data } });

function mockApi({ queue = () => ok({ items: [PAYMENT], total: 1 }), orgs = [{ _id: "o1", name: "Acme" }] } = {}) {
  apiClient.get.mockImplementation((url) => {
    if (url === "/payments") return queue();
    if (url === "/organizations") return ok({ items: orgs });
    if (url === "/wallet/o1/balance") return ok({ balance: 2000, reservedBalance: 500, availableBalance: 1500 });
    if (url === "/wallet/o1/transactions") return ok({ items: [{ _id: "t1", type: "DEBIT", amount: 500, description: "E-Stamp request LDE-REQ-1" }] });
    return ok({});
  });
}

const renderPage = () =>
  render(
    <MemoryRouter>
      <CreditQueuePage />
    </MemoryRouter>
  );

beforeEach(() => vi.clearAllMocks());

describe("CreditQueuePage", () => {
  it("loads the PENDING_CREDIT queue and each organization's balance, reserved amount and ledger", async () => {
    mockApi();
    renderPage();
    expect(screen.getAllByRole("status")[0]).toHaveTextContent(/Loading/);
    expect(await screen.findByText("pay_ABC")).toBeInTheDocument();
    const queueCall = apiClient.get.mock.calls.find(([u]) => u === "/payments");
    expect(queueCall[1].params.balanceStatus).toBe("PENDING_CREDIT");
    expect(await screen.findByText("E-Stamp request LDE-REQ-1")).toBeInTheDocument();
    expect(screen.getByText("₹500", { selector: "dd" })).toBeInTheDocument(); // reserved
  });

  it("shows the empty state when nothing is pending, and when no organization is assigned", async () => {
    mockApi({ queue: () => ok({ items: [], total: 0 }), orgs: [] });
    renderPage();
    expect(await screen.findByText("Nothing to credit")).toBeInTheDocument();
    expect(await screen.findByText("No organizations assigned to you")).toBeInTheDocument();
  });

  it("shows an error with Retry", async () => {
    let n = 0;
    mockApi({ queue: () => (++n === 1 ? Promise.reject({ response: { status: 500, data: {} } }) : ok({ items: [PAYMENT], total: 1 })) });
    renderPage();
    expect(await screen.findByText("Failed to load payments to credit.")).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: "Retry" })[0]);
    expect(await screen.findByText("pay_ABC")).toBeInTheDocument();
  });

  it("credits only after confirming in the dialog, then refreshes the queue", async () => {
    mockApi();
    apiClient.post.mockReturnValue(ok({}));
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /Credit ₹1,500 to Acme balance/ }));
    const dialog = screen.getByRole("dialog");
    expect(apiClient.post).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole("button", { name: "Credit to balance" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/payments/p1/credit-balance"));
    expect(await screen.findByText(/credited to Acme's balance/)).toBeInTheDocument();
    expect(apiClient.get.mock.calls.filter(([u]) => u === "/payments").length).toBeGreaterThan(1);
  });

  it("cancel closes the dialog without crediting; 409 and 403 show clear messages", async () => {
    mockApi();
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /Credit ₹1,500/ }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    apiClient.post.mockRejectedValueOnce({ response: { status: 409, data: { message: "This payment has already been credited to the balance" } } });
    await userEvent.click(screen.getByRole("button", { name: /Credit ₹1,500/ }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Credit to balance" }));
    expect(await screen.findByText("This payment has already been credited to the balance")).toBeInTheDocument();

    apiClient.post.mockRejectedValueOnce({ response: { status: 403, data: {} } });
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Credit to balance" }));
    expect(await screen.findByText("You can only credit payments of organizations assigned to you.")).toBeInTheDocument();
  });
});
