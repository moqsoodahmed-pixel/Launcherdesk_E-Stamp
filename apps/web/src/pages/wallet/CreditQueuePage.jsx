import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { apiClient } from "../../api/client";
import { useApi } from "../../hooks/useApi";
import { getErrorMessage } from "../../utils/errors";
import { formatCurrency } from "../../utils/format";
import PageHeader from "../../components/common/PageHeader";
import LoadingState from "../../components/common/LoadingState";
import ErrorState from "../../components/common/ErrorState";
import EmptyState from "../../components/common/EmptyState";

const LIMIT = 20;

function fmt(d) {
  return d ? new Date(d).toLocaleString() : "-";
}

// 403/409/429 get explicit wording; anything else uses the server message.
export function creditError(err) {
  const status = err?.response?.status;
  if (status === 403) return "You can only credit payments of organizations assigned to you.";
  if (status === 409) return err?.response?.data?.message || "This payment has already been credited.";
  return getErrorMessage(err, "Could not credit this payment.");
}

// Assigned assistant / Master Admin queue: verified Razorpay payments that
// have not reached the client's balance yet. Crediting is server-side and
// idempotent; this page never computes a balance itself.
export default function CreditQueuePage() {
  const [page, setPage] = useState(1);
  const [confirming, setConfirming] = useState(null);
  const [notice, setNotice] = useState(null);
  const queue = useApi(
    (signal) => apiClient.get("/payments", { signal, params: { balanceStatus: "PENDING_CREDIT", page, limit: LIMIT } }).then((r) => r.data.data),
    [page],
    { errorMessage: "Failed to load payments to credit." }
  );
  const orgs = useApi((signal) => apiClient.get("/organizations", { signal, params: { limit: 50 } }).then((r) => r.data.data.items || []), [], {
    errorMessage: "Failed to load your organizations.",
  });
  const [refreshKey, setRefreshKey] = useState(0);

  const items = queue.data?.items || [];
  const total = queue.data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  function onCredited(payment) {
    setConfirming(null);
    setNotice(`${formatCurrency(payment.amount)} credited to ${payment.organizationName || "the client"}'s balance.`);
    queue.refetch();
    setRefreshKey((k) => k + 1);
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Payments to credit" subtitle="Razorpay payments received that are waiting to be added to a client balance" />

      {notice && (
        <div role="status" className="rounded-lg bg-green-50 text-green-700 text-sm px-3 py-2">
          {notice}
        </div>
      )}

      <section className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 font-medium text-slate-900 text-sm">Pending credit</div>
        {queue.loading && <LoadingState text="Loading payments to credit..." />}
        {!queue.loading && queue.error && (
          <div className="p-4">
            <ErrorState message={queue.error} onRetry={queue.refetch} />
          </div>
        )}
        {!queue.loading && !queue.error && items.length === 0 && <EmptyState title="Nothing to credit" description="Every received payment has been added to its client's balance." />}
        {!queue.loading && !queue.error && items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-3">Organization</th>
                  <th className="text-right px-4 py-3">Amount</th>
                  <th className="text-left px-4 py-3">Razorpay payment</th>
                  <th className="text-left px-4 py-3">Paid</th>
                  <th className="px-4 py-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p._id} className="border-t border-slate-100">
                    <td className="px-4 py-3 text-slate-700">{p.organizationName || "-"}</td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums">{formatCurrency(p.amount)}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">
                      <Link to={`/payments/${p._id}`} className="hover:underline">
                        {p.razorpayPaymentId || "-"}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{fmt(p.verifiedAt || p.createdAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => setConfirming(p)}
                        aria-label={`Credit ${formatCurrency(p.amount)} to ${p.organizationName || "client"} balance`}
                        className="bg-brand-600 hover:bg-brand-700 text-white rounded-lg px-3 py-1.5 text-xs font-medium"
                      >
                        Credit to balance
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!queue.error && total > LIMIT && (
          <div className="flex items-center justify-between gap-2 px-4 py-3 text-sm text-slate-500 border-t border-slate-100">
            <span>
              Page {page} of {totalPages} ({total} total)
            </span>
            <div className="space-x-2">
              <button disabled={page <= 1 || queue.loading} onClick={() => setPage((n) => n - 1)} className="px-3 py-1 rounded-lg border border-slate-300 disabled:opacity-40">
                Previous
              </button>
              <button disabled={page >= totalPages || queue.loading} onClick={() => setPage((n) => n + 1)} className="px-3 py-1 rounded-lg border border-slate-300 disabled:opacity-40">
                Next
              </button>
            </div>
          </div>
        )}
      </section>

      <section>
        <h2 className="font-medium text-slate-900 mb-3">Your organizations</h2>
        {orgs.loading && <LoadingState text="Loading organizations..." />}
        {!orgs.loading && orgs.error && <ErrorState message={orgs.error} onRetry={orgs.refetch} />}
        {!orgs.loading && !orgs.error && (orgs.data || []).length === 0 && (
          <div className="bg-white rounded-xl border border-slate-200">
            <EmptyState title="No organizations assigned to you" description="A Master Admin assigns client organizations to you." />
          </div>
        )}
        {!orgs.loading && !orgs.error && (orgs.data || []).length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {orgs.data.map((o) => (
              <OrgBalanceCard key={`${o._id}-${refreshKey}`} org={o} />
            ))}
          </div>
        )}
      </section>

      {confirming && <CreditDialog payment={confirming} onClose={() => setConfirming(null)} onCredited={onCredited} />}
    </div>
  );
}

