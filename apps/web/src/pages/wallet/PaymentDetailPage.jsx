import { FileText, X } from "lucide-react";
import { useEffect, useState, useCallback } from "react";
import { Link, useParams } from "react-router-dom";
import { apiClient } from "../../api/client";
import { actionErrorMessage, formatCurrency } from "../../utils/format";
import PaymentStatusBadge from "../../components/payments/PaymentStatusBadge";
import BalanceStatusBadge, { balanceStatusOf } from "../../components/payments/BalanceStatusBadge";
import { useAuth } from "../../context/AuthContext";

const INTERNAL_ROLES = ["MASTER_ADMIN", "ASSISTANT_MASTER_ADMIN"];

function fmt(d) {
  return d ? new Date(d).toLocaleString() : "Not available";
}

export default function PaymentDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const isInternalActor = INTERNAL_ROLES.includes(user?.role);
  const [payment, setPayment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [reconcileResult, setReconcileResult] = useState(null);
  const [reconcileError, setReconcileError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    apiClient
      .get(`/payments/${id}`)
      .then((res) => setPayment(res.data.data))
      .catch((err) => setError(err?.response?.status === 403 ? "You do not have permission to access financial information." : actionErrorMessage(err, "Failed to load payment.")))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  function handleReconcile() {
    setReconciling(true);
    setReconcileError(null);
    setReconcileResult(null);
    apiClient
      .post(`/payments/${id}/reconcile`)
      .then((res) => {
        setReconcileResult(res.data.data);
        if (res.data.data.reconciled) load();
      })
      .catch((err) => setReconcileError(actionErrorMessage(err, "Could not check Razorpay for this payment.")))
      .finally(() => setReconciling(false));
  }

  if (loading) return <div className="p-8 text-center text-slate-500">Loading...</div>;
  if (error || !payment) {
    return (
      <div className="space-y-3">
        <Link to="/payments" className="inline-flex min-h-[36px] items-center text-sm text-slate-600 hover:text-slate-900 hover:underline">
          ← Payments
        </Link>
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
          {error || "Payment not found."}
        </div>
      </div>
    );
  }

  const effect = payment.walletEffect; // null when the viewer cannot see the wallet ledger
  const credited = effect && effect.type === "CREDIT";
  // Only the events the record itself evidences: creation, verification
  // (verifiedAt is set only on a confirmed SUCCESS), and the ledger entry.
  const timeline = [
    { label: "Payment created", at: payment.createdAt },
    payment.verifiedAt && { label: "Payment verified", at: payment.verifiedAt },
    credited && { label: "Wallet credited", at: effect.at },
  ].filter(Boolean);

  const orgName = payment.organizationName || (payment.organizationId && typeof payment.organizationId === "object" ? payment.organizationId.name : null);
  const userName = payment.createdByName || (payment.createdBy && typeof payment.createdBy === "object" ? payment.createdBy.name : null);
  const userEmail = payment.createdByEmail || (payment.createdBy && typeof payment.createdBy === "object" ? payment.createdBy.email : null);
  const txId = payment.transactionId || payment.razorpayPaymentId || payment.razorpayOrderId;
  const invNumber = payment.invoiceNumber || `INV-${new Date(payment.createdAt).getFullYear()}-${payment._id.slice(-6).toUpperCase()}`;

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link to="/payments" className="inline-flex min-h-[36px] items-center text-sm text-slate-600 hover:text-slate-900 hover:underline">
          ← Payments
        </Link>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-900 tabular-nums">{formatCurrency(payment.amount)}</h1>
            <p className="text-xs text-slate-500 mt-0.5">{payment.plan || "Wallet Top-up & E-Stamping Balance"}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowInvoiceModal(true)}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <FileText size={14} aria-hidden="true" /> View Invoice
            </button>
            <PaymentStatusBadge status={payment.status} />
          </div>
        </div>
      </div>

      {payment.status === "FAILED" && (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5">
          <h2 className="font-medium text-red-800">Payment Failed</h2>
          <p className="text-sm text-red-900 mt-1 break-words">{payment.failureReason || "Payment could not be completed."}</p>
        </div>
      )}

      {isInternalActor && (payment.status === "CREATED" || payment.status === "FAILED") && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 space-y-3">
          <div>
            <h2 className="font-medium text-amber-900">Stuck or failed payment?</h2>
            <p className="text-sm text-amber-800 mt-1">
              If the customer's bank/card was actually charged but this record never reached "Success" - e.g. their
              browser closed right after paying, before confirming with us - check directly with Razorpay. This never
              trusts anything except Razorpay's own API.
            </p>
          </div>
          <button
            onClick={handleReconcile}
            disabled={reconciling}
            className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold disabled:opacity-50"
          >
            {reconciling ? "Checking Razorpay..." : "Check Razorpay for this payment"}
          </button>
          {reconcileError && (
            <div role="alert" className="rounded-lg bg-red-50 text-red-700 text-xs px-3 py-2">
              {reconcileError}
            </div>
          )}
          {reconcileResult && !reconcileError && (
            <div role="status" className={`rounded-lg text-xs px-3 py-2 ${reconcileResult.reconciled ? "bg-green-50 text-green-700" : "bg-slate-100 text-slate-600"}`}>
              {reconcileResult.reconciled
                ? "Razorpay confirms this payment was captured - marked successful and the admin has been notified."
                : reconcileResult.reason === "NO_CAPTURED_PAYMENT_FOUND"
                  ? "Razorpay has no captured payment for this order - the customer was not actually charged."
                  : "No change."}
            </div>
          )}
        </div>
      )}

      <Card title="Payment">
        {orgName && <Row label="Organization" value={orgName} />}
        {(userName || userEmail) && (
          <Row
            label="Paid By (Super Admin)"
            value={
              <div>
                <span className="font-medium text-slate-900">{userName || "-"}</span>
                {userEmail && <span className="block text-xs text-slate-500">{userEmail}</span>}
              </div>
            }
          />
        )}
        {payment.plan && <Row label="Plan" value={payment.plan} />}
        <Row label="Amount" value={formatCurrency(payment.amount)} />
        <Row label="Currency" value={payment.currency || "INR"} />
        <Row label="Status" value={<PaymentStatusBadge status={payment.status} />} />
        {balanceStatusOf(payment) && <Row label="Balance" value={<BalanceStatusBadge payment={payment} />} />}
        {payment.invoiceNumber && <Row label="Invoice number" value={<span className="font-mono text-xs text-brand-600 font-semibold">{invNumber}</span>} />}
        <Row label="Provider" value="Razorpay" />
        <Row label="Provider order ID" value={<span className="font-mono text-xs break-all">{payment.razorpayOrderId}</span>} />
        <Row label="Provider payment ID" value={payment.razorpayPaymentId ? <span className="font-mono text-xs break-all">{payment.razorpayPaymentId}</span> : "Not available"} />
        <Row label="Date & Time" value={fmt(payment.createdAt)} />
      </Card>

      <Card title="Wallet effect">
        {effect === null || effect === undefined ? (
          <p className="text-sm text-slate-500">The wallet ledger is not visible to your account.</p>
        ) : credited ? (
          <div>
            <p className="text-sm text-slate-500">Wallet Credit</p>
            <p className="text-2xl font-semibold text-green-700 tabular-nums">+ {formatCurrency(effect.amount)}</p>
            <p className="text-xs text-slate-400 mt-1">Balance after credit {formatCurrency(effect.balanceAfter)}</p>
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            {balanceStatusOf(payment) === "PENDING_CREDIT"
              ? "Payment received. Your balance will be updated once LauncherDesk confirms it."
              : payment.status === "SUCCESS"
                ? "The payment is marked successful but no wallet credit has been recorded for it."
                : "No wallet credit has been recorded for this payment."}
          </p>
        )}
      </Card>

      <Card title="Timeline">
        <ol className="relative border-l border-slate-200 ml-2 space-y-4">
          {timeline.map((t) => (
            <li key={t.label} className="ml-4">
              <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-brand-600" />
              <div className="flex flex-wrap justify-between gap-x-4 text-sm">
                <span className="text-slate-800">{t.label}</span>
                <span className="text-slate-400">{fmt(t.at)}</span>
              </div>
            </li>
          ))}
        </ol>
        <p className="text-xs text-slate-400 mt-3">Only events with a recorded timestamp are shown.</p>
      </Card>

      {showInvoiceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-midnight-900/50 p-4">
          <div className="bg-white rounded-dialog max-w-xl w-full p-6 sm:p-8 space-y-6 shadow-overlay border border-slate-200">
            <div className="flex justify-between items-start border-b border-slate-100 pb-4">
              <div>
                <h3 className="font-display text-lg font-semibold text-slate-900">LauncherDesk E-Stamp</h3>
                <p className="text-xs text-slate-500">Official Payment Receipt & Tax Invoice</p>
              </div>
              <button
                onClick={() => setShowInvoiceModal(false)}
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
                <p>{new Date(payment.createdAt).toLocaleDateString()}</p>
              </div>
              <div>
                <p className="font-semibold text-slate-900">Billed To:</p>
                <p className="text-slate-800 font-medium">{orgName || "Client Organization"}</p>
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
                    <td className="p-2.5 text-slate-800">{payment.plan || "Wallet Top-up & E-Stamping Balance"}</td>
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
              <p>Payment Method: Razorpay</p>
              <p className="font-mono">Transaction ID: {txId}</p>
              <p>Status: <span className="text-green-700 font-semibold">{payment.status}</span></p>
            </div>

            <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
              <button
                onClick={() => window.print()}
                className="px-4 py-2 rounded-lg bg-brand-600 text-white text-xs font-semibold hover:bg-brand-700"
              >
                Print / Save PDF
              </button>
              <button
                onClick={() => setShowInvoiceModal(false)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Card({ title, children }) {
  return (
    <section className="card p-5 sm:p-6 space-y-3">
      <h2 className="font-medium text-slate-900">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 pb-2 last:border-0 text-sm">
      <span className="text-slate-500 shrink-0">{label}</span>
      <span className="font-medium text-slate-900 text-right min-w-0">{value}</span>
    </div>
  );
}
