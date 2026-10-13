import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiClient } from "../../api/client";
import { useApi } from "../../hooks/useApi";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { actionErrorMessage, formatCurrency } from "../../utils/format";
import LoadingState from "../../components/common/LoadingState";
import ErrorState from "../../components/common/ErrorState";
import EmptyState from "../../components/common/EmptyState";
import { CopyButton, UploadCertificateForm, UPLOADABLE, VENDOR_STATUS_LABELS, VendorStatusBadge } from "../../components/vendor/vendorUi";

const STATUS_FILTERS = ["SENT", "ACCEPTED", "UPLOADED", "REJECTED", "APPROVED"];

// The vendor's work queue (GET /vendor/orders, server-scoped to orders sent
// to this vendor), grouped by bulk batch. Every row can be accepted and
// uploaded in place, so a batch is worked through without leaving the list.
export default function VendorQueue({ onChanged }) {
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search, 300);
  const { data, loading, error, refetch } = useApi(
    (signal) => apiClient.get("/vendor/orders", { signal, params: { status: status || undefined, search: debounced.trim() || undefined, limit: 100 } }).then((r) => r.data.data),
    [status, debounced],
    { errorMessage: "Failed to load your orders." }
  );
  const [rowError, setRowError] = useState({});
  const items = data?.items || [];
  // After the first load, refreshes keep the rows mounted so half-filled
  // upload forms on other rows survive an Accept/Upload elsewhere.
  const initialLoading = loading && !data;
  const groups = useMemo(() => {
    const map = new Map();
    for (const o of items) {
      const key = o.bulkBatchId || "single";
      if (!map.has(key)) map.set(key, { key, title: o.bulkBatchNumber ? `Batch ${o.bulkBatchNumber}` : "Single orders", items: [] });
      map.get(key).items.push(o);
    }
    return [...map.values()];
  }, [items]);

  function changed() {
    refetch();
    onChanged?.();
  }
  async function accept(order) {
    setRowError((e) => ({ ...e, [order._id]: "" }));
    try {
      await apiClient.post(`/vendor/orders/${order._id}/accept`);
      changed();
    } catch (err) {
      setRowError((e) => ({ ...e, [order._id]: actionErrorMessage(err, "Could not accept this order.") }));
    }
  }

  return (
    <section className="bg-white rounded-xl border border-slate-200">
      <div className="flex flex-wrap items-center gap-2 p-4 border-b border-slate-100">
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search order number" aria-label="Search orders" className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm w-56" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status" className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm">
          <option value="">All statuses</option>
          {STATUS_FILTERS.map((s) => (
            <option key={s} value={s}>
              {VENDOR_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <div className="flex-1" />
        <button type="button" onClick={refetch} disabled={loading} className="text-sm rounded-lg border border-slate-300 px-3 py-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-50">
          Refresh
        </button>
      </div>
      {initialLoading && <LoadingState text="Loading your orders..." />}
      {!initialLoading && error && (
        <div className="p-4">
          <ErrorState message={error} onRetry={refetch} />
        </div>
      )}
      {!initialLoading && !error && items.length === 0 && <EmptyState title="No orders here" description="Orders sent to you by LauncherDesk appear here." />}
      {!initialLoading &&
        !error &&
        groups.map((group) => (
          <div key={group.key} className="border-t border-slate-100 first:border-t-0">
            <h3 className="px-4 pt-4 pb-2 text-xs font-semibold uppercase text-slate-500">
              {group.title} <span className="font-normal">({group.items.length})</span>
            </h3>
            <ul className="divide-y divide-slate-100">
              {group.items.map((o) => (
                <li key={o._id} className="px-4 py-3 space-y-2" data-testid={`vendor-row-${o._id}`}>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                    <span className="font-medium text-slate-900">
                      {o.orderNumber}
                      <CopyButton value={o.orderNumber} label={`order number ${o.orderNumber}`} />
                    </span>
                    <VendorStatusBadge status={o.vendorStatus} label={o.declined ? "Handed back" : undefined} />
                    <span className="text-slate-600">{o.organizationName}</span>
                    <span className="text-slate-600">
                      {o.stateCode} · {o.articleTitle || "-"}
                    </span>
                    <span className="text-slate-600">
                      {o.firstParty}
                      <CopyButton value={o.firstParty} label={`first party for ${o.orderNumber}`} /> / {o.secondParty}
                      <CopyButton value={o.secondParty} label={`second party for ${o.orderNumber}`} />
                    </span>
                    <span className="text-slate-700 tabular-nums">
                      Duty {formatCurrency(o.stampDuty)}
                      <CopyButton value={o.stampDuty} label={`duty for ${o.orderNumber}`} />
                    </span>
                    <div className="flex-1" />
                    <div className="flex items-center gap-2">
                      {o.vendorStatus === "SENT" && !o.declined && (
                        <button type="button" onClick={() => accept(o)} className="rounded-lg border border-brand-600 text-brand-700 px-3 py-1 text-xs font-medium hover:bg-brand-50 whitespace-nowrap">
                          Accept
                        </button>
                      )}
                      <Link to={`/vendor/orders/${o._id}`} className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap" aria-label={`Details for ${o.orderNumber}`}>
                        Details
                      </Link>
                    </div>
                  </div>
                  {o.vendorStatus === "REJECTED" && !o.declined && o.uploads?.length > 0 && (
                    <p className="text-xs text-red-700">Rejected: {o.uploads[o.uploads.length - 1].reviewNotes}</p>
                  )}
                  {rowError[o._id] && <p role="alert" className="text-xs text-red-600">{rowError[o._id]}</p>}
                  {UPLOADABLE.includes(o.vendorStatus) && !o.declined && !o.closed && <UploadCertificateForm order={o} compact onUploaded={changed} />}
                </li>
              ))}
            </ul>
          </div>
        ))}
    </section>
  );
}
