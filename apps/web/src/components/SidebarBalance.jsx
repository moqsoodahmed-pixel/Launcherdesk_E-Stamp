import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { apiClient } from "../api/client";
import { formatCurrency } from "../utils/format";

const TENANT_ROLES = new Set(["SUPER_ADMIN", "ADMIN", "USER"]);

export default function SidebarBalance({ item, active, onNavigate }) {
  const { user } = useAuth();
  const [balance, setBalance] = useState(null);
  const [loading, setLoading] = useState(true);

  const canView = Boolean(user && TENANT_ROLES.has(user.role));

  const fetchBalance = useCallback(() => {
    if (!canView) return;
    apiClient
      .get("/wallet/balance")
      .then((res) => {
        setBalance(res.data.data);
        setLoading(false);
      })
      .catch(() => {
        setBalance(null);
        setLoading(false);
      });
  }, [canView]);

  useEffect(() => {
    if (!canView) {
      setBalance(null);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    fetchBalance();

    function onRefresh() {
      fetchBalance();
    }

    window.addEventListener("ld:balance_refresh", onRefresh);
    window.addEventListener("ld:payment_success", onRefresh);
    return () => {
      window.removeEventListener("ld:balance_refresh", onRefresh);
      window.removeEventListener("ld:payment_success", onRefresh);
    };
  }, [canView, user?.organizationId, fetchBalance]);

  const availBal = balance?.availableBalance ?? balance?.balance ?? 0;
  const isLowOrZero = availBal <= 0;

  return (
    <Link
      to={item.to}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`flex items-center justify-between gap-2 px-3.5 py-2.5 text-sm rounded-2xl border transition-all duration-300 ${
        active
          ? "bg-brand-50 liquid-glass sidebar-item-active font-semibold"
          : "border-transparent text-black/70 font-medium hover:bg-white/50 hover:border-white/80 hover:text-black"
      }`}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <span aria-hidden="true" className="relative flex h-2 w-2 shrink-0">
          {isLowOrZero && (
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
          )}
          <span
            className={`relative inline-flex rounded-full h-2 w-2 ${
              isLowOrZero ? "bg-red-500" : "bg-emerald-500"
            }`}
          />
        </span>
        <span className="whitespace-nowrap">{item.label}</span>
      </div>
      {canView && (
        <span
          className={`shrink-0 text-xs font-bold tabular-nums px-2 py-0.5 rounded-full border transition-colors ${
            isLowOrZero
              ? "bg-red-50 text-red-600 border-red-200"
              : "bg-emerald-50 text-emerald-700 border-emerald-200"
          }`}
        >
          {loading && balance === null ? "..." : formatCurrency(availBal)}
        </span>
      )}
    </Link>
  );
}
