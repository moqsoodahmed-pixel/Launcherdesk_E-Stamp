import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { apiClient } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { hasPermission, PERMISSIONS } from "../../utils/permissions";
import { actionErrorMessage, formatCurrency } from "../../utils/format";
import PaymentStatusBadge from "../../components/payments/PaymentStatusBadge";
import BalanceStatusBadge from "../../components/payments/BalanceStatusBadge";
import EmptyState from "../../components/dashboard/EmptyState";
import { TableSkeleton } from "../../components/dashboard/LoadingSkeleton";

// Mirrors the backend PaymentStatus enum.
const STATUS_OPTIONS = ["CREATED", "SUCCESS", "FAILED", "REFUNDED"];
const SEARCH_DEBOUNCE_MS = 400;
const inputClass = "rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500";

function fmt(d) {
  return d ? new Date(d).toLocaleString() : "-";
}

export default function PaymentsListPage() {
  const { user } = useAuth();
  const isInternal = user?.role === "MASTER_ADMIN" || user?.role === "ASSISTANT_MASTER_ADMIN";
  const canView = hasPermission(user, PERMISSIONS.PAYMENT_VIEW);

  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [orgs, setOrgs] = useState([]);
  const [organizationId, setOrganizationId] = useState("");
  const [status, setStatus] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isInternal) return;
    apiClient
      .get("/organizations", { params: { limit: 100 } })
      .then((res) => setOrgs(res.data.data.items || []))
      .catch(() => setOrgs([]));
  }, [isInternal]);

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
    if (!canView) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    apiClient
      .get("/payments", {
        params: {
          page,
          limit,
          organizationId: isInternal ? organizationId || undefined : undefined,
          status: status || undefined,
          search: search || undefined,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
        },
      })
      .then((res) => {
        setItems(res.data.data.items);
        setTotal(res.data.data.total);
      })
      .catch((err) => setError(err?.response?.status === 403 ? "You do not have permission to access financial information." : actionErrorMessage(err, "Failed to load payments.")))
      .finally(() => setLoading(false));
  }, [page, limit, organizationId, status, search, dateFrom, dateTo, isInternal, canView]);

  useEffect(() => {
    load();
  }, [load]);

  const reset = (setter) => (v) => {
    setPage(1);
    setter(v);
  };
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const hasFilters = !!(organizationId || status || search || dateFrom || dateTo);

  if (!canView) {
    return (
      <div>
        <h1 className="font-display text-2xl font-semibold text-slate-900">Payments</h1>
        <p className="mt-4 rounded-lg bg-slate-50 border border-slate-200 text-slate-600 text-sm px-4 py-3">You do not currently have financial access.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="font-display text-2xl font-semibold text-slate-900">Payments</h1>
          <p className="text-sm text-slate-500">Wallet funding payments and their outcome</p>
        </div>
        <button onClick={load} disabled={loading} className="inline-flex min-h-[44px] sm:min-h-[40px] items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50 disabled:opacity-50">
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input aria-label="Search payments" placeholder="Search Razorpay order or payment ID" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} className={`${inputClass} w-full sm:w-72`} />
        {isInternal && (
          <select aria-label="Organization" value={organizationId} onChange={(e) => reset(setOrganizationId)(e.target.value)} className={inputClass}>
            <option value="">All organizations</option>
            {orgs.map((o) => (
              <option key={o._id} value={o._id}>
                {o.name}
              </option>
            ))}
          </select>
        )}
        <select aria-label="Status" value={status} onChange={(e) => reset(setStatus)(e.target.value)} className={inputClass}>
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-2">
          <input aria-label="Created from" type="date" value={dateFrom} onChange={(e) => reset(setDateFrom)(e.target.value)} className={inputClass} />
          <span className="text-slate-400 text-sm">to</span>
          <input aria-label="Created to" type="date" value={dateTo} onChange={(e) => reset(setDateTo)(e.target.value)} className={inputClass} />
        </div>
        {hasFilters && (
          <button
            onClick={() => {
              setPage(1);
              setSearchInput("");
              setSearch("");
              setOrganizationId("");
              setStatus("");
              setDateFrom("");
              setDateTo("");
            }}
            className="inline-flex min-h-[36px] items-center text-sm text-slate-600 hover:text-slate-900 hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {error && (
        <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="hidden md:block card overflow-x-auto">
        <table className="w-full text-sm min-w-[960px]">
          <thead className="bg-slate-50 text-xs text-slate-600">
            <tr>
              {isInternal && <th className="whitespace-nowrap px-4 py-2.5 text-left font-semibold">Organization</th>}
              {isInternal && <th className="whitespace-nowrap px-4 py-2.5 text-left font-semibold">Paid By</th>}
              <th className="whitespace-nowrap px-4 py-2.5 text-left font-semibold">Plan / Type</th>
              <th className="whitespace-nowrap px-4 py-2.5 text-right font-semibold">Amount</th>
              <th className="whitespace-nowrap px-4 py-2.5 text-left font-semibold">Status</th>
              <th className="whitespace-nowrap px-4 py-2.5 text-left font-semibold">Balance</th>
              <th className="whitespace-nowrap px-4 py-2.5 text-left font-semibold">Transaction ID</th>
              <th className="whitespace-nowrap px-4 py-2.5 text-left font-semibold">Invoice</th>
              <th className="whitespace-nowrap px-4 py-2.5 text-left font-semibold">Date & Time</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={isInternal ? 10 : 8} className="px-4 py-6">
                  <TableSkeleton rows={4} />
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && !error && (
              <tr>
                <td colSpan={isInternal ? 10 : 8}>
                  <EmptyState text={hasFilters ? "No payments match these filters" : "No payments found"} />
                </td>
              </tr>
            )}
            {!loading &&
              items.map((p) => (
                <tr key={p._id} className="border-t border-slate-100 hover:bg-slate-50/50">
                  {isInternal && <td className="px-4 py-3 font-medium text-slate-900">{p.organizationName || "-"}</td>}
                  {isInternal && (
                    <td className="px-4 py-3 text-slate-600">
                      <div className="font-medium text-slate-800">{p.createdByName || "-"}</div>
                      {p.createdByEmail && <div className="text-xs text-slate-400">{p.createdByEmail}</div>}
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <span className="inline-block px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-700 font-medium">
                      {p.plan || "Wallet Balance"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-slate-900 tabular-nums">{formatCurrency(p.amount)}</td>
                  <td className="px-4 py-3">
                    <PaymentStatusBadge status={p.status} />
                  </td>
                  <td className="px-4 py-3">
                    <BalanceStatusBadge payment={p} />
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">
                    {p.transactionId || p.razorpayPaymentId || p.razorpayOrderId}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600 font-medium">
                    {p.invoiceNumber || "-"}
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{fmt(p.createdAt)}</td>
                  <td className="px-4 py-3">
                    <Link to={`/payments/${p._id}`} className="font-medium text-brand-700 hover:underline">
                      View
                    </Link>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <div className="md:hidden space-y-3">
        {loading && <TableSkeleton rows={3} />}
        {!loading && items.length === 0 && !error && (
          <div className="card">
            <EmptyState text={hasFilters ? "No payments match these filters" : "No payments found"} />
          </div>
        )}
        {!loading &&
          items.map((p) => (
            <Link key={p._id} to={`/payments/${p._id}`} className="block card p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-900 tabular-nums">{formatCurrency(p.amount)}</span>
                <span className="flex flex-wrap gap-1 justify-end">
                  <PaymentStatusBadge status={p.status} />
                  <BalanceStatusBadge payment={p} />
                </span>
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-500">
                {isInternal && (
                  <>
                    <dt>Organization</dt>
                    <dd className="text-right text-slate-700 break-words">{p.organizationName || "-"}</dd>
                    <dt>Paid By</dt>
                    <dd className="text-right text-slate-700">{p.createdByName || p.createdByEmail || "-"}</dd>
                  </>
                )}
                <dt>Plan</dt>
                <dd className="text-right text-slate-700">{p.plan || "Wallet Balance"}</dd>
                <dt>Transaction</dt>
                <dd className="text-right text-slate-700 break-all font-mono">{p.transactionId || p.razorpayPaymentId || p.razorpayOrderId}</dd>
                {p.invoiceNumber && (
                  <>
                    <dt>Invoice</dt>
                    <dd className="text-right text-slate-700 font-mono font-medium">{p.invoiceNumber}</dd>
                  </>
                )}
                <dt>Date & Time</dt>
                <dd className="text-right text-slate-700">{fmt(p.createdAt)}</dd>
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
