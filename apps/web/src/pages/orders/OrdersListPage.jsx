import { useViewerRole } from "../../components/ui/StatusChip";
import { statusOptions, isClientRole } from "../../components/ui/status";
import { useEffect, useRef, useState, useCallback } from "react";
import { Link, useLocation } from "react-router-dom";
import { apiClient } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { isManualFulfilment } from "../../utils/fulfilment";
import StatusBadge from "../../components/estamps/StatusBadge";
import EmptyState from "../../components/dashboard/EmptyState";
import { TableSkeleton } from "../../components/dashboard/LoadingSkeleton";
import { actionErrorMessage, formatCurrency } from "../../utils/format";
import ErrorState from "../../components/common/ErrorState";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";

// Values mirror the backend enums (OrderStatus, EStampOrderProcessingStatus).
const STATUS_OPTIONS = ["ONGOING", "COMPLETED", "CANCELLED", "FAILED"];
const PROCESSING_STATUS_OPTIONS = ["CREATED", "SUBMITTING", "SUBMITTED", "PROCESSING", "ISSUED", "FAILED"];
const IN_FLIGHT = ["SUBMITTING", "SUBMITTED", "PROCESSING"];
const SEARCH_DEBOUNCE_MS = 400;

const inputClass = "rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500";

function fmt(date) {
  return date ? new Date(date).toLocaleString() : "-";
}

