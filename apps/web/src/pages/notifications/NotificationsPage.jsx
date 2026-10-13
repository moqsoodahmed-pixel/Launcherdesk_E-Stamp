import { Bell, CheckCheck, CreditCard, ShieldAlert, Stamp, Store, UserCog } from "lucide-react";
import Toast from "../../components/ui/Toast";
import { useViewerRole } from "../../components/ui/StatusChip";
import { isClientRole } from "../../components/ui/status";
import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { apiClient } from "../../api/client";
import { actionErrorMessage } from "../../utils/format";
import { safeRouteFor, NOTIFICATION_TYPE_LABELS, NOTIFICATION_TYPES } from "../../utils/notificationRoutes";
import EmptyState from "../../components/dashboard/EmptyState";
import { TableSkeleton } from "../../components/dashboard/LoadingSkeleton";

const inputClass = "input w-auto";

// One icon per notification type, so the list scans by kind.
const TYPE_ICON = {
  ASSISTANT_ADMIN_ACTIVITY: UserCog,
  SECURITY_ALERT: ShieldAlert,
  ESTAMP_STATUS: Stamp,
  PAYMENT: CreditCard,
  GENERAL: Bell,
  VENDOR_ACTIVITY: Store,
};
const TYPE_TONE = {
  SECURITY_ALERT: "bg-vermilion-50 text-vermilion-700",
  ESTAMP_STATUS: "bg-brand-50 text-brand-700",
  PAYMENT: "bg-emerald-50 text-emerald-700",
  VENDOR_ACTIVITY: "bg-magenta-50 text-magenta-700",
};
// Internal activity types never reach client roles; their filter options
// are hidden from them too.
const STAFF_ONLY_TYPES = ["ASSISTANT_ADMIN_ACTIVITY", "VENDOR_ACTIVITY"];

function fmt(d) {
  return d ? new Date(d).toLocaleString() : "-";
}

export default function NotificationsPage() {
  const viewerRole = useViewerRole();
  const typeOptions = isClientRole(viewerRole) ? NOTIFICATION_TYPES.filter((t) => !STAFF_ONLY_TYPES.includes(t)) : NOTIFICATION_TYPES;
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
          <h1 className="font-display text-2xl font-semibold text-slate-900">Notifications</h1>
          <p className="mt-1 text-sm text-slate-600">Stay updated on E-Stamp requests, payments, orders and account activity.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-white px-3 py-1.5 text-right ring-1 ring-inset ring-slate-200">
            <p className="text-xs text-slate-600">Unread</p>
            <p className="font-display text-lg font-semibold leading-tight text-slate-900 tabular-nums">{unreadCount}</p>
          </div>
          {unreadCount > 0 && (
            <button onClick={handleMarkAllRead} className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700 sm:min-h-[40px]">
              <CheckCheck size={16} aria-hidden="true" />
              Mark all as read
            </button>
          )}
          <button onClick={load} disabled={loading} className="inline-flex min-h-[44px] sm:min-h-[40px] items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50 disabled:opacity-50">
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <label className="flex min-h-[44px] items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={unreadOnly} onChange={(e) => reset(setUnreadOnly)(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600" />
          Unread only
        </label>
        <select aria-label="Type" value={type} onChange={(e) => reset(setType)(e.target.value)} className={inputClass}>
          <option value="">All types</option>
          {typeOptions.map((t) => (
            <option key={t} value={t}>
              {NOTIFICATION_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-2">
          <input aria-label="Created from" type="date" value={dateFrom} onChange={(e) => reset(setDateFrom)(e.target.value)} className={inputClass} />
          <span className="text-sm text-slate-600">to</span>
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
            className="inline-flex min-h-[36px] items-center text-sm text-slate-600 hover:text-slate-900 hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {error && (
        <Toast tone="error" className="mb-4">
          {error}
        </Toast>
      )}
      {actionError && (
        <Toast tone="error" className="mb-4">
          {actionError}
        </Toast>
      )}

      <div className="card overflow-hidden">
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
              const TypeIcon = TYPE_ICON[n.type] || Bell;
              return (
                <li key={n._id}>
                  <button
                    onClick={() => handleItemClick(n)}
                    className={`relative flex w-full items-start gap-3 px-4 py-4 text-left transition-colors hover:bg-slate-50 sm:px-5 ${!n.isRead ? "bg-brand-50/40" : ""}`}
                  >
                    {!n.isRead && <span aria-hidden="true" className="absolute inset-y-3 left-0 w-[3px] rounded-r-full bg-brand-600" />}
                    <span aria-hidden="true" className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${TYPE_TONE[n.type] || "bg-slate-100 text-slate-600"}`}>
                      <TypeIcon size={18} strokeWidth={1.75} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className={`text-sm ${!n.isRead ? "font-semibold text-slate-900" : "font-medium text-slate-700"}`}>{n.title}</span>
                        <span className="text-xs text-slate-500">{NOTIFICATION_TYPE_LABELS[n.type] || n.type}</span>
                        {!n.isRead && (
                          <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-800">Unread</span>
                        )}
                      </span>
                      <p className="mt-0.5 break-words text-sm text-slate-600">{n.message}</p>
                      <p className="mt-1 text-xs text-slate-500 tabular-nums">
                        {fmt(n.createdAt)}
                        {navigable && <span className="font-medium text-brand-700"> · View details</span>}
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
