import { formatCurrency } from "../../utils/format";

export default function InvoiceModal({ payment, organizationName, userName, userEmail, onClose }) {
  if (!payment) return null;

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
        </div>

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
