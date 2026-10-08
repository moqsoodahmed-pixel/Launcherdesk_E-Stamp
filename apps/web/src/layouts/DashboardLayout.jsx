import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { getSidebarSections, getFlatSidebarItems } from "./sidebarConfig";
import NotificationBell from "../components/NotificationBell";
import GlobalSearch from "../components/GlobalSearch";

// Phase 21 - matches a nested route (e.g. /orders/507f...) to its parent
// sidebar item (/orders) via a "longest matching prefix" rule rather than an
// exact match, so a detail page still highlights the list item that leads to
// it. Items carrying a literal querystring (e.g. /users?role=USER) are only
// ever active on an EXACT pathname+search match against another such item -
// otherwise two sibling items sharing the same pathname (Manage Users /
// Manage Admins, both "/users") would both light up together.
function isItemActive(item, pathname, search, allItems) {
  const [itemPath, itemQuery] = item.to.split("?");
  if (itemQuery) {
    return pathname === itemPath && search.replace(/^\?/, "") === itemQuery;
  }
  if (pathname !== itemPath && !pathname.startsWith(`${itemPath}/`)) return false;
  const longestOtherMatch = allItems
    .filter((i) => i !== item && !i.to.includes("?"))
    .map((i) => i.to.split("?")[0])
    .filter((p) => pathname === p || pathname.startsWith(`${p}/`))
    .reduce((max, p) => Math.max(max, p.length), 0);
  return itemPath.length >= longestOtherMatch;
}

function SidebarNav({ sections, allItems, pathname, search, onNavigate }) {
  return (
    <nav className="flex-1 overflow-y-auto py-3" aria-label="Main navigation">
      {sections.map((sec) => (
        <div key={sec.heading} className="mb-3">
          <p className="px-5 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{sec.heading}</p>
          {sec.items.map((item) => {
            const active = isItemActive(item, pathname, search, allItems);
            return (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={onNavigate}
                className={`block px-5 py-2.5 text-sm rounded-lg mx-2 mb-1 ${active ? "bg-brand-50 text-brand-700 font-medium" : "text-slate-600 hover:bg-slate-100"}`}
              >
                {item.label}
              </NavLink>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

export default function DashboardLayout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const sections = getSidebarSections(user?.role || "USER", user?.permissions);
  const allItems = getFlatSidebarItems(user?.role || "USER", user?.permissions);

  // Close the mobile drawer on every navigation, and on Escape for keyboard
  // users - a drawer left open after navigating (or with no keyboard escape
  // hatch) is exactly the "zero responsive behavior" gap this phase fixes.
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!mobileOpen) return undefined;
    function onKeyDown(e) {
      if (e.key === "Escape") setMobileOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mobileOpen]);

  const sidebarBody = (closeOnNavigate) => (
    <>
      <div className="px-5 py-5 border-b border-slate-200 flex items-center justify-between">
        <div>
          <p className="font-semibold text-slate-900">LauncherDesk</p>
          <p className="text-xs text-slate-500">E-Stamping</p>
        </div>
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="lg:hidden rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
          aria-label="Close menu"
        >
          ✕
        </button>
      </div>
      <SidebarNav sections={sections} allItems={allItems} pathname={location.pathname} search={location.search} onNavigate={closeOnNavigate ? () => setMobileOpen(false) : undefined} />
      <div className="px-5 py-4 border-t border-slate-200">
        <p className="text-xs text-slate-500 mb-2 truncate">{user?.email}</p>
        <button onClick={() => logout()} className="text-sm text-red-600 hover:underline">
          Logout
        </button>
      </div>
    </>
  );

  return (
    // Phase 21 shell fix: `h-dvh overflow-hidden` (a hard, viewport-bound
    // height that CANNOT grow) replaces the old `min-h-screen` (which COULD
    // grow taller than the viewport). With min-h-screen, a tall page made
    // the outer div itself the thing that grew - so the browser window/body
    // scrolled as the primary scroll container, and the `<nav>`/`<main>`
    // overflow-y-auto below never got a chance to take over. Locking the
    // outer container to the viewport height forces every scrollable region
    // to be exactly what it declares (`<nav>` sidebar links, `<main>` page
    // content) - the page chrome (header, sidebar rail, footer) never moves.
    <div className="h-dvh overflow-hidden flex bg-slate-50">
      {/* Desktop sidebar - always visible at lg+, a static flex column so the
          bottom email/logout block stays pinned while only the middle nav
          scrolls independently. */}
      <aside className="hidden lg:flex w-64 shrink-0 bg-white border-r border-slate-200 flex-col">{sidebarBody(false)}</aside>

      {/* Mobile/tablet drawer - an overlay + backdrop below lg, closed by
          default. Rendered unconditionally (not just when open) so it can
          transition, but hidden from assistive tech and pointer events when
          closed. */}
      <div className={`lg:hidden fixed inset-0 z-40 ${mobileOpen ? "" : "pointer-events-none"}`} aria-hidden={!mobileOpen}>
        <div
          className={`absolute inset-0 bg-slate-900/40 transition-opacity ${mobileOpen ? "opacity-100" : "opacity-0"}`}
          onClick={() => setMobileOpen(false)}
        />
        <aside
          className={`absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-white border-r border-slate-200 flex flex-col shadow-xl transition-transform duration-200 ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}
          role="dialog"
          aria-modal="true"
          aria-label="Main navigation"
        >
          {sidebarBody(true)}
        </aside>
      </div>

      <main className="flex-1 min-w-0 overflow-y-auto">
        <div className="flex items-center justify-between px-4 sm:px-6 pt-4 gap-2">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="lg:hidden rounded-lg p-2 text-slate-600 hover:bg-slate-100"
            aria-label="Open menu"
            aria-expanded={mobileOpen}
          >
            <span className="text-xl leading-none">☰</span>
          </button>
          <GlobalSearch />
          <div className="flex-1" />
          <NotificationBell />
        </div>
        <div className="max-w-6xl mx-auto p-4 sm:p-6 pt-2">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
