import { useEffect, useState, useCallback } from "react";
import { Link, useParams } from "react-router-dom";
import { apiClient } from "../../api/client";
import { actionErrorMessage, formatCurrency } from "../../utils/format";
import PaymentStatusBadge from "../../components/payments/PaymentStatusBadge";

function fmt(d) {
  return d ? new Date(d).toLocaleString() : "Not available";
}

export default function PaymentDetailPage() {
  const { id } = useParams();
  const [payment, setPayment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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

  if (loading) return <div className="p-8 text-center text-slate-500">Loading...</div>;
  if (error || !payment) {
    return (
      <div className="space-y-3">
        <Link to="/payments" className="text-sm text-slate-500 hover:underline">
          ← Payments
        </Link>
        <div role="alert" className="rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">
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

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link to="/payments" className="text-sm text-slate-500 hover:underline">
          ← Payments
        </Link>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold text-slate-900 tabular-nums">{formatCurrency(payment.amount)}</h1>
          <PaymentStatusBadge status={payment.status} />
        </div>
      </div>

      {payment.status === "FAILED" && (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5">
          <h2 className="font-medium text-red-800">Payment Failed</h2>
          <p className="text-sm text-red-900 mt-1 break-words">{payment.failureReason || "Payment could not be completed."}</p>
        </div>
      )}

      <Card title="Payment">
        <Row label="Amount" value={formatCurrency(payment.amount)} />
        <Row label="Currency" value={payment.currency || "INR"} />
        <Row label="Status" value={<PaymentStatusBadge status={payment.status} />} />
        <Row label="Provider" value="Razorpay" />
        <Row label="Provider order ID" value={<span className="font-mono text-xs break-all">{payment.razorpayOrderId}</span>} />
        <Row label="Provider payment ID" value={payment.razorpayPaymentId ? <span className="font-mono text-xs break-all">{payment.razorpayPaymentId}</span> : "Not available"} />
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
            {payment.status === "SUCCESS" ? "The payment is marked successful but no wallet credit has been recorded for it." : "No wallet credit has been recorded for this payment."}
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
    </div>
  );
}

function Card({ title, children }) {
  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-3">
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
