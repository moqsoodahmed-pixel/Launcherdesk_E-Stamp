import { Link } from "react-router-dom";
import { Plus, ArrowRight } from "lucide-react";
import { apiClient } from "../../api/client";
import { useApi } from "../../hooks/useApi";
import { formatCurrency } from "../../utils/format";
import ErrorState from "../common/ErrorState";
import StampCard from "../ui/StampCard";
import Skeleton from "../ui/Skeleton";

// Client dashboard balance: Available (what new requests may reserve) as the
// main figure, plus the amount held for requests still in their 20-minute
// window. Figures come straight from GET /wallet/balance. `canAddMoney`
// (the caller checks the user's permission) shows the Add money action,
// which opens the wallet page where funds are added.
export default function ClientBalanceCard({ canAddMoney = false }) {
  const { data, loading, error, refetch } = useApi((signal) => apiClient.get("/wallet/balance", { signal }).then((r) => r.data.data), [], {
    errorMessage: "Failed to load balance.",
  });
  return (
    <StampCard as="section" tone="brand" aria-labelledby="client-balance-title">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 id="client-balance-title" className="font-display text-base font-semibold text-white">
          Balance
        </h2>
        <Link to="/wallet" className="inline-flex min-h-[36px] items-center gap-1 text-sm font-medium text-white/90 hover:text-white hover:underline">
          Wallet and ledger
          <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </div>
      {loading && (
        <div className="space-y-2" role="status" aria-live="polite">
          <span className="sr-only">Loading...</span>
          <Skeleton className="h-9 w-40 bg-white/20" />
          <Skeleton className="h-4 w-56 bg-white/15" />
        </div>
      )}
      {!loading && error && <ErrorState message={error} onRetry={refetch} />}
      {!loading && !error && data && (
        <div className="flex flex-wrap items-end justify-between gap-4">
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-8">
            <div>
              <dt className="text-sm text-white/75">Available balance</dt>
              <dd className="font-display text-4xl font-semibold tabular-nums text-white">{formatCurrency(data.availableBalance ?? data.balance)}</dd>
            </div>
            <div>
              <dt className="text-sm text-white/75">Reserved</dt>
              <dd className="font-display text-xl font-semibold tabular-nums text-white">{formatCurrency(data.reservedBalance ?? 0)}</dd>
              <dd className="text-xs text-white/75">held for requests in their 20-minute window</dd>
            </div>
          </dl>
          {canAddMoney && (
            <Link to="/wallet" className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-marigold-400 px-4 text-sm font-semibold text-ink transition-colors hover:bg-marigold-300">
              <Plus size={16} aria-hidden="true" />
              Add money
            </Link>
          )}
        </div>
      )}
    </StampCard>
  );
}
