import { Link } from "react-router-dom";
import { apiClient } from "../../api/client";
import { useApi } from "../../hooks/useApi";
import ErrorState from "../common/ErrorState";

// Vendor stage at a glance for staff: charged orders not yet with a vendor,
// and vendor uploads awaiting review (server-scoped totals, limit 1 each).
export default function VendorStageCard() {
  const total = (signal, params) => apiClient.get("/orders", { signal, params: { ...params, limit: 1 } }).then((r) => r.data.data.total);
  const { data, loading, error, refetch } = useApi(
    (signal) => Promise.all([total(signal, { queue: "fulfil", vendorStatus: "NOT_SENT" }), total(signal, { queue: "vendor-review" })]).then(([waiting, review]) => ({ waiting, review })),
    [],
    { errorMessage: "Failed to load the vendor queue." }
  );
  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-6">
      <h2 className="font-medium text-slate-900 mb-3">Vendors</h2>
      {loading && <p className="text-sm text-slate-500">Loading...</p>}
      {!loading && error && <ErrorState message={error} onRetry={refetch} />}
      {!loading && !error && data && (
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-xs text-slate-500">Waiting for dispatch</dt>
            <dd className="text-2xl font-semibold text-slate-900 tabular-nums">{data.waiting ?? 0}</dd>
            <Link to="/orders/dispatch" className="text-xs text-brand-600 hover:underline">
              Send to vendor
            </Link>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Awaiting review</dt>
            <dd className="text-2xl font-semibold text-slate-900 tabular-nums">{data.review ?? 0}</dd>
            <Link to="/orders/vendor-review" className="text-xs text-brand-600 hover:underline">
              Review uploads
            </Link>
          </div>
        </dl>
      )}
    </section>
  );
}
