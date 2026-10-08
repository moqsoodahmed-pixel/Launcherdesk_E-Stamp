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
    return () => clearInterval(interval);
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
      <button onClick={togglePanel} className="relative rounded-full p-2 hover:bg-slate-100" aria-label="Notifications">
        <span className="text-xl">🔔</span>
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-red-600 text-white text-[10px] leading-none rounded-full px-1.5 py-1 font-medium">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-white rounded-2xl border border-slate-200 shadow-lg z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <span className="text-sm font-medium text-slate-900">Notifications</span>
            <button onClick={handleMarkAllRead} className="text-xs text-brand-600 hover:underline">
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
          <Link to="/notifications" onClick={() => setOpen(false)} className="block px-4 py-2.5 text-center text-sm text-brand-600 hover:bg-slate-50 border-t border-slate-100">
            View all
          </Link>
        </div>
      )}
    </div>
  );
}
