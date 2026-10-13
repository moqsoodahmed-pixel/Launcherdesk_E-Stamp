import { Bell } from "lucide-react";
import { useEffect, useState, useRef, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import { apiClient } from "../api/client";
import { safeRouteFor } from "../utils/notificationRoutes";

export default function NotificationBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef(null);

  const loadUnreadCount = useCallback(() => {
    apiClient
      .get("/notifications/unread-count")
      .then((res) => setUnreadCount(res.data.data.unreadCount))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadUnreadCount();
    const interval = setInterval(loadUnreadCount, 30000); // periodic poll for the badge only - not the full list
    const handleRefresh = () => loadUnreadCount();
    window.addEventListener("ld:notifications_refresh", handleRefresh);
    return () => {
      clearInterval(interval);
      window.removeEventListener("ld:notifications_refresh", handleRefresh);
    };
  }, [loadUnreadCount]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function loadList() {
    setLoading(true);
    apiClient
      .get("/notifications", { params: { limit: 10 } })
      .then((res) => {
        setItems(res.data.data.items);
        setUnreadCount(res.data.data.unreadCount);
      })
      .finally(() => setLoading(false));
  }

  function togglePanel() {
    const next = !open;
    setOpen(next);
    if (next) loadList();
  }

  async function handleItemClick(notification) {
    if (!notification.isRead) {
      try {
        await apiClient.patch(`/notifications/${notification._id}/read`);
        setItems((prev) => prev.map((n) => (n._id === notification._id ? { ...n, isRead: true } : n)));
        setUnreadCount((c) => Math.max(0, c - 1));
      } catch {
        /* best-effort - navigation still proceeds */
      }
    }
    const route = safeRouteFor(notification);
    if (route) {
      setOpen(false);
      navigate(route);
    }
  }

  async function handleMarkAllRead() {
    try {
      await apiClient.post("/notifications/read-all");
      setItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } catch {
      /* best-effort */
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <button onClick={togglePanel} className="relative flex h-11 w-11 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900" aria-label="Notifications" aria-expanded={open}>
        <Bell size={20} strokeWidth={1.75} aria-hidden="true" />
        {unreadCount > 0 && (
          <span className="absolute right-1 top-1 rounded-full bg-vermilion-600 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white tabular-nums ring-2 ring-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-overlay">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <span className="font-display text-sm font-semibold text-slate-900">Notifications</span>
            <button onClick={handleMarkAllRead} className="min-h-[32px] text-xs font-medium text-brand-700 hover:underline">
              Mark all read
            </button>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {loading && <div className="px-4 py-6 text-center text-sm text-slate-400">Loading...</div>}
            {!loading && items.length === 0 && <div className="px-4 py-6 text-center text-sm text-slate-400">No notifications.</div>}
            {items.map((n) => (
              <button
                key={n._id}
                onClick={() => handleItemClick(n)}
                className={`w-full text-left px-4 py-3 border-b border-slate-50 last:border-0 hover:bg-slate-50 ${!n.isRead ? "bg-brand-50/40" : ""}`}
              >
                <p className="text-sm font-medium text-slate-900">{n.title}</p>
                <p className="text-xs text-slate-500 line-clamp-2">{n.message}</p>
                <p className="text-[11px] text-slate-400 mt-1">{new Date(n.createdAt).toLocaleString()}</p>
              </button>
            ))}
          </div>
          <Link to="/notifications" onClick={() => setOpen(false)} className="block border-t border-slate-100 px-4 py-3 text-center text-sm font-medium text-brand-700 hover:bg-slate-50">
            View all
          </Link>
        </div>
      )}
    </div>
  );
}
