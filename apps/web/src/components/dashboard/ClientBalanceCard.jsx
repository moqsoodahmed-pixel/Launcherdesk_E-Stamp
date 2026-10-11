import { Link } from "react-router-dom";
import { apiClient } from "../../api/client";
import { useApi } from "../../hooks/useApi";
import { formatCurrency } from "../../utils/format";
import ErrorState from "../common/ErrorState";

// Client dashboard balance: Available (what new requests may reserve) as the
// main figure, plus the amount held for requests still in their 20-minute
// window. Figures come straight from GET /wallet/balance.
export default function ClientBalanceCard() {
  const { data, loading, error, refetch } = useApi((signal) => apiClient.get("/wallet/balance", { signal }).then((r) => r.data.data), [], {
    errorMessage: "Failed to load balance.",
  });
  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-6">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h2 className="font-medium text-slate-900">Balance</h2>
        <Link to="/wallet" className="text-sm text-brand-600 hover:underline">
          Wallet and ledger
        </Link>
      </div>
      {loading && <p className="text-sm text-slate-500">Loading...</p>}
      {!loading && error && <ErrorState message={error} onRetry={refetch} />}
      {!loading && !error && data && (
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <dt className="text-xs text-slate-500">Available balance</dt>
            <dd className="text-2xl font-semibold text-slate-900 tabular-nums">{formatCurrency(data.availableBalance ?? data.balance)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Reserved</dt>
            <dd className="text-lg font-medium text-slate-900 tabular-nums">{formatCurrency(data.reservedBalance ?? 0)}</dd>
            <dd className="text-xs text-slate-400">held for requests in their 20-minute window</dd>
          </div>
        </dl>
      )}
    </section>
  );
}
