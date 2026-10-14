import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import EStampWorkspace from "./EStampWorkspace";
import { apiClient } from "../../api/client";

vi.mock("../../api/client", () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
}));

const mockUser = {
  id: "u123",
  name: "Chandu BG",
  email: "chandu@abctech.com",
  role: "SUPER_ADMIN",
  organizationName: "ABC Technologies",
};

const mockPayments = [
  {
    _id: "pay_1",
    amount: 1500,
    plan: "Pro Business Bundle",
    stampsCount: 100,
    status: "SUCCESS",
    invoiceNumber: "INV-2026-PAY1",
    razorpayPaymentId: "pay_rzp_mock123",
    createdAt: new Date().toISOString(),
  },
];

const mockOrders = [
  {
    _id: "ord_1",
    orderNumber: "LDE-ORD-001",
    status: "COMPLETED",
    eStampStatus: "ISSUED",
    amount: 500,
    createdAt: new Date().toISOString(),
  },
];

const mockPackages = [
  { key: "starter", name: "Starter E-Stamp Pack", stampsCount: 25, price: 500, description: "Small teams.", features: [], validityDays: null, recommended: false },
  { key: "pro", name: "Pro Business Bundle", stampsCount: 100, price: 1500, description: "Popular.", features: [], validityDays: null, recommended: true },
  { key: "enterprise", name: "Enterprise Bundle", stampsCount: 500, price: 6000, description: "Bulk.", features: [], validityDays: null, recommended: false },
];

beforeEach(() => {
  vi.clearAllMocks();
  apiClient.get.mockImplementation((url) => {
    if (url === "/wallet/balance") {
      return Promise.resolve({ data: { data: { availableBalance: 2500, balance: 2500, reservedBalance: 0 } } });
    }
    if (url === "/payments") {
      return Promise.resolve({ data: { data: { items: mockPayments, total: 1 } } });
    }
    if (url === "/orders") {
      return Promise.resolve({ data: { data: { items: mockOrders, total: 1 } } });
    }
    if (url === "/estamp-packages") {
      return Promise.resolve({ data: { data: mockPackages } });
    }
    return Promise.reject(new Error(`Unhandled URL: ${url}`));
  });
});

function renderWorkspace() {
  return render(
    <MemoryRouter>
      <EStampWorkspace user={mockUser} />
    </MemoryRouter>
  );
}

describe("EStampWorkspace Component", () => {
  it("renders Current Subscription, Orders, Purchase History, and Quick Actions", async () => {
    renderWorkspace();

    expect(await screen.findByText(/Dedicated E-Stamp Workspace/i)).toBeInTheDocument();
    expect(screen.getByText(/Current Subscription & Allocation/i)).toBeInTheDocument();
    expect(screen.getByText(/E-Stamp Orders/i)).toBeInTheDocument();
    expect(screen.getByText(/Purchase History & Receipts/i)).toBeInTheDocument();

    // Verify stats
    const planElements = await screen.findAllByText(/Pro Business Bundle/i);
    expect(planElements.length).toBeGreaterThan(0);
    expect(screen.getByText("INV-2026-PAY1")).toBeInTheDocument();
    expect(screen.getByText("LDE-ORD-001")).toBeInTheDocument();
  });

  it("clicking Buy More E-Stamps opens BuyMoreModal with bundle packages", async () => {
    renderWorkspace();

    const buyButtons = await screen.findAllByRole("button", { name: /Buy More E-Stamps/i });
    fireEvent.click(buyButtons[0]);

    expect(await screen.findByText(/Buy E-Stamps & Add Balance/i)).toBeInTheDocument();
    expect(await screen.findByText(/Starter E-Stamp Pack/i)).toBeInTheDocument();
    expect(screen.getByText(/Enterprise Bundle/i)).toBeInTheDocument();
    expect(screen.getByText(/Custom Amount Top-Up/i)).toBeInTheDocument();
  });

  it("clicking View Invoice opens InvoiceModal with official tax receipt", async () => {
    renderWorkspace();

    const invoiceBtn = await screen.findByRole("button", { name: /View Invoice/i });
    fireEvent.click(invoiceBtn);

    expect(await screen.findByText(/Official Payment Invoice/i)).toBeInTheDocument();
    expect(screen.getAllByText("INV-2026-PAY1").length).toBe(2);
    expect(screen.getByText("ABC Technologies")).toBeInTheDocument();
  });

  it("clicking Contact Support opens ContactSupportModal with SLA info", async () => {
    renderWorkspace();

    const supportBtn = await screen.findByRole("button", { name: /Contact Support/i });
    fireEvent.click(supportBtn);

    expect(await screen.findByText(/LauncherDesk Support/i)).toBeInTheDocument();
    expect(screen.getByText(/Priority SLA Active/i)).toBeInTheDocument();
  });
});
