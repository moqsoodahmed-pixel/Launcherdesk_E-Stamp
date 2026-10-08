import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import WalletPage from "./WalletPage";
import { apiClient } from "../../api/client";
import { useAuth } from "../../context/AuthContext";

vi.mock("../../api/client", () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
}));
vi.mock("../../context/AuthContext", () => ({
  useAuth: vi.fn(),
}));

const PERMS = {
  all: ["wallet.view", "payment.view", "payment.manage", "report.view", "report.financial_view"],
  none: [],
};

function tenantUser(permissions) {
  return { role: "SUPER_ADMIN", organizationId: "org-1", permissions };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <WalletPage />
    </MemoryRouter>
  );
}

function mockGet(routes) {
  apiClient.get.mockImplementation((url) => {
    for (const [pattern, result] of routes) {
      if (pattern.test(url)) {
        return result.ok ? Promise.resolve({ data: { data: result.data } }) : Promise.reject(result.error);
      }
    }
    return Promise.reject(new Error(`Unhandled GET ${url}`));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("WalletPage - balance", () => {
  it("renders the server-provided balance verbatim, never computing it locally", async () => {
    useAuth.mockReturnValue({ user: tenantUser(PERMS.all) });
    mockGet([
      [/\/wallet\/balance/, { ok: true, data: { balance: 12345.67 } }],
      [/\/wallet\/transactions/, { ok: true, data: { items: [] } }],
      [/\/payments/, { ok: true, data: { items: [] } }],
      [/\/reports\/financial/, { ok: true, data: { payments: { successfulAmount: 0, successfulCount: 0, failedAmount: 0, failedCount: 0 }, walletTransactions: { totalCredits: 0, totalDebits: 0, creditCount: 0, debitCount: 0 } } }],
    ]);

    renderPage();

    expect(await screen.findByText("₹12,345.67")).toBeInTheDocument();
    // Only the /wallet/balance GET result feeds this figure - no client-side
    // derivation from payments/transactions, which the component never even
    // references when computing `balance`.
    const balanceCalls = apiClient.get.mock.calls.filter(([u]) => /\/wallet\/balance/.test(u));
    expect(balanceCalls.length).toBeGreaterThan(0);
  });
});

describe("WalletPage - permission gating", () => {
  it("hides wallet balance/transactions sections entirely without wallet.view", async () => {
    useAuth.mockReturnValue({ user: tenantUser(["payment.view"]) });
    mockGet([[/\/payments/, { ok: true, data: { items: [] } }]]);

    renderPage();

    await screen.findByText("Recent payments");
    expect(screen.queryByText("Available balance")).not.toBeInTheDocument();
    expect(screen.queryByText("Recent wallet transactions")).not.toBeInTheDocument();
    expect(apiClient.get).not.toHaveBeenCalledWith(expect.stringMatching(/\/wallet\/balance/), expect.anything());
  });

  it("hides the payments section entirely without payment.view", async () => {
    useAuth.mockReturnValue({ user: tenantUser(["wallet.view"]) });
    mockGet([
      [/\/wallet\/balance/, { ok: true, data: { balance: 0 } }],
      [/\/wallet\/transactions/, { ok: true, data: { items: [] } }],
    ]);

    renderPage();

    await screen.findByText("Available balance");
    expect(screen.queryByText("Recent payments")).not.toBeInTheDocument();
  });

  it("hides Add Money without payment.manage", async () => {
    useAuth.mockReturnValue({ user: tenantUser(["wallet.view"]) });
    mockGet([
      [/\/wallet\/balance/, { ok: true, data: { balance: 0 } }],
      [/\/wallet\/transactions/, { ok: true, data: { items: [] } }],
    ]);

    renderPage();

    await screen.findByText("Available balance");
    expect(screen.queryByText("Add money")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Amount in rupees")).not.toBeInTheDocument();
  });

  it("shows Add Money when payment.manage is granted", async () => {
    useAuth.mockReturnValue({ user: tenantUser(["wallet.view", "payment.manage"]) });
    mockGet([
      [/\/wallet\/balance/, { ok: true, data: { balance: 0 } }],
      [/\/wallet\/transactions/, { ok: true, data: { items: [] } }],
    ]);

    renderPage();

    expect(await screen.findByText("Add money")).toBeInTheDocument();
  });

  it("shows the financial summary only when BOTH report.view and report.financial_view are present", async () => {
    useAuth.mockReturnValue({ user: tenantUser(["wallet.view", "report.view"]) }); // missing report.financial_view
    mockGet([
      [/\/wallet\/balance/, { ok: true, data: { balance: 0 } }],
      [/\/wallet\/transactions/, { ok: true, data: { items: [] } }],
    ]);

    renderPage();

    await screen.findByText("Available balance");
    expect(screen.queryByText("Financial summary")).not.toBeInTheDocument();
    expect(apiClient.get).not.toHaveBeenCalledWith(expect.stringMatching(/\/reports\/financial/), expect.anything());
  });

  it("shows a no-access message with no financial permissions at all", () => {
    useAuth.mockReturnValue({ user: tenantUser(PERMS.none) });
    renderPage();
    expect(screen.getByText("You do not currently have financial access.")).toBeInTheDocument();
  });
});

describe("WalletPage - Add Money flow", () => {
  beforeEach(() => {
    delete window.Razorpay;
  });

  it("does not open checkout and shows a clear error when the gateway key is unavailable", async () => {
    useAuth.mockReturnValue({ user: tenantUser(["wallet.view", "payment.manage"]) });
    mockGet([
      [/\/wallet\/balance/, { ok: true, data: { balance: 100 } }],
      [/\/wallet\/transactions/, { ok: true, data: { items: [] } }],
    ]);
    apiClient.post.mockResolvedValue({ data: { data: { keyId: null, razorpayOrderId: "order_1", amount: 100 } } });

    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Add money");

    await user.type(screen.getByLabelText("Amount in rupees"), "100");
    await user.click(screen.getByRole("button", { name: /add money/i }));

    expect(await screen.findByText(/Payment gateway is not configured/i)).toBeInTheDocument();
    expect(window.Razorpay).toBeUndefined();
    // Balance must still read the server's last known value, never bumped locally.
    expect(screen.getByText("₹100")).toBeInTheDocument();
  });

  it("verifies via the server and refetches wallet/payment state - it never marks success from the Razorpay callback alone", async () => {
    useAuth.mockReturnValue({ user: tenantUser(["wallet.view", "payment.manage"]) });
    let balanceCallCount = 0;
    apiClient.get.mockImplementation((url) => {
      if (/\/wallet\/balance/.test(url)) {
        balanceCallCount += 1;
        // Server balance only changes once verify has actually been called.
        return Promise.resolve({ data: { data: { balance: balanceCallCount === 1 ? 100 : 200 } } });
      }
      if (/\/wallet\/transactions/.test(url)) return Promise.resolve({ data: { data: { items: [] } } });
      return Promise.reject(new Error(`Unhandled GET ${url}`));
    });
    apiClient.post.mockImplementation((url) => {
      if (url === "/payments/razorpay/order") {
        return Promise.resolve({ data: { data: { keyId: "rzp_test_key", razorpayOrderId: "order_1", amount: 100 } } });
      }
      if (url === "/payments/razorpay/verify") {
        return Promise.resolve({ data: { data: { status: "SUCCESS" } } });
      }
      return Promise.reject(new Error(`Unhandled POST ${url}`));
    });

    let capturedHandler;
    window.Razorpay = vi.fn().mockImplementation((opts) => {
      capturedHandler = opts.handler;
      return { open: vi.fn(), on: vi.fn() };
    });

    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("₹100");

    await user.type(screen.getByLabelText("Amount in rupees"), "100");
    await user.click(screen.getByRole("button", { name: /add money/i }));

    await waitFor(() => expect(window.Razorpay).toHaveBeenCalled());
    // Simulate Razorpay's success callback firing.
    await capturedHandler({ razorpay_order_id: "order_1", razorpay_payment_id: "pay_1", razorpay_signature: "sig_1" });

    expect(apiClient.post).toHaveBeenCalledWith("/payments/razorpay/verify", expect.objectContaining({ razorpay_order_id: "order_1" }));
    // The displayed balance only changes after the server's own GET responds
    // post-verify - a true refetch, not `balance += amount` client math.
    await waitFor(() => expect(screen.getByText("₹200")).toBeInTheDocument());
  });
});

describe("WalletPage - per-section error isolation", () => {
  it("renders the balance even when payments and financial summary both 403", async () => {
    useAuth.mockReturnValue({ user: tenantUser(PERMS.all) });
    mockGet([
      [/\/wallet\/balance/, { ok: true, data: { balance: 200 } }],
      [/\/wallet\/transactions/, { ok: true, data: { items: [] } }],
      [/\/payments/, { ok: false, error: { response: { status: 403 } } }],
      [/\/reports\/financial/, { ok: false, error: { response: { status: 403 } } }],
    ]);

    renderPage();

    expect(await screen.findByText("₹200")).toBeInTheDocument();
  });

  it("renders payments even when the balance call 403s", async () => {
    useAuth.mockReturnValue({ user: tenantUser(PERMS.all) });
    mockGet([
      [/\/wallet\/balance/, { ok: false, error: { response: { status: 403 } } }],
      [/\/wallet\/transactions/, { ok: false, error: { response: { status: 403 } } }],
      [/\/payments/, { ok: true, data: { items: [{ _id: "p1", amount: 50, status: "SUCCESS", createdAt: new Date().toISOString() }] } }],
      [/\/reports\/financial/, { ok: false, error: { response: { status: 403 } } }],
    ]);

    renderPage();

    await screen.findByText("Recent payments");
    expect(screen.getByText("₹50")).toBeInTheDocument();
  });

  it("isolates a 500 on one section without hiding other independently-available sections", async () => {
    useAuth.mockReturnValue({ user: tenantUser(PERMS.all) });
    mockGet([
      [/\/wallet\/balance/, { ok: true, data: { balance: 300 } }],
      [/\/wallet\/transactions/, { ok: true, data: { items: [] } }],
      [/\/payments/, { ok: false, error: { response: { status: 500 }, message: "boom" } }],
      [/\/reports\/financial/, { ok: true, data: { payments: { successfulAmount: 10, successfulCount: 1, failedAmount: 0, failedCount: 0 }, walletTransactions: { totalCredits: 10, totalDebits: 0, creditCount: 1, debitCount: 0 } } }],
    ]);

    renderPage();

    expect(await screen.findByText("₹300")).toBeInTheDocument();
    expect(await screen.findByText("Financial summary")).toBeInTheDocument();
    // Payments section stays mounted with its own error, not swallowed globally.
    expect(screen.getByText("Recent payments")).toBeInTheDocument();
  });
});
