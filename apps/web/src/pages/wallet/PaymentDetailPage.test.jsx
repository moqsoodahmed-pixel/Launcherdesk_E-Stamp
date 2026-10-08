import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import PaymentDetailPage from "./PaymentDetailPage";
import { apiClient } from "../../api/client";

vi.mock("../../api/client", () => ({
  apiClient: { get: vi.fn() },
}));

function renderAt(id, response) {
  apiClient.get.mockImplementation(() => (response.ok ? Promise.resolve({ data: { data: response.data } }) : Promise.reject(response.error)));
  return render(
    <MemoryRouter initialEntries={[`/payments/${id}`]}>
      <Routes>
        <Route path="/payments/:id" element={<PaymentDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PaymentDetailPage - successful payment", () => {
  it("renders amount, status, provider identifiers, and dates", async () => {
    renderAt("p1", {
      ok: true,
      data: {
        _id: "p1",
        amount: 500,
        currency: "INR",
        status: "SUCCESS",
        razorpayOrderId: "order_xyz",
        razorpayPaymentId: "pay_xyz",
        createdAt: "2026-01-01T10:00:00.000Z",
        verifiedAt: "2026-01-01T10:05:00.000Z",
        walletEffect: null,
      },
    });

    expect((await screen.findAllByText("₹500")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("SUCCESS").length).toBeGreaterThan(0);
    expect(screen.getByText("order_xyz")).toBeInTheDocument();
    expect(screen.getByText("pay_xyz")).toBeInTheDocument();
    expect(screen.getByText("Payment created")).toBeInTheDocument();
    expect(screen.getByText("Payment verified")).toBeInTheDocument();
  });
});

describe("PaymentDetailPage - failed payment", () => {
  it("shows the backend failure reason when supplied", async () => {
    renderAt("p2", {
      ok: true,
      data: {
        _id: "p2",
        amount: 200,
        status: "FAILED",
        razorpayOrderId: "order_f",
        failureReason: "Card declined by issuing bank",
        createdAt: "2026-01-01T10:00:00.000Z",
        walletEffect: null,
      },
    });

    expect(await screen.findByText("Payment Failed")).toBeInTheDocument();
    expect(screen.getByText("Card declined by issuing bank")).toBeInTheDocument();
  });

  it("falls back to a safe generic message when no failure reason is present", async () => {
    renderAt("p3", {
      ok: true,
      data: { _id: "p3", amount: 200, status: "FAILED", razorpayOrderId: "order_g", createdAt: "2026-01-01T10:00:00.000Z", walletEffect: null },
    });

    expect(await screen.findByText("Payment could not be completed.")).toBeInTheDocument();
  });
});

describe("PaymentDetailPage - wallet effect", () => {
  it("shows the wallet credit when walletEffect is present", async () => {
    renderAt("p4", {
      ok: true,
      data: {
        _id: "p4",
        amount: 1000,
        status: "SUCCESS",
        razorpayOrderId: "order_h",
        createdAt: "2026-01-01T10:00:00.000Z",
        verifiedAt: "2026-01-01T10:01:00.000Z",
        walletEffect: { type: "CREDIT", amount: 1000, balanceAfter: 5000, at: "2026-01-01T10:01:05.000Z" },
      },
    });

    expect(await screen.findByText("Wallet Credit")).toBeInTheDocument();
    expect(screen.getByText("+ ₹1,000")).toBeInTheDocument();
    expect(screen.getByText("Wallet credited")).toBeInTheDocument();
  });

  it("renders correctly when no credit is recorded for a visible, non-credit wallet effect", async () => {
    renderAt("p5", {
      ok: true,
      data: {
        _id: "p5",
        amount: 300,
        status: "CREATED",
        razorpayOrderId: "order_i",
        createdAt: "2026-01-01T10:00:00.000Z",
        walletEffect: { type: "DEBIT", amount: 300, balanceAfter: 100, at: "2026-01-01T10:00:00.000Z" },
      },
    });

    expect(await screen.findByText("No wallet credit has been recorded for this payment.")).toBeInTheDocument();
  });

  it("renders correctly when walletEffect is simply absent (undefined) - not every payment (e.g. CREATED/FAILED) has a credit", async () => {
    renderAt("p5b", {
      ok: true,
      data: { _id: "p5b", amount: 300, status: "CREATED", razorpayOrderId: "order_ib", createdAt: "2026-01-01T10:00:00.000Z", walletEffect: undefined },
    });

    // undefined is treated the same as null - the ledger section degrades
    // gracefully rather than crashing, even though the page still renders.
    expect(await screen.findByText("The wallet ledger is not visible to your account.")).toBeInTheDocument();
  });

  it("tells a viewer without wallet visibility that the ledger isn't visible to them, rather than hiding the whole page", async () => {
    renderAt("p6", {
      ok: true,
      data: { _id: "p6", amount: 300, status: "SUCCESS", razorpayOrderId: "order_j", createdAt: "2026-01-01T10:00:00.000Z", walletEffect: null },
    });

    expect(await screen.findByText("The wallet ledger is not visible to your account.")).toBeInTheDocument();
  });
});

describe("PaymentDetailPage - authorization / not found", () => {
  it("shows a 403-specific message without leaking details", async () => {
    renderAt("p7", { ok: false, error: { response: { status: 403 } } });
    expect(await screen.findByText("You do not have permission to access financial information.")).toBeInTheDocument();
  });

  it("shows a generic not-found message for a cross-tenant or missing payment (backend returns 404, never distinguishing the two)", async () => {
    renderAt("p8", { ok: false, error: { response: { status: 404 }, message: "Not found" } });
    expect(await screen.findByText(/Payment not found|Failed to load payment/)).toBeInTheDocument();
  });
});
