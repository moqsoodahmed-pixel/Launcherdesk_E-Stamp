import { useEffect, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { getSidebarSections, getFlatSidebarItems, getActiveItem } from "./sidebarConfig";
import { fulfilmentModeOf } from "../utils/fulfilment";
import ErrorBoundary from "../components/common/ErrorBoundary";
import NotificationBell from "../components/NotificationBell";
import GlobalSearch from "../components/GlobalSearch";
import OrganizationBadge from "../components/OrganizationBadge";
import NavbarBalance from "../components/NavbarBalance";

// Served from /public (not bundled through src/assets) - an animated GIF
// plays automatically wherever it's rendered as a plain <img>, no extra
// animation code needed. BASE_URL (Vite's `base` config, "/e-stamp/" in
// production - see vite.config.js) must be prefixed here: unlike a module
// import, a public-folder asset referenced as a raw string is never
// rewritten by Vite, so a hardcoded "/..." path 404s wherever the app is
// deployed under a sub-path instead of the domain root.
const PLATFORM_LOGO = `${import.meta.env.BASE_URL}launcherdesk-logo-animated-BMOHLLXe.gif`;

// Display-only helpers for the sidebar user card.
function initialsOf(user) {
  const source = (user?.name || user?.email || "").trim();
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "U";
}

function roleLabelOf(role) {
  if (!role) return "";
  return role
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function SidebarNav({ sections, allItems, pathname, search, onNavigate }) {
  // Exactly one item (or none) is highlighted - see getActiveItem.
  const activeItem = getActiveItem(allItems, pathname, search);
  return (
    <nav className="flex-1 overflow-y-auto px-4 py-6 space-y-6" aria-label="Main navigation">
      {sections.map((sec) => (
        <div key={sec.heading} className="space-y-1.5">
          <p className="px-4 pb-2 text-[11px] font-bold uppercase tracking-[0.2em] text-black/30">{sec.heading}</p>
          {sec.items.map((item) => {
            const active = item === activeItem;
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 px-4 py-3 text-sm rounded-2xl border transition-all duration-300 ${active ? "bg-brand-50 liquid-glass sidebar-item-active font-semibold" : "border-transparent text-black/70 font-medium hover:bg-white/50 hover:border-white/80 hover:text-black"}`}
              >
                <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${active ? "bg-[#0066FF] shadow-[0_0_8px_#60a5fa]" : "bg-black/20"}`} />
                {item.label}
              </Link>
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
  const sections = getSidebarSections(user?.role || "USER", user?.permissions, fulfilmentModeOf(user));
  const allItems = getFlatSidebarItems(user?.role || "USER", user?.permissions, fulfilmentModeOf(user));

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
      <div className="px-6 py-6 border-b border-white/40 flex items-center justify-between">
        <Link
          to="/dashboard"
          onClick={closeOnNavigate ? () => setMobileOpen(false) : undefined}
          className="flex items-center group focus:outline-none focus:ring-2 focus:ring-blue-500/30 rounded-2xl p-1"
          aria-label="Dashboard - LauncherDesk"
        >
          <img
            src={PLATFORM_LOGO}
            alt="LauncherDesk"
            className="h-10 w-auto max-w-[190px] object-contain transition-opacity group-hover:opacity-90"
          />
        </Link>
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="lg:hidden liquid-glass rounded-full w-9 h-9 flex items-center justify-center text-black/60 hover:text-black"
          aria-label="Close menu"
        >
          ✕
        </button>
      </div>
      <SidebarNav sections={sections} allItems={allItems} pathname={location.pathname} search={location.search} onNavigate={closeOnNavigate ? () => setMobileOpen(false) : undefined} />
      <div className="p-5 border-t border-white/40 space-y-3">
        <div className="liquid-glass flex items-center gap-3 p-3.5 rounded-3xl">
          <div className="w-10 h-10 shrink-0 rounded-full bg-white/70 border border-black/10 flex items-center justify-center text-xs font-bold text-[#1d1d1f]" aria-hidden="true">
            {initialsOf(user)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-[#1d1d1f] truncate">{user?.name || user?.email}</p>
            <p className="text-[10px] font-medium text-black/40 truncate">{roleLabelOf(user?.role)}</p>
            {user?.name && <p className="text-[10px] text-black/40 truncate">{user?.email}</p>}
          </div>
        </div>
        <button
          onClick={() => logout()}
          className="liquid-glass w-full flex items-center justify-center gap-2 px-4 py-3 text-xs font-bold text-red-600/80 hover:text-red-600 hover:bg-white/80 rounded-2xl"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></svg>
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
    <div className="h-dvh overflow-hidden flex">
      {/* Desktop sidebar - always visible at lg+, a static flex column so the
          bottom email/logout block stays pinned while only the middle nav
          scrolls independently. */}
      <aside className="hidden lg:flex w-72 shrink-0 bg-white/30 backdrop-blur-3xl border-r border-white/50 flex-col">{sidebarBody(false)}</aside>

      {/* Mobile/tablet drawer - an overlay + backdrop below lg, closed by
          default. Rendered unconditionally (not just when open) so it can
          transition, but hidden from assistive tech and pointer events when
          closed. */}
      <div className={`lg:hidden fixed inset-0 z-40 ${mobileOpen ? "" : "pointer-events-none"}`} aria-hidden={!mobileOpen}>
        <div
          className={`absolute inset-0 bg-slate-900/20 backdrop-blur-sm transition-opacity ${mobileOpen ? "opacity-100" : "opacity-0"}`}
          onClick={() => setMobileOpen(false)}
        />
        <aside
          className={`absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-white/80 backdrop-blur-3xl border-r border-white/60 flex flex-col shadow-2xl transition-transform duration-200 ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}
          role="dialog"
          aria-modal="true"
          aria-label="Main navigation"
        >
          {sidebarBody(true)}
        </aside>
      </div>

      <main className="flex-1 min-w-0 overflow-y-auto">
        <div className="sticky top-0 z-30 flex items-center justify-between px-4 sm:px-8 h-16 sm:h-20 gap-3 bg-white/20 backdrop-blur-2xl border-b border-white/40">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="lg:hidden liquid-glass rounded-full w-10 h-10 flex items-center justify-center text-black/60 hover:text-black"
            aria-label="Open menu"
            aria-expanded={mobileOpen}
          >
            <span className="text-xl leading-none">☰</span>
          </button>
          {user?.role !== "VENDOR" && <GlobalSearch />}
          <NotificationBell />
          <div className="flex-1" />
          <NavbarBalance />
          <OrganizationBadge />
        </div>
        <div className="max-w-6xl mx-auto p-4 sm:p-8 animate-fade-in">
          <ErrorBoundary resetKey={`${location.pathname}${location.search}`}>
            <Outlet />
          </ErrorBoundary>
        </div>
      </main>
    </div>
  );
}
