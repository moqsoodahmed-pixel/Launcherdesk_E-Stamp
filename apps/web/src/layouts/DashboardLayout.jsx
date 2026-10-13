import { useEffect, useRef, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  UserCog,
  Building2,
  Store,
  FilePlus2,
  FileText,
  Files,
  Package,
  ClipboardCheck,
  Send,
  ScanSearch,
  Stamp,
  PlugZap,
  BadgeIndianRupee,
  Wallet,
  CreditCard,
  BookOpen,
  Settings,
  BarChart3,
  Bell,
  ScrollText,
  ShieldCheck,
  History,
  UserRound,
  Info,
  Briefcase,
  Menu,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  LogOut,
  ChevronDown,
  Circle,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { getSidebarSections, getFlatSidebarItems, getActiveItem } from "./sidebarConfig";
import { fulfilmentModeOf } from "../utils/fulfilment";
import ErrorBoundary from "../components/common/ErrorBoundary";
import NotificationBell from "../components/NotificationBell";
import GlobalSearch from "../components/GlobalSearch";
import { LogoMark } from "../components/brand/Brand";

// Icon per route (path without the querystring).
const ICONS = {
  "/dashboard": LayoutDashboard,
  "/organizations": Building2,
  "/assistant-admins": UserCog,
  "/vendors": Store,
  "/users": Users,
  "/estamps/requests/new": FilePlus2,
  "/estamps/requests": FileText,
  "/estamps/bulk": Files,
  "/orders/fulfil": ClipboardCheck,
  "/orders/dispatch": Send,
  "/orders/vendor-review": ScanSearch,
  "/orders": Package,
  "/vendor/orders": Package,
  "/estamps": Stamp,
  "/estamp-provider": PlugZap,
  "/payments/credit-queue": BadgeIndianRupee,
  "/payments": CreditCard,
  "/wallet": Wallet,
  "/articles": BookOpen,
  "/settings": Settings,
  "/reports": BarChart3,
  "/notifications": Bell,
  "/audit": ScrollText,
  "/policies/manage": ShieldCheck,
  "/policies": ShieldCheck,
  "/organization/profile": Briefcase,
  "/audit/mine": History,
  "/profile": UserRound,
  "/about": Info,
};
function iconFor(item) {
  return ICONS[item.to.split("?")[0]] || Circle;
}

// Sidebar config keeps its headings as constants; show them in sentence case.
function sentenceCase(text) {
  const lower = String(text || "").toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export const ROLE_NAMES = {
  MASTER_ADMIN: "Master admin",
  ASSISTANT_MASTER_ADMIN: "Assistant master admin",
  SUPER_ADMIN: "Super admin",
  ADMIN: "Admin",
  USER: "User",
  VENDOR: "Vendor",
};

const COLLAPSE_KEY = "ld_sidebar_collapsed";
function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}
function writeCollapsed(value) {
  try {
    localStorage.setItem(COLLAPSE_KEY, value ? "1" : "0");
  } catch {
    /* storage unavailable: the rail just won't be remembered */
  }
}

function SidebarNav({ sections, allItems, pathname, search, onNavigate, collapsed }) {
  // Exactly one item (or none) is highlighted - see getActiveItem.
  const activeItem = getActiveItem(allItems, pathname, search);
  return (
    <nav className="flex-1 overflow-y-auto overflow-x-hidden py-3" aria-label="Main navigation">
      {sections.map((sec) => (
        <div key={sec.heading} className="mb-4">
          {collapsed ? (
            <span className="sr-only">{sentenceCase(sec.heading)}</span>
          ) : (
            <p className="px-5 pb-1.5 pt-1 text-xs font-medium text-role-sidebar-muted">{sentenceCase(sec.heading)}</p>
          )}
          {sec.items.map((item) => {
            const active = item === activeItem;
            const ItemIcon = iconFor(item);
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                title={collapsed ? item.label : undefined}
                className={`nav-item relative mx-2 mb-0.5 flex min-h-[44px] items-center gap-3 rounded-lg text-sm transition-colors ${collapsed ? "justify-center px-0" : "px-3"} ${
                  active ? "nav-active bg-role-sidebar-active font-medium text-white" : "text-white/80 hover:bg-role-sidebar-hover hover:text-white"
                }`}
              >
                {active && <span className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-marigold-400" aria-hidden="true" />}
                <ItemIcon size={18} strokeWidth={1.75} className="shrink-0" aria-hidden="true" />
                <span className={collapsed ? "sr-only" : "truncate"}>{item.label}</span>
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

// Keyboard-operable account menu: Enter/Space/ArrowDown opens, arrows move,
// Escape closes and returns focus to the button.
function UserMenu({ user, onLogout }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const name = user?.name || user?.email || "";
  const initials =
    String(name)
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join("") || "U";

  useEffect(() => {
    if (!open) return undefined;
    menuRef.current?.querySelector("[role='menuitem']")?.focus();
    function onDocClick(e) {
      if (!menuRef.current?.contains(e.target) && !buttonRef.current?.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  function onMenuKeyDown(e) {
    const items = [...(menuRef.current?.querySelectorAll("[role='menuitem']") || [])];
    const index = items.indexOf(document.activeElement);
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      items[(index + 1) % items.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[(index - 1 + items.length) % items.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      items[items.length - 1]?.focus();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  const itemCls = "flex min-h-[44px] w-full items-center gap-2.5 px-3 text-left text-sm text-slate-700 hover:bg-slate-50 focus:bg-slate-50 focus:outline-none";
  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="flex h-11 items-center gap-1.5 rounded-lg pl-1 pr-2 text-slate-700 hover:bg-slate-100"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800">{initials}</span>
        <ChevronDown size={16} className="hidden text-slate-500 sm:block" aria-hidden="true" />
      </button>
      {open && (
        <div ref={menuRef} role="menu" aria-label="Account" onKeyDown={onMenuKeyDown} className="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-overlay">
          <div className="border-b border-slate-100 px-3 py-2.5">
            {user?.name && <p className="truncate text-sm font-medium text-slate-900">{user.name}</p>}
            <p className="truncate text-xs text-slate-500">{user?.email}</p>
          </div>
          {user?.role !== "VENDOR" && (
            <>
              <Link role="menuitem" tabIndex={-1} to="/profile" onClick={() => setOpen(false)} className={itemCls}>
                <UserRound size={16} aria-hidden="true" /> Your profile
              </Link>
            </>
          )}
          <button
            role="menuitem"
            tabIndex={-1}
            type="button"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
            className={`${itemCls} text-vermilion-700`}
          >
            <LogOut size={16} aria-hidden="true" /> Logout
          </button>
        </div>
      )}
    </div>
  );
}

export default function DashboardLayout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const role = user?.role || "USER";
  const sections = getSidebarSections(role, user?.permissions, fulfilmentModeOf(user));
  const allItems = getFlatSidebarItems(role, user?.permissions, fulfilmentModeOf(user));
  const orgName = user?.organizationName || "LauncherDesk";
  const roleName = ROLE_NAMES[role] || role;

  // Close the mobile drawer on every navigation, and on Escape for keyboard
  // users.
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

  function toggleCollapsed() {
    setCollapsed((c) => {
      writeCollapsed(!c);
      return !c;
    });
  }

  const sidebarBody = (closeOnNavigate, rail) => (
    <>
      <div className={`flex items-center gap-3 border-b border-white/10 py-4 ${rail ? "justify-center px-2" : "px-4"}`}>
        <LogoMark className="h-9 w-9 shrink-0" />
        {!rail && (
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-[15px] font-semibold leading-tight text-white" title={orgName}>
              {orgName}
            </p>
            <p className="truncate text-xs text-role-sidebar-muted">{roleName}</p>
          </div>
        )}
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="flex h-10 w-10 items-center justify-center rounded-lg text-white/80 hover:bg-white/10 lg:hidden"
          aria-label="Close menu"
        >
          <X size={20} aria-hidden="true" />
        </button>
      </div>
      <SidebarNav
        sections={sections}
        allItems={allItems}
        pathname={location.pathname}
        search={location.search}
        onNavigate={closeOnNavigate ? () => setMobileOpen(false) : undefined}
        collapsed={rail}
      />
      <div className={`border-t border-white/10 py-3 ${rail ? "px-2" : "px-4"}`}>
        {!rail && <p className="mb-1 truncate text-xs text-role-sidebar-muted">{user?.email}</p>}
        <button
          onClick={() => logout()}
          className={`flex min-h-[40px] items-center gap-2 rounded-lg text-sm text-white/90 hover:bg-white/10 hover:text-white ${rail ? "w-full justify-center" : "-mx-2 px-2"}`}
          title={rail ? "Logout" : undefined}
        >
          <LogOut size={16} aria-hidden="true" />
          <span className={rail ? "sr-only" : ""}>Logout</span>
        </button>
      </div>
    </>
  );

  return (
    // `h-dvh overflow-hidden`: the shell is viewport-bound, so only the
    // sidebar nav and <main> scroll; the chrome never moves.
    <div data-role={role} className="flex h-dvh overflow-hidden bg-paper">
      {/* Desktop sidebar, collapsible to an icon rail. */}
      <aside className={`hidden shrink-0 flex-col bg-role-sidebar text-white transition-[width] duration-200 lg:flex ${collapsed ? "w-[72px]" : "w-64"}`}>{sidebarBody(false, collapsed)}</aside>

      {/* Mobile/tablet drawer. Rendered unconditionally so it can transition,
          hidden from assistive tech and pointer events when closed. */}
      <div className={`fixed inset-0 z-40 lg:hidden ${mobileOpen ? "" : "pointer-events-none"}`} aria-hidden={!mobileOpen}>
        <div className={`absolute inset-0 bg-midnight-900/50 transition-opacity ${mobileOpen ? "opacity-100" : "opacity-0"}`} onClick={() => setMobileOpen(false)} />
        <aside
          className={`absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-role-sidebar text-white shadow-overlay transition-transform duration-200 ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}
          role="dialog"
          aria-modal="true"
          aria-label="Main navigation"
        >
          {sidebarBody(true, false)}
        </aside>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3 sm:px-5">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 lg:hidden"
            aria-label="Open menu"
            aria-expanded={mobileOpen}
          >
            <Menu size={22} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={toggleCollapsed}
            className="hidden h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 lg:flex"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-pressed={collapsed}
          >
            {collapsed ? <PanelLeftOpen size={20} aria-hidden="true" /> : <PanelLeftClose size={20} aria-hidden="true" />}
          </button>
          {user?.role !== "VENDOR" && <GlobalSearch />}
          <div className="flex-1" />
          <span className="hidden rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-800 ring-1 ring-inset ring-brand-200 md:inline">{roleName}</span>
          <NotificationBell />
          <UserMenu user={user} onLogout={() => logout()} />
        </header>
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-content px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
            <ErrorBoundary resetKey={`${location.pathname}${location.search}`}>
              <Outlet />
            </ErrorBoundary>
          </div>
        </main>
      </div>
    </div>
  );
}
