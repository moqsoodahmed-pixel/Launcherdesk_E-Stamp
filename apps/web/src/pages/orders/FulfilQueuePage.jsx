import { useState } from "react";
import { Link } from "react-router-dom";
import { apiClient } from "../../api/client";
import { useApi } from "../../hooks/useApi";
import { formatCurrency } from "../../utils/format";
import PageHeader from "../../components/common/PageHeader";
import LoadingState from "../../components/common/LoadingState";
import ErrorState from "../../components/common/ErrorState";
import EmptyState from "../../components/common/EmptyState";
import StatusBadge from "../../components/estamps/StatusBadge";

const LIMIT = 25;

// "2 h 05 m" / "3 d 4 h" since `date`.
export function formatAge(date, now = Date.now()) {
  if (!date) return "-";
  const minutes = Math.max(0, Math.floor((now - new Date(date).getTime()) / 60000));
  if (minutes < 60) return `${minutes} m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ${String(minutes % 60).padStart(2, "0")} m`;
  return `${Math.floor(hours / 24)} d ${hours % 24} h`;
}

// Manual fulfilment queue: orders whose request has left its 20-minute
// window and been charged, still to be stamped. The server scopes it to the
// caller's assigned organizations (Master Admin: all). Oldest first.
export default function FulfilQueuePage() {
  const [page, setPage] = useState(1);
  const { data, loading, error, refetch } = useApi(
    (signal) => apiClient.get("/orders", { signal, params: { queue: "fulfil", sortBy: "createdAt", sortDir: "asc", page, limit: LIMIT } }).then((r) => r.data.data),
    [page],
    { errorMessage: "Failed to load orders to fulfil." }
  );
  const items = data?.items || [];
  const total = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div>
      <PageHeader
        title="Orders to fulfil"
        subtitle="Locked and charged requests waiting to be stamped, oldest first"
        actions={
          <button type="button" onClick={refetch} disabled={loading} className="text-sm rounded-lg border border-slate-300 px-3 py-2 text-slate-600 hover:bg-slate-50 disabled:opacity-50">
            Refresh
          </button>
        }
      />
      {loading && <LoadingState text="Loading orders to fulfil..." />}
      {!loading && error && <ErrorState message={error} onRetry={refetch} />}
      {!loading && !error && items.length === 0 && (
        <div className="bg-white rounded-xl border border-slate-200">
          <EmptyState title="Nothing to fulfil" description="New orders appear here once their 20-minute window ends and the amount is charged." />
        </div>
      )}
      {!loading && !error && items.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-3">Order</th>
                <th className="text-left px-4 py-3">Organization</th>
                <th className="text-left px-4 py-3">State</th>
                <th className="text-left px-4 py-3">Article</th>
                <th className="text-right px-4 py-3">Amount</th>
                <th className="text-left px-4 py-3">Locked at</th>
                <th className="text-left px-4 py-3">Age</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="px-4 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((o) => (
                <tr key={o._id} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-medium text-slate-900">{o.orderNumber}</td>
                  <td className="px-4 py-3 text-slate-600">{o.organizationName || "-"}</td>
                  <td className="px-4 py-3 text-slate-600">{o.stateCode}</td>
                  <td className="px-4 py-3 text-slate-600">{o.articleTitle || "-"}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(o.amount)}</td>
                  <td className="px-4 py-3 text-slate-500">{o.lockedAt ? new Date(o.lockedAt).toLocaleString() : "-"}</td>
                  <td className="px-4 py-3 text-slate-700 tabular-nums">{formatAge(o.lockedAt || o.createdAt)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={o.eStampStatus} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link to={`/orders/${o._id}`} className="bg-brand-600 hover:bg-brand-700 text-white rounded-lg px-3 py-1.5 text-xs font-medium" aria-label={`Open order ${o.orderNumber}`}>
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!error && total > LIMIT && (
        <div className="flex items-center justify-between gap-2 mt-4 text-sm text-slate-500">
          <span>
            Page {page} of {totalPages} ({total} total)
          </span>
          <div className="space-x-2">
            <button disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)} className="px-3 py-1 rounded-lg border border-slate-300 disabled:opacity-40">
              Previous
            </button>
            <button disabled={page >= totalPages || loading} onClick={() => setPage((p) => p + 1)} className="px-3 py-1 rounded-lg border border-slate-300 disabled:opacity-40">
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
