import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InvoiceModal from "./InvoiceModal";
import { apiClient } from "../../api/client";

vi.mock("../../api/client", () => ({ apiClient: { get: vi.fn() } }));

const payment = {
  _id: "pay123",
  amount: 1000,
  plan: "Wallet Top-up & E-Stamping Balance",
  razorpayPaymentId: "pay_abc",
  status: "SUCCESS",
  createdAt: "2026-01-01T00:00:00.000Z",
  invoiceNumber: "INV-2026-ABC123",
};

beforeEach(() => {
  apiClient.get.mockReset();
});

describe("InvoiceModal - no fabricated tax figures", () => {
  it("never shows a GST/CGST/SGST breakdown or a fabricated GSTIN for a wallet top-up with no tax", () => {
    render(<InvoiceModal payment={payment} organizationName="Acme" userName="Jeevan" userEmail="j@x.test" onClose={() => {}} />);
    expect(screen.queryByText(/CGST/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/SGST/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/GST \(18%\)/i)).not.toBeInTheDocument();
    expect(screen.queryByText("29AABCL1234F1Z5")).not.toBeInTheDocument();
    expect(screen.getByText(/29AAMCD2048Q1ZY/)).toBeInTheDocument();
    expect(screen.getByText(/No GST is levied/i)).toBeInTheDocument();
  });

  it("shows the full amount as the total, not a GST-stripped taxable value", () => {
    render(<InvoiceModal payment={payment} organizationName="Acme" onClose={() => {}} />);
    // Two cells (line item + total) both show the full ₹1,000 - never
    // a GST-stripped split like ₹847 taxable + ₹153 GST.
    expect(screen.getAllByText("₹1,000").length).toBeGreaterThanOrEqual(2);
  });
});

describe("InvoiceModal - real PDF download", () => {
  it("downloads the real branded invoice from the backend instead of calling window.print", async () => {
    const u = userEvent.setup();
    const blob = new Blob(["%PDF-fake"], { type: "application/pdf" });
    apiClient.get.mockResolvedValue({ data: blob });
    const createObjectURL = vi.fn().mockReturnValue("blob:fake-url");
    const revokeObjectURL = vi.fn();
    window.URL.createObjectURL = createObjectURL;
    window.URL.revokeObjectURL = revokeObjectURL;
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {});

    render(<InvoiceModal payment={payment} organizationName="Acme" onClose={() => {}} />);
    await u.click(screen.getByRole("button", { name: /Download Invoice/i }));

    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith("/payments/pay123/invoice", { responseType: "blob" }));
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:fake-url");
    expect(printSpy).not.toHaveBeenCalled();
  });

  it("shows an error message if the download fails, without crashing", async () => {
    const u = userEvent.setup();
    apiClient.get.mockRejectedValue({ response: { data: { message: "Invoice is only available for successful payments" } } });
    render(<InvoiceModal payment={payment} organizationName="Acme" onClose={() => {}} />);
    await u.click(screen.getByRole("button", { name: /Download Invoice/i }));
    expect(await screen.findByText(/Invoice is only available for successful payments|Failed to download invoice/)).toBeInTheDocument();
  });
});