export default function OrdersListPage() {
  const viewerRole = useViewerRole();
  const location = useLocation();
  const { user } = useAuth();
  const manual = isManualFulfilment(user);
  const refLabel = manual ? "Stamp reference" : "Provider reference";
  const isInternal = user?.role === "MASTER_ADMIN" || user?.role === "ASSISTANT_MASTER_ADMIN";

  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState(null);
  const [page, setPage] = useState(1);
  const [limit] = useState(10);
  const [status, setStatus] = useState("");
  const [eStampStatus, setEStampStatus] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [states, setStates] = useState([]);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortDir, setSortDir] = useState("desc");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Dedicated Failed Orders view - same backend filter (eStampStatus=FAILED),
  // but shows the failure-specific columns.
  const [failedView, setFailedView] = useState(false);

  useEffect(() => {
    apiClient
      .get("/articles/states")
      .then((res) => setStates(Array.isArray(res.data.data) ? res.data.data : []))
      .catch(() => setStates([]));
  }, []);

  // Debounce the search box so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      const next = searchInput.trim();
      setSearch((prev) => {
        if (prev !== next) setPage(1);
        return next;
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchInput]);

  const debouncedOrgName = useDebouncedValue(organizationName.trim(), 350);
  // Only the newest load may write state - a slow earlier response must not
  // overwrite the results of a later filter change.
  const loadSeq = useRef(0);

  const load = useCallback(() => {
    const seq = ++loadSeq.current;
    const params = {
      page,
      limit,
      status: status || undefined,
      eStampStatus: failedView ? "FAILED" : eStampStatus || undefined,
      stateCode: stateCode || undefined,
      search: search || undefined,
      organizationName: isInternal ? debouncedOrgName || undefined : undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      sortBy,
      sortDir,
    };
    setLoading(true);
    setError(null);
    // The summary uses the same filters minus pagination and minus the
    // processing-status filter, so the queue cards always show the real
    // per-status counts for the rest of the filter set.
    const summaryParams = { ...params, page: undefined, limit: undefined, eStampStatus: undefined };
    // Independent: a failing summary hides only the status cards, never the table.
    Promise.allSettled([apiClient.get("/orders", { params }), apiClient.get("/orders/summary", { params: summaryParams })]).then(([listRes, summaryRes]) => {
      if (seq !== loadSeq.current) return;
      if (listRes.status === "fulfilled") {
        setItems(listRes.value.data.data.items);
        setTotal(listRes.value.data.data.total);
      } else {
        setItems([]);
        setTotal(0);
        setError(actionErrorMessage(listRes.reason, "Failed to load orders."));
      }
      setSummary(summaryRes.status === "fulfilled" ? summaryRes.value.data.data : null);
      setLoading(false);
    });
  }, [page, limit, status, eStampStatus, stateCode, search, debouncedOrgName, dateFrom, dateTo, sortBy, sortDir, failedView, isInternal]);

  useEffect(() => {
    load();
  }, [load]);

  function resetPage(setter) {
    return (value) => {
      setPage(1);
      setter(value);
    };
  }

  // Queue cards reuse the same processing-status filter the dropdown drives.
  function filterByProcessingStatus(value) {
    setFailedView(false);
    setPage(1);
    setEStampStatus(value);
  }

  function selectFailed() {
    setPage(1);
    setEStampStatus("");
    setFailedView(true);
  }

  function clearFilters() {
    setPage(1);
    setSearchInput("");
    setSearch("");
    setStatus("");
    setEStampStatus("");
    setStateCode("");
    setOrganizationName("");
    setDateFrom("");
    setDateTo("");
    setFailedView(false);
  }

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const hasFilters = !!(search || status || eStampStatus || stateCode || organizationName || dateFrom || dateTo || failedView);
  const colCount = 8 + (isInternal ? 1 : 0) + (failedView ? 1 : 0);
  let emptyText = "No orders found";
  if (failedView) emptyText = "No failed orders";
  else if (IN_FLIGHT.includes(eStampStatus)) emptyText = "No processing orders";
  else if (hasFilters) emptyText = "No orders match these filters";

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="font-display text-2xl font-semibold text-slate-900">Orders</h1>
          <p className="text-sm text-slate-500">Manage E-Stamp processing, issuance and certificates</p>
        </div>
        <button onClick={load} disabled={loading} className="inline-flex min-h-[44px] sm:min-h-[40px] items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50 disabled:opacity-50">
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {summary && (
        <section aria-label="Processing queue" className="mb-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            <SummaryCard label="Total orders" value={summary.total} onClick={() => filterByProcessingStatus("")} active={!failedView && !eStampStatus} />
            <SummaryCard label="Created" value={summary.CREATED} onClick={() => filterByProcessingStatus("CREATED")} active={!failedView && eStampStatus === "CREATED"} />
            <SummaryCard label="Submitting" value={summary.SUBMITTING} onClick={() => filterByProcessingStatus("SUBMITTING")} active={!failedView && eStampStatus === "SUBMITTING"} />
            <SummaryCard label="Submitted" value={summary.SUBMITTED} onClick={() => filterByProcessingStatus("SUBMITTED")} active={!failedView && eStampStatus === "SUBMITTED"} />
            <SummaryCard label="Processing" value={summary.PROCESSING} onClick={() => filterByProcessingStatus("PROCESSING")} active={!failedView && eStampStatus === "PROCESSING"} />
            <SummaryCard label="Issued" value={summary.ISSUED} onClick={() => filterByProcessingStatus("ISSUED")} active={!failedView && eStampStatus === "ISSUED"} />
            <SummaryCard label="Failed" value={summary.FAILED} onClick={selectFailed} active={failedView} tone="danger" />
          </div>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          aria-label="Search orders"
          placeholder={`Search order # or ${refLabel.toLowerCase()}`}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className={`${inputClass} w-full sm:w-72`}
        />
        {isInternal && (
          <input
            aria-label="Organization name"
            placeholder="Organization name"
            value={organizationName}
            onChange={(e) => resetPage(setOrganizationName)(e.target.value)}
            className={`${inputClass} w-full sm:w-56`}
          />
        )}
        {states.length > 0 ? (
          <select aria-label="State" value={stateCode} onChange={(e) => resetPage(setStateCode)(e.target.value)} className={inputClass}>
            <option value="">All states</option>
            {states.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        ) : (
          <input aria-label="State code" placeholder="State code" value={stateCode} onChange={(e) => resetPage(setStateCode)(e.target.value)} className={`${inputClass} w-28`} />
        )}
        <select aria-label="Order status" value={status} onChange={(e) => resetPage(setStatus)(e.target.value)} className={inputClass}>
          <option value="">All order statuses</option>
          {statusOptions(STATUS_OPTIONS, { client: isClientRole(viewerRole) }).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Processing status"
          value={failedView ? "FAILED" : eStampStatus}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "FAILED") {
              selectFailed();
            } else {
              filterByProcessingStatus(v);
            }
          }}
          className={inputClass}
        >
          <option value="">All processing statuses</option>
          {statusOptions(PROCESSING_STATUS_OPTIONS, { client: isClientRole(viewerRole) }).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-2">
          <input aria-label="Created from" type="date" value={dateFrom} onChange={(e) => resetPage(setDateFrom)(e.target.value)} className={inputClass} />
          <span className="text-slate-400 text-sm">to</span>
          <input aria-label="Created to" type="date" value={dateTo} onChange={(e) => resetPage(setDateTo)(e.target.value)} className={inputClass} />
        </div>
        <select
          aria-label="Sort"
          value={`${sortBy}:${sortDir}`}
          onChange={(e) => {
            const [f, d] = e.target.value.split(":");
            setSortBy(f);
            setSortDir(d);
          }}
          className={inputClass}
        >
          <option value="createdAt:desc">Newest first</option>
          <option value="createdAt:asc">Oldest first</option>
          <option value="updatedAt:desc">Recently updated</option>
          <option value="amount:desc">Amount (high to low)</option>
          <option value="amount:asc">Amount (low to high)</option>
        </select>
        {hasFilters && (
          <button onClick={clearFilters} className="inline-flex min-h-[36px] items-center text-sm text-slate-600 hover:text-slate-900 hover:underline">
            Clear filters
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4">
          <ErrorState message={error} onRetry={load} />
        </div>
      )}

      {failedView && (
        <p className="mb-3 text-xs text-slate-500">
          FAILED is a terminal state. The backend does not offer an in-place retry for a failed order, so there is no Retry action here; open an order to see its failure reason.
        </p>
      )}

      {/* Desktop / tablet table */}
      <div className="hidden md:block card overflow-x-auto">
        <table className="w-full text-sm min-w-[960px]">
          <thead className="bg-slate-50 text-xs text-slate-600">
            <tr>
              <th className="whitespace-nowrap px-4 py-2.5 text-left font-semibold">Order</th>
              <th className="whitespace-nowrap px-4 py-2.5 text-left font-semibold">Request</th>
              {isInternal && <th className="whitespace-nowrap px-4 py-2.5 text-left font-semibold">Organization</th>}
              <th className="whitespace-nowrap px-4 py-2.5 text-left font-semibold">Status</th>
              <th className="whitespace-nowrap px-4 py-2.5 text-left font-semibold">Processing</th>
              <th className="whitespace-nowrap px-4 py-2.5 text-left font-semibold">{refLabel}</th>
              {failedView && <th className="whitespace-nowrap px-4 py-2.5 text-left font-semibold">Failure reason</th>}
              <th className="whitespace-nowrap px-4 py-2.5 text-right font-semibold">Amount</th>
              <th className="whitespace-nowrap px-4 py-2.5 text-left font-semibold">Created</th>
              <th className="whitespace-nowrap px-4 py-2.5 text-left font-semibold">{failedView ? "Last updated" : "Updated"}</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={colCount + 1} className="px-4 py-6">
                  <TableSkeleton rows={4} />
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && !error && (
              <tr>
                <td colSpan={colCount + 1}>
                  <EmptyState text={emptyText} />
                </td>
              </tr>
            )}
            {!loading &&
              items.map((o) => (
                <tr key={o._id} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-medium text-slate-900">{o.orderNumber}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {o.requestNumber && o.requestId ? (
                      <Link
                        to={`/estamps/requests/${o.requestId}`}
                        state={{ from: location.pathname + location.search, label: "Orders" }}
                        className="font-medium text-brand-700 hover:underline"
                      >
                        {o.requestNumber}
                      </Link>
                    ) : (
                      o.requestNumber || "-"
                    )}
                  </td>
                  {isInternal && <td className="px-4 py-3 text-slate-600">{o.organizationName || "-"}</td>}
                  <td className="px-4 py-3">
                    <StatusBadge status={o.status} />
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={o.eStampStatus} />
                  </td>
                  <td className="px-4 py-3 text-slate-500 font-mono text-xs">{o.providerReference || "Not available"}</td>
                  {failedView && (
                    <td className="px-4 py-3 text-slate-500 max-w-xs truncate" title={o.failureReason || ""}>
                      {o.failureReason || "Not recorded"}
                    </td>
                  )}
                  <td className="px-4 py-3 text-right">{formatCurrency(o.amount)}</td>
                  <td className="px-4 py-3 text-slate-500">{fmt(o.createdAt)}</td>
                  <td className="px-4 py-3 text-slate-500">{fmt(o.updatedAt)}</td>
                  <td className="px-4 py-3">
                    <Link
                      to={`/orders/${o._id}`}
                      state={{ from: location.pathname + location.search, label: "Orders" }}
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

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {loading && <TableSkeleton rows={3} />}
        {!loading && items.length === 0 && !error && (
          <div className="card">
            <EmptyState text={emptyText} />
          </div>
        )}
        {!loading &&
          items.map((o) => (
            <Link
              key={o._id}
              to={`/orders/${o._id}`}
              state={{ from: location.pathname + location.search, label: "Orders" }}
              className="block card p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium text-slate-900 break-all">{o.orderNumber}</span>
                <StatusBadge status={o.eStampStatus} />
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-500">
                <dt>Request</dt>
                <dd className="text-right text-slate-700">{o.requestNumber || "-"}</dd>
                {isInternal && (
                  <>
                    <dt>Organization</dt>
                    <dd className="text-right text-slate-700 break-words">{o.organizationName || "-"}</dd>
                  </>
                )}
                <dt>Amount</dt>
                <dd className="text-right text-slate-700">{formatCurrency(o.amount)}</dd>
                <dt>{manual ? "Stamp ref" : "Provider ref"}</dt>
                <dd className="text-right text-slate-700 break-all">{o.providerReference || "Not available"}</dd>
                {failedView && (
                  <>
                    <dt>Failure reason</dt>
                    <dd className="text-right text-slate-700 break-words">{o.failureReason || "Not recorded"}</dd>
                  </>
                )}
                <dt>Created</dt>
                <dd className="text-right text-slate-700">{fmt(o.createdAt)}</dd>
                <dt>{failedView ? "Last updated" : "Updated"}</dt>
                <dd className="text-right text-slate-700">{fmt(o.updatedAt)}</dd>
              </dl>
            </Link>
          ))}
      </div>

      {total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 mt-4 text-sm text-slate-500">
          <span>
            Page {page} of {totalPages} ({total} total)
          </span>
          <div className="space-x-2">
            <button disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)} className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 text-slate-700 hover:bg-slate-50 disabled:opacity-40">
              Previous
            </button>
            <button disabled={page >= totalPages || loading} onClick={() => setPage((p) => p + 1)} className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 text-slate-700 hover:bg-slate-50 disabled:opacity-40">
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, onClick, active, tone }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={!!active}
      className={`text-left bg-white rounded-2xl border p-4 transition-colors ${
        active ? (tone === "danger" ? "border-red-400 ring-2 ring-red-200" : "border-brand-400 ring-2 ring-brand-200") : "border-slate-200 hover:border-slate-300"
      }`}
    >
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`text-xl font-semibold ${tone === "danger" ? "text-red-600" : "text-slate-900"}`}>{value ?? 0}</p>
    </button>
  );
}
