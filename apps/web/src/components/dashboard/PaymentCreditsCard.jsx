import { Link } from "react-router-dom";
import { apiClient } from "../../api/client";
import { useApi } from "../../hooks/useApi";
import { formatCurrency } from "../../utils/format";
import ErrorState from "../common/ErrorState";

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

// "Razorpay received vs credited to balances" from GET /payments/credit-summary
// (server-scoped: Master Admin sees every organization, an assistant only
// assigned ones). variant="master" adds the per-organization pending list;
// variant="assistant" is the compact "payments to credit" tile.
export default function PaymentCreditsCard({ variant = "master" }) {
  const { data, loading, error, refetch } = useApi((signal) => apiClient.get("/payments/credit-summary", { signal }).then((r) => r.data.data), [], {
    errorMessage: "Failed to load payment credits.",
  });

  return (
    <section className="card p-6">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 className="font-medium text-slate-900">{variant === "master" ? "Razorpay received vs credited to balances" : "Payments to credit"}</h2>
        <Link to="/payments/credit-queue" className="text-sm font-medium text-brand-700 hover:underline">
          Open queue
        </Link>
      </div>
      {loading && <p className="text-sm text-slate-500">Loading...</p>}
      {!loading && error && <ErrorState message={error} onRetry={refetch} />}
      {!loading && !error && data && variant === "assistant" && (
        <p className="text-sm text-slate-700">
          <span className="text-2xl font-semibold text-slate-900 tabular-nums">{num(data.pendingCount)}</span> payment{num(data.pendingCount) === 1 ? "" : "s"} waiting,{" "}
          <span className="font-semibold tabular-nums">{formatCurrency(num(data.pendingAmount))}</span> in total, for your assigned organizations.
        </p>
      )}
      {!loading && !error && data && variant === "master" && (
        <>
          <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
            <div>
              <dt className="text-xs text-slate-500">Received by Razorpay</dt>
              <dd className="text-lg font-semibold tabular-nums">{formatCurrency(num(data.totalReceived))}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Credited to balances</dt>
              <dd className="text-lg font-semibold tabular-nums">{formatCurrency(num(data.totalCredited))}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Pending credit</dt>
              <dd className="text-lg font-semibold tabular-nums text-amber-700">
                {formatCurrency(num(data.pendingAmount))} <span className="text-xs font-normal text-slate-500">({num(data.pendingCount)})</span>
              </dd>
            </div>
          </dl>
          {Array.isArray(data.pendingByOrganization) && data.pendingByOrganization.length > 0 && (
            <table className="w-full text-sm mt-4">
              <thead className="text-xs text-slate-600">
                <tr>
                  <th className="text-left py-2">Organization</th>
                  <th className="text-right py-2">Pending</th>
                </tr>
              </thead>
              <tbody>
                {data.pendingByOrganization.map((r) => (
                  <tr key={r.organizationId} className="border-t border-slate-100">
                    <td className="py-2 text-slate-700">{r.organizationName || r.organizationId}</td>
                    <td className="py-2 text-right tabular-nums">
                      {formatCurrency(num(r.pendingAmount))} <span className="text-xs text-slate-500">({num(r.pendingCount)})</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}
