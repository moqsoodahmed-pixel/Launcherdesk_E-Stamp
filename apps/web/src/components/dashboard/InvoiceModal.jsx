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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
      <div className="bg-white rounded-2xl max-w-xl w-full p-6 sm:p-8 space-y-6 shadow-2xl border border-slate-200">
        <div className="flex justify-between items-start border-b border-slate-100 pb-4">
          <div>
            <h3 className="text-lg font-bold text-slate-900">LauncherDesk E-Stamp</h3>
            <p className="text-xs text-slate-500">Official Payment Receipt & Tax Invoice</p>
            <p className="text-[11px] text-slate-400 mt-0.5">Supplier: LauncherDesk Technologies Private Limited &middot; GSTIN: 29AABCL1234F1Z5</p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-lg leading-none p-1"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

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

        {(() => {
          const totalAmt = Number(payment.amount) || 0;
          const taxableAmt = Math.round((totalAmt / 1.18) * 100) / 100;
          const totalGst = Math.round((totalAmt - taxableAmt) * 100) / 100;
          const cgst = Math.round((totalGst / 2) * 100) / 100;
          const sgst = Math.round((totalGst - cgst) * 100) / 100;
          return (
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="text-left p-2.5">Item & Description</th>
                    <th className="text-center p-2.5">SAC</th>
                    <th className="text-right p-2.5">Taxable Value</th>
                    <th className="text-right p-2.5">GST (18%)</th>
                    <th className="text-right p-2.5">Total Amount</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-slate-100">
                    <td className="p-2.5 text-slate-800 font-medium">{planName}</td>
                    <td className="p-2.5 text-center text-slate-600 font-mono">998311</td>
                    <td className="p-2.5 text-right text-slate-700">{formatCurrency(taxableAmt)}</td>
                    <td className="p-2.5 text-right text-slate-700">{formatCurrency(totalGst)}</td>
                    <td className="p-2.5 text-right font-medium text-slate-900">{formatCurrency(totalAmt)}</td>
                  </tr>
                  <tr className="bg-slate-50/30 text-slate-500 text-[11px]">
                    <td colSpan={2} className="p-2 pl-2.5 italic">GST Split: CGST (9%): {formatCurrency(cgst)} | SGST (9%): {formatCurrency(sgst)}</td>
                    <td colSpan={3} className="p-2 text-right">Tax included in final total</td>
                  </tr>
                </tbody>
                <tfoot className="border-t border-slate-200 font-semibold bg-slate-50/50">
                  <tr>
                    <td colSpan={4} className="p-2.5 text-slate-900">Total Paid (INR)</td>
                    <td className="p-2.5 text-right text-slate-900 text-sm">{formatCurrency(totalAmt)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          );
        })()}

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
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-[11px] text-slate-600 space-y-1.5 font-mono">
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
            className="px-4 py-2 rounded-lg bg-brand-600 text-white text-xs font-semibold hover:bg-brand-700 shadow-sm"
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
