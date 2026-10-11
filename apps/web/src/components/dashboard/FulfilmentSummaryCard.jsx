import { Link } from "react-router-dom";
import { apiClient } from "../../api/client";
import { useApi } from "../../hooks/useApi";
import { formatAge } from "../../pages/orders/FulfilQueuePage";
import ErrorState from "../common/ErrorState";

// Manual fulfilment queue at a glance (GET /orders/fulfilment-summary,
// server-scoped: an assistant sees assigned organizations, Master Admin all).
export default function FulfilmentSummaryCard({ showFulfilledToday = false }) {
  const { data, loading, error, refetch } = useApi((signal) => apiClient.get("/orders/fulfilment-summary", { signal }).then((r) => r.data.data), [], {
    errorMessage: "Failed to load the fulfilment queue.",
  });
  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-6">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 className="font-medium text-slate-900">Orders to fulfil</h2>
        <Link to="/orders/fulfil" className="text-sm text-brand-600 hover:underline">
          Open queue
        </Link>
      </div>
      {loading && <p className="text-sm text-slate-500">Loading...</p>}
      {!loading && error && <ErrorState message={error} onRetry={refetch} />}
      {!loading && !error && data && (
        <dl className={`grid gap-4 text-sm ${showFulfilledToday ? "grid-cols-3" : "grid-cols-2"}`}>
          <div>
            <dt className="text-xs text-slate-500">Waiting</dt>
            <dd className="text-2xl font-semibold text-slate-900 tabular-nums">{data.toFulfil ?? 0}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Oldest waiting</dt>
            <dd className="text-lg font-medium text-slate-900 tabular-nums">{data.oldestLockedAt ? formatAge(data.oldestLockedAt) : "-"}</dd>
          </div>
          {showFulfilledToday && (
            <div>
              <dt className="text-xs text-slate-500">Fulfilled today</dt>
              <dd className="text-lg font-medium text-slate-900 tabular-nums">{data.fulfilledToday ?? 0}</dd>
            </div>
          )}
        </dl>
      )}
    </section>
  );
}
