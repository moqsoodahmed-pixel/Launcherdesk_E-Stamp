import { X } from "lucide-react";
import { useState } from "react";
import { apiClient } from "../../api/client";
import { formatCurrency, actionErrorMessage } from "../../utils/format";

export default function InvoiceModal({ payment, organizationName, userName, userEmail, onClose }) {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-midnight-900/50 p-4">
      <div className="bg-white rounded-dialog max-w-xl w-full p-6 sm:p-8 space-y-6 shadow-overlay border border-slate-200">
        <div className="flex justify-between items-start border-b border-slate-100 pb-4">
          <div>
            <h3 className="font-display text-lg font-semibold text-slate-900">LauncherDesk E-Stamp</h3>
            <p className="text-xs text-slate-500">Official Payment Receipt & Tax Invoice</p>
          </div>
          <button
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            aria-label="Close"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4 text-xs text-slate-600">
          <div>
            <p className="font-semibold text-slate-900">Invoice Number:</p>
            <p className="font-mono text-slate-700">{invNumber}</p>
            <p className="font-semibold text-slate-900 mt-2">Date:</p>
            <p>{dateStr}</p>
          </div>
          <div>
            <p className="font-semibold text-slate-900">Billed To:</p>
            <p className="text-slate-800 font-medium">{organizationName || "Client Organization"}</p>
            {userName && <p className="text-slate-600">{userName}</p>}
            {userEmail && <p className="text-slate-500">{userEmail}</p>}
          </div>
        </div>

        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="text-left p-2.5">Description</th>
                <th className="text-right p-2.5">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="p-2.5 text-slate-800">{planName}</td>
                <td className="p-2.5 text-right font-medium text-slate-900">{formatCurrency(payment.amount)}</td>
              </tr>
            </tbody>
            <tfoot className="border-t border-slate-200 font-semibold bg-slate-50/50">
              <tr>
                <td className="p-2.5 text-slate-900">Total Paid</td>
                <td className="p-2.5 text-right text-slate-900 text-sm">{formatCurrency(payment.amount)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="text-xs text-slate-500 space-y-1">
          <p>Payment Method: Razorpay Secure Gateway</p>
          <p className="font-mono">Transaction ID: {txId}</p>
          <p>
            Status: <span className="text-green-700 font-semibold">{payment.status || "SUCCESS"}</span>
          </p>
          <button
            onClick={handleViewTransaction}
            className="text-brand-600 hover:underline font-medium mt-1"
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

        <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
          <button
            onClick={() => window.print()}
            className="px-4 py-2 rounded-lg bg-brand-600 text-white text-xs font-semibold hover:bg-brand-700"
          >
            Print / Save PDF
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
