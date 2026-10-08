import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { apiClient } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { hasPermission, PERMISSIONS } from "../utils/permissions";

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 350;
const RESULT_LIMIT = 5;

// Each group only ever calls the SAME endpoint + `search` param its own list
// page already uses (OrganizationsListPage/UsersListPage/RequestsListPage/
// OrdersListPage/PaymentsListPage) - no new API, no new search capability,
// and the exact same backend tenant-scoping those pages already rely on
// (a tenant actor is forced to their own organization server-side
// regardless of this search term; this component never sends an
// organizationId of its own). A group is only ever fetched when the actor
// holds the same permission that page's sidebar entry/route already
// requires - never "fetch then hide".
const GROUPS = [
  { key: "organizations", label: "Organizations", permission: PERMISSIONS.CLIENT_VIEW, url: "/organizations", routeFor: (item) => `/organizations/${item._id}`, primary: (item) => item.name, secondary: (item) => item.contactEmail },
  { key: "users", label: "Users", permission: PERMISSIONS.USER_VIEW, url: "/users", routeFor: (item) => `/users/${item._id}`, primary: (item) => item.name, secondary: (item) => item.email },
  { key: "requests", label: "E-Stamp Requests", permission: PERMISSIONS.ESTAMP_VIEW, url: "/estamps", routeFor: (item) => `/estamps/requests/${item._id}`, primary: (item) => item.requestNumber, secondary: (item) => item.stateCode },
  { key: "orders", label: "Orders", permission: PERMISSIONS.ORDER_VIEW, url: "/orders", routeFor: (item) => `/orders/${item._id}`, primary: (item) => item.orderNumber, secondary: (item) => item.eStampStatus },
  { key: "payments", label: "Payments", permission: PERMISSIONS.PAYMENT_VIEW, url: "/payments", routeFor: (item) => `/payments/${item._id}`, primary: (item) => item.razorpayOrderId, secondary: (item) => item.status },
];

export default function GlobalSearch() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const containerRef = useRef(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState({});

  const groups = GROUPS.filter((g) => hasPermission(user, g.permission));

  const runSearch = useCallback(
    (term) => {
      if (term.trim().length < MIN_QUERY_LENGTH || groups.length === 0) {
        setResults({});
        setLoading(false);
        return;
      }
      setLoading(true);
      Promise.allSettled(groups.map((g) => apiClient.get(g.url, { params: { search: term.trim(), page: 1, limit: RESULT_LIMIT } }))).then((settled) => {
        const next = {};
        settled.forEach((r, i) => {
          next[groups[i].key] = r.status === "fulfilled" ? r.value.data.data.items || [] : [];
        });
        setResults(next);
        setLoading(false);
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groups.map((g) => g.key).join(",")]
  );

  useEffect(() => {
    const t = setTimeout(() => runSearch(query), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query, runSearch]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleKeyDown(e) {
    if (e.key === "Escape") {
      setOpen(false);
      e.currentTarget.blur();
    }
  }

  function goTo(group, item) {
    setOpen(false);
    setQuery("");
    navigate(group.routeFor(item));
  }

  const trimmed = query.trim();
  const hasAnyResults = Object.values(results).some((items) => items.length > 0);
  const showPanel = open && trimmed.length >= MIN_QUERY_LENGTH;

  if (groups.length === 0) return null;

  return (
    <div className="relative flex-1 min-w-0 max-w-xs" ref={containerRef}>
      <input
        type="search"
        role="searchbox"
        aria-label="Search"
        placeholder="Search organizations, users, requests..."
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
      />

      {showPanel && (
        <div className="absolute left-0 right-0 mt-1 bg-white rounded-xl border border-slate-200 shadow-lg z-50 max-h-96 overflow-y-auto">
          {loading && <div className="px-4 py-6 text-center text-sm text-slate-400">Searching...</div>}
          {!loading && !hasAnyResults && <div className="px-4 py-6 text-center text-sm text-slate-400">No results for "{trimmed}".</div>}
          {!loading &&
            groups.map((g) => {
              const items = results[g.key] || [];
              if (items.length === 0) return null;
              return (
                <div key={g.key} className="border-b border-slate-50 last:border-0">
                  <p className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{g.label}</p>
                  {items.map((item) => (
                    <button
                      key={item._id}
                      type="button"
                      onClick={() => goTo(g, item)}
                      className="w-full text-left px-4 py-2 hover:bg-slate-50 text-sm"
                    >
                      <span className="block font-medium text-slate-900 truncate">{g.primary(item) || "-"}</span>
                      {g.secondary(item) && <span className="block text-xs text-slate-500 truncate">{g.secondary(item)}</span>}
                    </button>
                  ))}
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
