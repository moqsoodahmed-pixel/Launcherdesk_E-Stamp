import { useViewerRole } from "../../components/ui/StatusChip";
import { statusOptions, isClientRole } from "../../components/ui/status";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { apiClient } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { hasPermission, PERMISSIONS } from "../../utils/permissions";
import { formatCurrency, errorMessage } from "../../utils/format";
import StatusBadge from "../../components/estamps/StatusBadge";
import EmptyState from "../../components/dashboard/EmptyState";
import { TableSkeleton } from "../../components/dashboard/LoadingSkeleton";
import ErrorState from "../../components/common/ErrorState";
import { useApi } from "../../hooks/useApi";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";

const STATUS_OPTIONS = [
  "DRAFT",
  "PAYMENT_PENDING",
  "PAYMENT_SUCCESS",
  "REQUEST_CREATED",
  "MODIFICATION_WINDOW",
  "LOCKED",
  "PROCESSING",
  "COMPLETED",
  "DOWNLOAD_AVAILABLE",
  "CANCELLED",
  "FAILED",
];

export default function RequestsListPage() {
  const viewerRole = useViewerRole();
  const location = useLocation();
  const { user } = useAuth();
  const isInternal = user?.role === "MASTER_ADMIN" || user?.role === "ASSISTANT_MASTER_ADMIN";
  const canBulk = hasPermission(user, PERMISSIONS.ESTAMP_BULK_CREATE);
  const [page, setPage] = useState(1);
  const [limit] = useState(10);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [states, setStates] = useState([]);

  useEffect(() => {
    apiClient
      .get("/articles/states")
      .then((res) => setStates(res.data.data))
      .catch(() => setStates([]));
  }, []);

  // Typing in the search box sends one request after a pause, not one per key.
  const debouncedSearch = useDebouncedValue(search.trim(), 350);
  const { data, loading, error, refetch: load } = useApi(
    (signal) =>
      apiClient
        .get("/estamps", {
          params: {
            page,
            limit,
            status: status || undefined,
            stateCode: stateCode || undefined,
            search: debouncedSearch || undefined,
            dateFrom: dateFrom || undefined,
            dateTo: dateTo || undefined,
          },
          signal,
        })
        .then((res) => res.data.data),
    [page, limit, status, stateCode, debouncedSearch, dateFrom, dateTo],
    { errorMessage: "Failed to load requests." }
  );
  const items = data?.items || [];
  const total = data?.total || 0;

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const hasFilters = status || stateCode || search || dateFrom || dateTo;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="font-display text-2xl font-semibold text-slate-900">E-Stamp Requests</h1>
        {!isInternal && (
          <div className="flex items-center gap-2">
            {canBulk && (
              <Link to="/estamps/bulk" className="text-sm text-slate-600 border border-slate-300 rounded-lg px-4 py-2 hover:bg-slate-50">
                Create Bulk Request
              </Link>
            )}
            <Link to="/estamps/requests/new" className="inline-flex min-h-[44px] sm:min-h-[40px] items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white transition-colors hover:bg-brand-700">
              + New Request
            </Link>
          </div>
        )}
      </div>

      <div className="card p-4 mb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <input
          aria-label="Search requests"
          value={search}
          onChange={(e) => {
            setPage(1);
            setSearch(e.target.value);
          }}
          placeholder="Search request #"
          className="input w-auto"
        />
        <select
          aria-label="Status"
          value={status}
          onChange={(e) => {
            setPage(1);
            setStatus(e.target.value);
          }}
          className="input w-auto"
        >
          <option value="">All statuses</option>
          {statusOptions(STATUS_OPTIONS, { client: isClientRole(viewerRole) }).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          aria-label="State"
          value={stateCode}
          onChange={(e) => {
            setPage(1);
            setStateCode(e.target.value);
          }}
          className="input w-auto"
        >
          <option value="">All states</option>
          {states.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <input
          aria-label="Created from"
          type="date"
          value={dateFrom}
          onChange={(e) => {
            setPage(1);
            setDateFrom(e.target.value);
          }}
          className="input w-auto"
        />
        <input
          aria-label="Created to"
          type="date"
          value={dateTo}
          onChange={(e) => {
            setPage(1);
            setDateTo(e.target.value);
          }}
          className="input w-auto"
        />
      </div>

      {hasFilters && (
        <button
          onClick={() => {
            setStatus("");
            setStateCode("");
            setSearch("");
            setDateFrom("");
            setDateTo("");
            setPage(1);
          }}
          className="text-sm text-slate-500 hover:underline mb-4"
        >
          Clear filters
        </button>
      )}

      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : (
      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-4">
            <TableSkeleton rows={5} />
          </div>
        ) : items.length === 0 ? (
          <EmptyState text={hasFilters ? "No requests match these filters." : "No requests yet."} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-600">
                <tr>
                  <th className="whitespace-nowrap px-4 py-2.5 text-left font-semibold">Request #</th>
                  <th className="whitespace-nowrap px-4 py-2.5 text-left font-semibold">State</th>
                  <th className="whitespace-nowrap px-4 py-2.5 text-left font-semibold">Status</th>
                  <th className="whitespace-nowrap px-4 py-2.5 text-left font-semibold">Amount</th>
                  <th className="whitespace-nowrap px-4 py-2.5 text-left font-semibold">Created</th>
                  <th className="whitespace-nowrap px-4 py-2.5 text-left font-semibold"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r._id} className="border-t border-slate-100 transition-colors hover:bg-brand-50/40">
                    <td className="px-4 py-3 font-medium text-slate-900">{r.requestNumber}</td>
                    <td className="px-4 py-3 text-slate-500">{r.stateCode}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={r.status} deadline={r.modificationDeadline} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums">{formatCurrency(r.calculatedStampDuty)}</td>
                    <td className="px-4 py-3 text-slate-500">{new Date(r.createdAt).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <Link
                        to={`/estamps/requests/${r._id}`}
                        state={{ from: location.pathname + location.search, label: "Requests" }}
                        className="font-medium text-brand-700 hover:underline"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm text-slate-500">
          <span>
            Page {page} of {totalPages} ({total} total)
          </span>
          <div className="space-x-2">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 text-slate-700 hover:bg-slate-50 disabled:opacity-40">
              Previous
            </button>
            <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 text-slate-700 hover:bg-slate-50 disabled:opacity-40">
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