function OrgBalanceCard({ org }) {
  const { data, loading, error, refetch } = useApi(
    (signal) =>
      Promise.all([
        apiClient.get(`/wallet/${org._id}/balance`, { signal }),
        apiClient.get(`/wallet/${org._id}/transactions`, { signal, params: { limit: 3 } }),
      ]).then(([b, t]) => ({ balance: b.data.data, transactions: t.data.data.items || [] })),
    [org._id],
    { errorMessage: "Failed to load balance." }
  );
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <Link to={`/organizations/${org._id}`} className="font-medium text-slate-900 hover:underline break-words">
          {org.name}
        </Link>
      </div>
      {loading && <p className="text-sm text-slate-500">Loading...</p>}
      {!loading && error && <ErrorState message={error} onRetry={refetch} />}
      {!loading && !error && data && (
        <>
          <dl className="grid grid-cols-3 gap-2 text-sm">
            <div>
              <dt className="text-xs text-slate-500">Available</dt>
              <dd className="font-semibold tabular-nums">{formatCurrency(data.balance.availableBalance ?? data.balance.balance)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Reserved</dt>
              <dd className="tabular-nums">{formatCurrency(data.balance.reservedBalance ?? 0)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Balance</dt>
              <dd className="tabular-nums">{formatCurrency(data.balance.balance)}</dd>
            </div>
          </dl>
          <ul className="mt-3 divide-y divide-slate-100 text-xs">
            {data.transactions.length === 0 && <li className="py-2 text-slate-400">No ledger entries yet.</li>}
            {data.transactions.map((t) => (
              <li key={t._id} className="py-2 flex justify-between gap-2">
                <span className="text-slate-600 break-all">{t.description || t.type}</span>
                <span className={`tabular-nums ${t.type === "DEBIT" ? "text-red-600" : "text-green-700"}`}>
                  {t.type === "DEBIT" ? "−" : "+"}
                  {formatCurrency(t.amount)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function CreditDialog({ payment, onClose, onCredited }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const confirmRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    confirmRef.current?.focus();
    function onKey(e) {
      if (e.key === "Escape") onCloseRef.current();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  async function confirm() {
    setBusy(true);
    setErr(null);
    try {
      await apiClient.post(`/payments/${payment._id}/credit-balance`);
      onCredited(payment);
    } catch (e) {
      setErr(creditError(e));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="credit-dialog-title" className="w-full max-w-md bg-white rounded-xl border border-slate-200 p-6">
        <h2 id="credit-dialog-title" className="text-base font-semibold text-slate-900">
          Credit {formatCurrency(payment.amount)} to balance?
        </h2>
        <p className="text-sm text-slate-600 mt-2">
          Confirm that {formatCurrency(payment.amount)} from Razorpay payment <span className="font-mono">{payment.razorpayPaymentId}</span> has been received for{" "}
          <span className="font-medium">{payment.organizationName || "this client"}</span>. Their balance increases by exactly this amount and they are notified. This cannot be undone here.
        </p>
        {err && (
          <div role="alert" className="mt-3 rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">
            {err}
          </div>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
          <button ref={confirmRef} type="button" onClick={confirm} disabled={busy} className="bg-brand-600 hover:bg-brand-700 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">
            {busy ? "Crediting..." : "Credit to balance"}
          </button>
        </div>
      </div>
    </div>
  );
}
