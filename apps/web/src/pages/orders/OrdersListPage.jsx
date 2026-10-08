import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { apiClient } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import StatusBadge from "../../components/estamps/StatusBadge";
import EmptyState from "../../components/dashboard/EmptyState";
import { TableSkeleton } from "../../components/dashboard/LoadingSkeleton";
import { actionErrorMessage, formatCurrency } from "../../utils/format";

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
  const { user } = useAuth();
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

  const load = useCallback(() => {
    const params = {
      page,
      limit,
      status: status || undefined,
      eStampStatus: failedView ? "FAILED" : eStampStatus || undefined,
      stateCode: stateCode || undefined,
      search: search || undefined,
      organizationName: isInternal ? organizationName || undefined : undefined,
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
    Promise.all([apiClient.get("/orders", { params }), apiClient.get("/orders/summary", { params: summaryParams })])
      .then(([listRes, summaryRes]) => {
        setItems(listRes.data.data.items);
        setTotal(listRes.data.data.total);
        setSummary(summaryRes.data.data);
      })
      .catch((err) => setError(actionErrorMessage(err, "Failed to load orders.")))
      .finally(() => setLoading(false));
  }, [page, limit, status, eStampStatus, stateCode, search, organizationName, dateFrom, dateTo, sortBy, sortDir, failedView, isInternal]);

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
          <h1 className="text-xl font-semibold text-slate-900">Orders</h1>
          <p className="text-sm text-slate-500">Manage E-Stamp processing, issuance and certificates</p>
        </div>
        <button onClick={load} disabled={loading} className="text-sm rounded-lg border border-slate-300 px-3 py-2 text-slate-600 hover:bg-slate-50 disabled:opacity-50">
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
          placeholder="Search order # or provider reference"
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
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
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
          {PROCESSING_STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
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
          <button onClick={clearFilters} className="text-sm text-slate-500 hover:underline">
            Clear filters
          </button>
        )}
      </div>

      {error && (
        <div role="alert" className="mb-4 rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">
          {error}
        </div>
      )}

      {failedView && (
        <p className="mb-3 text-xs text-slate-500">
          FAILED is a terminal state. The backend does not offer an in-place retry for a failed order, so there is no Retry action here; open an order to see its failure reason.
        </p>
      )}

      {/* Desktop / tablet table */}
      <div className="hidden md:block bg-white rounded-2xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm min-w-[960px]">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3">Order</th>
              <th className="text-left px-4 py-3">Request</th>
              {isInternal && <th className="text-left px-4 py-3">Organization</th>}
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-left px-4 py-3">Processing</th>
              <th className="text-left px-4 py-3">Provider reference</th>
              {failedView && <th className="text-left px-4 py-3">Failure reason</th>}
              <th className="text-right px-4 py-3">Amount</th>
              <th className="text-left px-4 py-3">Created</th>
              <th className="text-left px-4 py-3">{failedView ? "Last updated" : "Updated"}</th>
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
                    {o.requestNumber ? (
                      <Link to={`/estamps/requests/${o.requestId}`} className="text-brand-600 hover:underline">
                        {o.requestNumber}
                      </Link>
                    ) : (
                      "-"
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
                    <Link to={`/orders/${o._id}`} className="text-brand-600 hover:underline">
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
          <div className="bg-white rounded-2xl border border-slate-200">
            <EmptyState text={emptyText} />
          </div>
        )}
        {!loading &&
          items.map((o) => (
            <Link key={o._id} to={`/orders/${o._id}`} className="block bg-white rounded-2xl border border-slate-200 p-4">
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
                <dt>Provider ref</dt>
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
            <button disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)} className="px-3 py-1 rounded-lg border border-slate-300 disabled:opacity-40">
              Previous
            </button>
            <button disabled={page >= totalPages || loading} onClick={() => setPage((p) => p + 1)} className="px-3 py-1 rounded-lg border border-slate-300 disabled:opacity-40">
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
