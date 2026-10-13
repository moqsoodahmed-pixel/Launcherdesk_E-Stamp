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
    <section className="bg-white rounded-xl border border-slate-200/90 shadow-sm overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-slate-50/50 border-b border-slate-200">
        <div className="flex flex-wrap items-center gap-2.5">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search order number..."
            aria-label="Search orders"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-brand-500 w-60 shadow-sm"
          />
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            aria-label="Filter by status"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-brand-500 shadow-sm"
          >
            <option value="">All statuses</option>
            {STATUS_FILTERS.map((s) => (
              <option key={s} value={s}>
                {VENDOR_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={refetch}
          disabled={loading}
          className="text-xs font-medium rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-slate-600 hover:bg-slate-50 hover:text-slate-800 shadow-sm transition-colors disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

      {initialLoading && <LoadingState text="Loading your orders..." />}
      {!initialLoading && error && (
        <div className="p-4">
          <ErrorState message={error} onRetry={refetch} />
        </div>
      )}
      {!initialLoading && !error && items.length === 0 && (
        <div className="p-6">
          <EmptyState title="No orders here" description="Orders sent to you by LauncherDesk will appear here." />
        </div>
      )}

      {!initialLoading &&
        !error &&
        groups.map((group) => (
          <div key={group.key} className="border-t border-slate-200/80 first:border-t-0">
            <div className="px-5 py-2.5 bg-slate-100/60 border-b border-slate-200/70 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
                {group.title}
              </span>
              <span className="text-xs font-medium text-slate-500 bg-white px-2 py-0.5 rounded-full border border-slate-200 shadow-2xs">
                {group.items.length} order{group.items.length === 1 ? "" : "s"}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/90 text-slate-500 text-[11px] font-semibold uppercase tracking-wider border-b border-slate-200">
                    <th className="px-4 py-3 min-w-[170px]">Order ID</th>
                    <th className="px-4 py-3 min-w-[110px]">Status</th>
                    <th className="px-4 py-3 min-w-[130px]">Organization</th>
                    <th className="px-4 py-3 min-w-[170px]">State & Article</th>
                    <th className="px-4 py-3 min-w-[200px]">Parties</th>
                    <th className="px-4 py-3 min-w-[110px] text-right">Stamp Duty</th>
                    <th className="px-4 py-3 min-w-[120px] text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {group.items.map((o) => (
                    <tr key={o._id} className="hover:bg-slate-50/60 transition-colors align-top" data-testid={`vendor-row-${o._id}`}>
                      {/* Order ID */}
                      <td className="px-4 py-3.5 font-medium text-slate-900 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-xs text-slate-800">{o.orderNumber}</span>
                          <CopyButton value={o.orderNumber} label={`order number ${o.orderNumber}`} />
                        </div>
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <VendorStatusBadge status={o.vendorStatus} label={o.declined ? "Handed back" : undefined} />
                      </td>

                      {/* Organization */}
                      <td className="px-4 py-3.5 text-slate-600">
                        <span className="font-medium text-slate-800 line-clamp-1" title={o.organizationName}>
                          {o.organizationName || "-"}
                        </span>
                      </td>

                      {/* State & Article */}
                      <td className="px-4 py-3.5 text-slate-600">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-slate-800 bg-slate-100 px-1.5 py-0.5 rounded text-[10px] uppercase border border-slate-200">{o.stateCode}</span>
                          <span className="text-slate-700 truncate line-clamp-1" title={o.articleTitle || "-"}>
                            {o.articleTitle || "-"}
                          </span>
                        </div>
                      </td>

                      {/* Parties */}
                      <td className="px-4 py-3.5 text-slate-600">
                        <div className="flex items-center gap-1">
                          <span className="text-slate-400 text-[10px] font-semibold uppercase">1st:</span>
                          <span className="font-medium text-slate-800 truncate" title={o.firstParty}>{o.firstParty}</span>
                          <CopyButton value={o.firstParty} label={`first party for ${o.orderNumber}`} />
                        </div>
                        <div className="flex items-center gap-1 text-slate-500 mt-1">
                          <span className="text-slate-400 text-[10px] font-semibold uppercase">2nd:</span>
                          <span className="truncate" title={o.secondParty}>{o.secondParty}</span>
                          <CopyButton value={o.secondParty} label={`second party for ${o.orderNumber}`} />
                        </div>
                      </td>

                      {/* Duty */}
                      <td className="px-4 py-3.5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center justify-end gap-1 font-semibold text-slate-900 tabular-nums">
                          <span>{formatCurrency(o.stampDuty)}</span>
                          <CopyButton value={o.stampDuty} label={`duty for ${o.orderNumber}`} />
                        </div>
                      </td>

                      {/* Action */}
                      <td className="px-4 py-3.5 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-2">
                          {o.vendorStatus === "SENT" && !o.declined && (
                            <button
                              type="button"
                              onClick={() => accept(o)}
                              className="rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 text-xs font-semibold shadow-xs transition-colors"
                            >
                              Accept
                            </button>
                          )}
                          <Link
                            to={`/vendor/orders/${o._id}`}
                            className="rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 px-3 py-1.5 text-xs font-medium shadow-2xs transition-colors inline-block"
                            aria-label={`Details for ${o.orderNumber}`}
                          >
                            Details
                          </Link>
                        </div>
                        {o.vendorStatus === "REJECTED" && !o.declined && o.uploads?.length > 0 && (
                          <div className="mt-2 text-left bg-red-50 border border-red-200/80 rounded-md p-2">
                            <span className="font-semibold text-red-800 text-[11px] block">
                              Rejected: {o.uploads[o.uploads.length - 1].reviewNotes}
                            </span>
                          </div>
                        )}
                        {rowError[o._id] && <p role="alert" className="text-xs font-medium text-red-600 mt-1.5 text-left">{rowError[o._id]}</p>}
                        {UPLOADABLE.includes(o.vendorStatus) && !o.declined && !o.closed && (
                          <div className="mt-2.5 text-left">
                            <UploadCertificateForm order={o} compact onUploaded={changed} />
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
    </section>
  );
}
