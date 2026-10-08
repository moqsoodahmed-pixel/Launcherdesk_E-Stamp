import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { apiClient } from "../../api/client";
import { actionErrorMessage } from "../../utils/format";
import { safeRouteFor, NOTIFICATION_TYPE_LABELS, NOTIFICATION_TYPES } from "../../utils/notificationRoutes";
import EmptyState from "../../components/dashboard/EmptyState";
import { TableSkeleton } from "../../components/dashboard/LoadingSkeleton";

const inputClass = "rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500";

function fmt(d) {
  return d ? new Date(d).toLocaleString() : "-";
}

export default function NotificationsPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [type, setType] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    apiClient
      .get("/notifications", {
        params: {
          page,
          limit,
          unreadOnly: unreadOnly || undefined,
          type: type || undefined,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
        },
      })
      .then((res) => {
        setItems(res.data.data.items);
        setTotal(res.data.data.total);
        // The server's own unreadCount, never derived from the current page.
        setUnreadCount(res.data.data.unreadCount);
      })
      .catch((err) => setError(err?.response?.status === 403 ? "You do not have permission to access notifications." : actionErrorMessage(err, "Failed to load notifications.")))
      .finally(() => setLoading(false));
  }, [page, limit, unreadOnly, type, dateFrom, dateTo]);

  useEffect(() => {
    load();
  }, [load]);

  const reset = (setter) => (v) => {
    setPage(1);
    setter(v);
  };

  async function handleItemClick(notification) {
    setActionError(null);
    if (!notification.isRead) {
      try {
        await apiClient.patch(`/notifications/${notification._id}/read`);
        setItems((prev) => prev.map((n) => (n._id === notification._id ? { ...n, isRead: true, readAt: new Date().toISOString() } : n)));
        setUnreadCount((c) => Math.max(0, c - 1));
      } catch (err) {
        setActionError(actionErrorMessage(err, "Failed to mark notification as read."));
      }
    }
    const route = safeRouteFor(notification);
    if (route) navigate(route);
  }

  async function handleMarkAllRead() {
    setActionError(null);
    try {
      await apiClient.post("/notifications/read-all");
      setItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } catch (err) {
      setActionError(actionErrorMessage(err, "Failed to mark all notifications as read."));
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const hasFilters = !!(unreadOnly || type || dateFrom || dateTo);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Notifications</h1>
          <p className="text-sm text-slate-500">Stay updated on E-Stamp requests, payments, orders and account activity.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-xs text-slate-500">Unread</p>
            <p className="text-lg font-semibold text-slate-900 tabular-nums">{unreadCount}</p>
          </div>
          {unreadCount > 0 && (
            <button onClick={handleMarkAllRead} className="text-sm rounded-lg border border-slate-300 px-3 py-2 text-slate-600 hover:bg-slate-50">
              Mark all as read
            </button>
          )}
          <button onClick={load} disabled={loading} className="text-sm rounded-lg border border-slate-300 px-3 py-2 text-slate-600 hover:bg-slate-50 disabled:opacity-50">
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={unreadOnly} onChange={(e) => reset(setUnreadOnly)(e.target.checked)} className="rounded border-slate-300" />
          Unread only
        </label>
        <select aria-label="Type" value={type} onChange={(e) => reset(setType)(e.target.value)} className={inputClass}>
          <option value="">All types</option>
          {NOTIFICATION_TYPES.map((t) => (
            <option key={t} value={t}>
              {NOTIFICATION_TYPE_LABELS[t]}
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
              setUnreadOnly(false);
              setType("");
              setDateFrom("");
              setDateTo("");
            }}
            className="text-sm text-slate-500 hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {error && (
        <div role="alert" className="mb-4 rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">
          {error}
        </div>
      )}
      {actionError && (
        <div role="alert" className="mb-4 rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">
          {actionError}
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {loading && (
          <div className="p-4">
            <TableSkeleton rows={5} />
          </div>
        )}
        {!loading && items.length === 0 && !error && (
          <EmptyState text={hasFilters ? "No notifications match your filters." : "You're all caught up. No new notifications."} />
        )}
        {!loading && items.length > 0 && (
          <ul className="divide-y divide-slate-100">
            {items.map((n) => {
              const navigable = !!safeRouteFor(n);
              return (
                <li key={n._id}>
                  <button
                    onClick={() => handleItemClick(n)}
                    className={`w-full text-left flex items-start gap-3 px-4 py-4 hover:bg-slate-50 ${!n.isRead ? "bg-brand-50/40" : ""}`}
                  >
                    <span
                      aria-hidden="true"
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${!n.isRead ? "bg-brand-600" : "bg-transparent"}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className={`text-sm ${!n.isRead ? "font-semibold text-slate-900" : "font-medium text-slate-700"}`}>{n.title}</span>
                        <span className="text-[11px] uppercase tracking-wide text-slate-400">{NOTIFICATION_TYPE_LABELS[n.type] || n.type}</span>
                        {!n.isRead && (
                          <span className="text-[10px] font-medium uppercase tracking-wide text-brand-700 bg-brand-100 rounded-full px-1.5 py-0.5">Unread</span>
                        )}
                      </span>
                      <p className="text-sm text-slate-500 mt-0.5 break-words">{n.message}</p>
                      <p className="text-xs text-slate-400 mt-1">
                        {fmt(n.createdAt)}
                        {navigable && <span className="text-brand-600"> · View details</span>}
                      </p>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
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
