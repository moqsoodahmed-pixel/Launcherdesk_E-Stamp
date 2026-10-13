import GstBreakdownTable from "../payments/GstBreakdownTable";
import { useViewerRole } from "../ui/StatusChip";
import { statusMeta, isClientRole } from "../ui/status";
import Modal from "../ui/Modal";
import { useState } from "react";
import { apiClient } from "../../api/client";
import { formatCurrency, actionErrorMessage } from "../../utils/format";

export default function InvoiceModal({ payment, organizationName, userName, userEmail, onClose }) {
  const viewerRole = useViewerRole();
  const [txDetail, setTxDetail] = useState(null);
  const [txLoading, setTxLoading] = useState(false);
  const [txError, setTxError] = useState(null);

  if (!payment) return null;

  async function handleViewTransaction() {
    if (txDetail) {
      setTxDetail(null);
      return;
    }
    setTxLoading(true);
    setTxError(null);
    try {
      const { data } = await apiClient.get(`/payments/${payment._id}`);
      setTxDetail(data.data);
    } catch (err) {
      setTxError(actionErrorMessage(err, "Failed to load transaction details."));
    } finally {
      setTxLoading(false);
    }
  }

  const invNumber =
    payment.invoiceNumber ||
    `INV-${new Date(payment.createdAt || Date.now()).getFullYear()}-${(payment._id || "").toString().slice(-6).toUpperCase()}`;
  const txId = payment.razorpayPaymentId || payment.razorpayOrderId || "N/A";
  const planName = payment.plan || "Wallet Top-up & E-Stamping Balance";
  const dateStr = payment.createdAt ? new Date(payment.createdAt).toLocaleDateString("en-IN") : new Date().toLocaleDateString("en-IN");

  return (
    <Modal
      title="LauncherDesk E-Stamp"
      description="Official Payment Receipt & Tax Invoice"
      onClose={onClose}
      size="lg"
      footer={
        <button type="button" onClick={() => window.print()} className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-brand-600 px-4 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50 sm:min-h-[40px]">
          Print / Save PDF
        </button>
      }
    >
      <div className="space-y-6">
        <p className="-mt-3 text-xs text-slate-600">Supplier: LauncherDesk Technologies Private Limited &middot; GSTIN: 29AABCL1234F1Z5</p>

        <div className="grid grid-cols-2 gap-4 text-xs text-slate-600">
          <div>
            <p className="font-semibold text-slate-900">Invoice Number:</p>
            <p className="font-mono text-slate-700">{invNumber}</p>
            <p className="font-semibold text-slate-900 mt-2">Date:</p>
            <p>{dateStr}</p>
            <p className="font-semibold text-slate-900 mt-2">SAC / HSN Code:</p>
            <p className="font-mono">998311 (Legal & Certification support)</p>
          </div>
          <div>
            <p className="font-semibold text-slate-900">Billed To:</p>
            <p className="text-slate-800 font-medium">{organizationName || "Client Organization"}</p>
            {userName && <p className="text-slate-600">{userName}</p>}
            {userEmail && <p className="text-slate-500">{userEmail}</p>}
            <p className="font-semibold text-slate-900 mt-2">Place of Supply:</p>
            <p>India (Standard Interstate / Intrastate)</p>
          </div>
        </div>

        <GstBreakdownTable amount={payment.amount} description={planName} />

        <div className="text-xs text-slate-500 space-y-1">
          <p>Payment Method: Razorpay Secure Gateway</p>
          <p className="font-mono">Transaction ID: {txId}</p>
          <p>
            Status: <span className="font-semibold text-emerald-700">{statusMeta(payment.status || "SUCCESS", { kind: "payment", client: isClientRole(viewerRole) }).label}</span>
          </p>
          <button
            onClick={handleViewTransaction}
            className="mt-1 min-h-[36px] font-medium text-brand-700 hover:underline"
          >
            {txLoading ? "Loading transaction..." : txDetail ? "Hide transaction details" : "View Transaction →"}
          </button>
        </div>

        {txError && (
          <div className="rounded-lg bg-red-50 text-red-700 text-xs px-3 py-2 border border-red-200">{txError}</div>
        )}

        {txDetail && (
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs text-slate-600 space-y-1.5 font-mono">
            <div className="flex justify-between"><span>Razorpay Order ID</span><span>{txDetail.razorpayOrderId || "-"}</span></div>
            <div className="flex justify-between"><span>Razorpay Payment ID</span><span>{txDetail.razorpayPaymentId || "-"}</span></div>
            <div className="flex justify-between"><span>Verified At</span><span>{txDetail.verifiedAt ? new Date(txDetail.verifiedAt).toLocaleString("en-IN") : "-"}</span></div>
            <div className="flex justify-between">
              <span>Wallet Effect</span>
              <span>
                {txDetail.walletEffect?.credited === false
                  ? "Not yet credited"
                  : txDetail.walletEffect
                  ? `${txDetail.walletEffect.type} ₹${txDetail.walletEffect.amount}`
                  : "Not available"}
              </span>
            </div>
          </div>
        )}

      </div>
    </Modal>
  );
}
