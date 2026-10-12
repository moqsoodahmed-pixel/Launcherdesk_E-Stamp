import { apiClient } from "../../api/client";
import { useApi } from "../../hooks/useApi";
import { formatAge } from "../orders/FulfilQueuePage";
import PageHeader from "../../components/common/PageHeader";
import ErrorState from "../../components/common/ErrorState";
import VendorQueue from "./VendorQueue";

const CARDS = [
  { key: "SENT", label: "To do" },
  { key: "ACCEPTED", label: "In progress" },
  { key: "UPLOADED", label: "Awaiting review" },
  { key: "REJECTED", label: "Needs re-upload" },
  { key: "APPROVED", label: "Approved" },
];

// Vendor landing page: counts from GET /vendor/orders/summary only, then
// the work queue.
export default function VendorDashboard() {
  const { data, loading, error, refetch } = useApi((signal) => apiClient.get("/vendor/orders/summary", { signal }).then((r) => r.data.data), [], {
    errorMessage: "Failed to load your summary.",
  });
  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" subtitle={data?.oldestWaitingAt ? `Oldest order waiting: ${formatAge(data.oldestWaitingAt)}` : "Orders sent to you by LauncherDesk"} />
      {error && <ErrorState message={error} onRetry={refetch} />}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {CARDS.map((c) => (
          <div key={c.key} className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-xs text-slate-500">{c.label}</p>
            <p className="text-2xl font-semibold text-slate-900 tabular-nums" aria-label={`${c.label} count`}>
              {loading ? "…" : data?.[c.key] ?? 0}
            </p>
          </div>
        ))}
      </div>
      <VendorQueue onChanged={refetch} />
    </div>
  );
}
