import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { apiClient } from "../api/client";
import { formatCurrency } from "../utils/format";
import { hasPermission, PERMISSIONS } from "../utils/permissions";

// Available balance is tracked per organization - so it is visible to
// client tenant roles (Super Admin, Admin, User).
const TENANT_ROLES = new Set(["SUPER_ADMIN", "ADMIN", "USER"]);

export default function NavbarBalance() {
  const { user } = useAuth();
  const [balance, setBalance] = useState(null);
  const [loading, setLoading] = useState(true);

  const canView = Boolean(user && TENANT_ROLES.has(user.role));
  const canOpenWallet = hasPermission(user, PERMISSIONS.WALLET_VIEW);

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

  if (!canView) return null;

  const availBal = balance?.availableBalance ?? balance?.balance ?? 0;
  // If balance is low or zero (<= 0), show red color; otherwise show green color.
  const isLowOrZero = availBal <= 0;

  const content = (
    <div
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border transition-all duration-200 ${
        isLowOrZero
          ? "bg-red-50/90 text-red-700 border-red-200 hover:bg-red-100/90 shadow-sm"
          : "bg-emerald-50/90 text-emerald-800 border-emerald-200 hover:bg-emerald-100/90 shadow-sm"
      }`}
      title={isLowOrZero ? `Available balance is low or zero: ${formatCurrency(availBal)}` : `Available balance: ${formatCurrency(availBal)}`}
      aria-label={`Available balance: ${formatCurrency(availBal)}`}
    >
      <span className="relative flex h-2 w-2 shrink-0">
        {isLowOrZero && (
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
        )}
        <span
          className={`relative inline-flex rounded-full h-2 w-2 ${
            isLowOrZero ? "bg-red-500" : "bg-emerald-500"
          }`}
        />
      </span>
      <span className="hidden sm:inline text-slate-500 font-normal">Available:</span>
      <span className={`font-bold tabular-nums ${isLowOrZero ? "text-red-600" : "text-emerald-700"}`}>
        {loading && balance === null ? "..." : formatCurrency(availBal)}
      </span>
    </div>
  );

  if (canOpenWallet) {
    return (
      <Link to="/wallet" className="focus:outline-none focus:ring-2 focus:ring-blue-500/30 rounded-full">
        {content}
      </Link>
    );
  }

  return content;
}
