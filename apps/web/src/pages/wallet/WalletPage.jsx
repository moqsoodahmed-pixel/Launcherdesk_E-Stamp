import { useEffect, useState, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { apiClient } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { hasPermission, PERMISSIONS } from "../../utils/permissions";
import { actionErrorMessage, formatCurrency } from "../../utils/format";
import PaymentStatusBadge from "../../components/payments/PaymentStatusBadge";
import BalanceStatusBadge from "../../components/payments/BalanceStatusBadge";
import DateRangeFilter, { TREND_PRESETS } from "../../components/dashboard/DateRangeFilter";
import EmptyState from "../../components/dashboard/EmptyState";

export function loadRazorpayScript() {
  return new Promise((resolve, reject) => {
    if (window.Razorpay) return resolve();
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = resolve;
    script.onerror = () => {
      // Remove the failed tag so the next "Add money" click retries the load.
      script.remove();
      reject(new Error("Failed to load Razorpay checkout"));
    };
    document.body.appendChild(script);
  });
}

// Fallback shown only until GET /payments/topup-config resolves - the real,
// Master-Admin-configurable minimum (see settingsRegistry.js MIN_WALLET_TOPUP)
// always wins once loaded. Enforced server-side regardless of what this page
// shows, so this is never more than a client-side suggestion.
export const DEFAULT_MIN_TOPUP_AMOUNT = 1117;

// Builds the "Minimum ₹X — covers ..." hint shown next to Add Money, naming
// whichever reference article(s) a Master Admin configured (e.g. "Article
// 30(1)(i) - Lease of Immovable Property, Karnataka") instead of the generic
// "10 E-Stamps" when none are configured. Exported so BuyMoreModal.jsx's
// "Custom Amount Top-Up" shows the identical hint, same reuse pattern as
// loadRazorpayScript above.
export function topupHint(config) {
  if (config.referenceArticles && config.referenceArticles.length > 0) {
    const names = config.referenceArticles.map((a) => `Article ${a.articleCode} – ${a.title}, ${a.stateName}`).join("; ");
    return `Minimum ₹${config.minAmount} — covers ${names}`;
  }
  return `Minimum ₹${config.minAmount} — covers 10 E-Stamps`;
}

const TX_BADGE = {
  CREDIT: "bg-green-100 text-green-700",
  DEBIT: "bg-red-100 text-red-700",
  REFUND: "bg-slate-200 text-slate-700",
  ADJUSTMENT: "bg-amber-100 text-amber-700",
};

// Ledger label: new entries already carry a readable description
// ("Balance added, payment pay_…", "E-Stamp request LDE-REQ-…").
function txLabel(t) {
  if (t.description) return t.description;
  return t.type === "CREDIT" ? "Balance added" : t.type === "DEBIT" ? "E-Stamp request" : t.type;
}

function fmt(d) {
  return d ? new Date(d).toLocaleString() : "-";
}

export default function WalletPage() {
  const { user } = useAuth();
  const isInternal = user?.role === "MASTER_ADMIN" || user?.role === "ASSISTANT_MASTER_ADMIN";
  const canViewWallet = hasPermission(user, PERMISSIONS.WALLET_VIEW);
  const canViewPayments = hasPermission(user, PERMISSIONS.PAYMENT_VIEW);
  const canFund = hasPermission(user, PERMISSIONS.PAYMENT_MANAGE);
  const canViewSummary = hasPermission(user, PERMISSIONS.REPORT_VIEW) && hasPermission(user, PERMISSIONS.REPORT_FINANCIAL_VIEW);

  // Internal actors have no organization of their own and must pick one.
  const [orgs, setOrgs] = useState([]);
  const [orgId, setOrgId] = useState("");
  const scopeReady = !isInternal || !!orgId;
  const base = isInternal ? `/wallet/${orgId}` : "/wallet";

  const [balance, setBalance] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [payments, setPayments] = useState([]);
  const [summary, setSummary] = useState(null);
  const [preset, setPreset] = useState("last30days");
  const [loading, setLoading] = useState(true);
  const [sectionErrors, setSectionErrors] = useState({});
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);

  const [amount, setAmount] = useState("");
  // null | "creating" | "opening" | "verifying"
  const [fundStep, setFundStep] = useState(null);
  const fundingRef = useRef(false);
  const [topupConfig, setTopupConfig] = useState({ minAmount: DEFAULT_MIN_TOPUP_AMOUNT, referenceArticles: [] });

  useEffect(() => {
    if (!isInternal) return;
    apiClient
      .get("/organizations", { params: { limit: 100 } })
      .then((res) => setOrgs(res.data.data.items || []))
      .catch(() => setOrgs([]));
  }, [isInternal]);

  useEffect(() => {
    if (!canFund) return;
    apiClient
      .get("/payments/topup-config")
      .then((res) => setTopupConfig(res.data.data))
      .catch(() => {}); // keep the safe default - never blocks Add Money from rendering
  }, [canFund]);

  const load = useCallback(async () => {
    if (!scopeReady) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const orgParam = isInternal ? { organizationId: orgId } : {};
    const tasks = {
      balance: canViewWallet ? apiClient.get(`${base}/balance`) : null,
      transactions: canViewWallet ? apiClient.get(`${base}/transactions`, { params: { limit: 10 } }) : null,
      payments: canViewPayments ? apiClient.get("/payments", { params: { limit: 5, ...orgParam } }) : null,
      summary: canViewSummary ? apiClient.get("/reports/financial", { params: { preset, ...orgParam } }) : null,
    };
    const keys = Object.keys(tasks);
    const settled = await Promise.allSettled(keys.map((k) => tasks[k] || Promise.resolve(null)));
    const errs = {};
    settled.forEach((r, i) => {
      const k = keys[i];
      if (r.status === "rejected") {
        errs[k] = actionErrorMessage(r.reason, "Failed to load.");
        // Never leave the previous organization's figures under a new error.
        if (k === "balance") setBalance(null);
        if (k === "transactions") setTransactions([]);
        if (k === "payments") setPayments([]);
        if (k === "summary") setSummary(null);
        return;
      }
      const d = r.value?.data?.data;
      if (k === "balance" && d) {
        setBalance(d);
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("ld:balance_refresh"));
        }
      }
      if (k === "transactions" && d) setTransactions(d.items || []);
      if (k === "payments" && d) setPayments(d.items || []);
      if (k === "summary" && d) setSummary(d);
    });
    setSectionErrors(errs);
    setLoading(false);
  }, [scopeReady, isInternal, orgId, base, canViewWallet, canViewPayments, canViewSummary, preset]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAddFunds(e) {
    e.preventDefault();
    if (fundingRef.current) return; // guards double-submit before state flushes
    setError(null);
    setNotice(null);
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount < topupConfig.minAmount) {
      setError(`Enter a valid amount of at least ₹${topupConfig.minAmount}.`);
      return;
    }
    if (numericAmount > 1000000) {
      setError("Maximum top-up amount is ₹10,00,000.");
      return;
    }
    fundingRef.current = true;
    setFundStep("creating");
    const finish = () => {
      fundingRef.current = false;
      setFundStep(null);
    };
    try {
      const { data } = await apiClient.post("/payments/razorpay/order", { amount: numericAmount, ...(isInternal ? { organizationId: orgId } : {}) });
      const order = data.data;
      if (!order.keyId) {
        // No real Razorpay credentials in this environment. We never
        // simulate a "Payment Successful" screen.
        setError("Payment gateway is not configured in this environment. Wallet funding is unavailable until Razorpay credentials are set.");
        finish();
        return;
      }
      setFundStep("opening");
      await loadRazorpayScript();
      const razorpay = new window.Razorpay({
        key: order.keyId,
        amount: Math.round(order.amount * 100),
        currency: "INR",
        order_id: order.razorpayOrderId,
        name: "LauncherDesk E-Stamping",
        description: "Wallet funding",
        handler: async (response) => {
          setFundStep("verifying");
          try {
            await apiClient.post("/payments/razorpay/verify", {
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
            });
            setNotice("Payment received. Your balance will be updated once LauncherDesk confirms it.");
            setAmount("");
          } catch (err) {
            setError(actionErrorMessage(err, "Payment verification failed."));
          } finally {
            // Always re-read server state: a webhook may have credited the
            // wallet even if this verify call failed. Never adjust locally.
            await load();
            finish();
          }
        },
        modal: { ondismiss: () => finish() },
      });
      razorpay.on("payment.failed", () => {
        setError("Payment failed or was cancelled.");
        finish();
      });
      razorpay.open();
    } catch (err) {
      setError(actionErrorMessage(err, "Failed to start payment."));
      finish();
    }
  }

  const stepLabel = { creating: "Creating payment...", opening: "Opening secure payment...", verifying: "Verifying payment..." }[fundStep];

  if (!canViewWallet && !canViewPayments) {
    return (
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Wallet</h1>
        <p className="mt-4 rounded-lg bg-slate-50 border border-slate-200 text-slate-600 text-sm px-4 py-3">You do not currently have financial access.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Wallet</h1>
          <p className="text-sm text-slate-500">Manage balance, funding and financial activity</p>
        </div>
        <button onClick={load} disabled={loading || !scopeReady} className="text-sm rounded-lg border border-slate-300 px-3 py-2 text-slate-600 hover:bg-slate-50 disabled:opacity-50">
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {isInternal && (
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <label className="text-xs text-slate-500 block mb-1" htmlFor="wallet-org">
            Organization
          </label>
          <select id="wallet-org" value={orgId} onChange={(e) => { setOrgId(e.target.value); setBalance(null); setSummary(null); setTransactions([]); setPayments([]); }} className="w-full sm:w-80 rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="">Select an organization…</option>
            {orgs.map((o) => (
              <option key={o._id} value={o._id}>
                {o.name}
              </option>
            ))}
          </select>
          {!orgId && <p className="text-xs text-slate-500 mt-2">Wallets belong to organizations. Choose one to view its balance and activity.</p>}
        </div>
      )}

      {notice && <div role="status" className="rounded-lg bg-green-50 text-green-700 text-sm px-3 py-2">{notice}</div>}
      {error && <div role="alert" className="rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>}

      {scopeReady && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {canViewWallet && (
              <div className="bg-white rounded-2xl border border-slate-200 p-6">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm text-slate-500">Available balance</p>
                  {!sectionErrors.balance && balance !== null && (
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${
                        (balance?.availableBalance ?? balance?.balance ?? 0) <= 0
                          ? "bg-red-50 text-red-700 border-red-200"
                          : "bg-emerald-50 text-emerald-700 border-emerald-200"
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          (balance?.availableBalance ?? balance?.balance ?? 0) <= 0 ? "bg-red-500" : "bg-emerald-500"
                        }`}
                      />
                      {(balance?.availableBalance ?? balance?.balance ?? 0) <= 0 ? "Low / Zero" : "Available"}
                    </span>
                  )}
                </div>
                {sectionErrors.balance ? (
                  <p className="text-sm text-red-600">{sectionErrors.balance}</p>
                ) : (
                  <>
                    <p
                      className={`text-3xl font-bold tabular-nums ${
                        (balance?.availableBalance ?? balance?.balance ?? 0) <= 0 ? "text-red-600" : "text-emerald-600"
                      }`}
                    >
                      {loading && balance === null ? "…" : formatCurrency(balance?.availableBalance ?? balance?.balance ?? 0)}
                    </p>
                    {balance?.reservedBalance !== undefined && (
                      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <dt className="text-xs text-slate-500">Reserved</dt>
                          <dd className="font-medium text-slate-900 tabular-nums">{formatCurrency(balance.reservedBalance ?? 0)}</dd>
                          <dd className="text-xs text-slate-400">held for requests in their 20-minute window</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-slate-500">Balance</dt>
                          <dd className="font-medium text-slate-900 tabular-nums">{formatCurrency(balance.balance ?? 0)}</dd>
                        </div>
                      </dl>
                    )}
                  </>
                )}
                <p className="text-xs text-slate-400 mt-2">A request reserves its amount when submitted and is charged when its 20-minute window ends. Cancelling inside the window costs nothing.</p>
              </div>
            )}

            {canFund && (
              <div className="bg-white rounded-2xl border border-slate-200 p-6">
                <h2 className="font-medium text-slate-900 mb-3">Add money</h2>
                <p className="text-xs text-slate-500 mb-2">{topupHint(topupConfig)}</p>
                <form onSubmit={handleAddFunds} className="flex flex-col sm:flex-row gap-2">
                  <input
                    aria-label="Amount in rupees"
                    type="number"
                    min={topupConfig.minAmount}
                    max="1000000"
                    step="1"
                    inputMode="numeric"
                    placeholder={`Amount (min ₹${topupConfig.minAmount})`}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    disabled={!!fundStep}
                    className="flex-1 min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                  <button
                    disabled={!!fundStep || !amount || Number(amount) < topupConfig.minAmount || Number(amount) > 1000000}
                    className="bg-brand-600 hover:bg-brand-700 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
                  >
                    {stepLabel || "Add Money"}
                  </button>
                </form>
                <p className="text-xs text-slate-400 mt-2">You pay securely with Razorpay. Your balance is updated after LauncherDesk confirms the payment.</p>
              </div>
            )}
          </div>

          {canViewSummary && (
            <section className="bg-white rounded-2xl border border-slate-200 p-6">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <h2 className="font-medium text-slate-900">Financial summary</h2>
                <DateRangeFilter value={preset} onChange={setPreset} options={TREND_PRESETS} />
              </div>
              {sectionErrors.summary ? (
                <p className="text-sm text-red-600">{sectionErrors.summary}</p>
              ) : summary ? (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
                  <Stat label="Successful payments" value={formatCurrency(summary.payments.successfulAmount)} sub={`${summary.payments.successfulCount} payments`} />
                  <Stat label="Failed payments" value={String(summary.payments.failedCount)} sub={formatCurrency(summary.payments.failedAmount)} />
                  <Stat label="Wallet credits" value={formatCurrency(summary.walletTransactions.totalCredits)} sub={`${summary.walletTransactions.creditCount} transactions`} />
                  <Stat label="Wallet debits" value={formatCurrency(summary.walletTransactions.totalDebits)} sub={`${summary.walletTransactions.debitCount} transactions`} />
                </div>
              ) : (
                <EmptyState text="No summary available" />
              )}
              <p className="text-xs text-slate-400 mt-3">From the Reports module for the selected period. Detailed analytics live in Reports.</p>
            </section>
          )}

          {canViewPayments && (
            <section className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                <h2 className="font-medium text-slate-900 text-sm">Recent payments</h2>
                <Link to="/payments" className="text-sm text-brand-600 hover:underline">
                  View all
                </Link>
              </div>
              {sectionErrors.payments && <p className="px-4 py-3 text-sm text-red-600">{sectionErrors.payments}</p>}
              {!sectionErrors.payments && payments.length === 0 && !loading && <EmptyState text="No payments yet" />}
              <ul className="divide-y divide-slate-100">
                {payments.map((p) => (
                  <li key={p._id}>
                    <Link to={`/payments/${p._id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-slate-50 text-sm">
                      <span className="font-medium text-slate-900 tabular-nums">{formatCurrency(p.amount)}</span>
                      <PaymentStatusBadge status={p.status} />
                      <BalanceStatusBadge payment={p} />
                      <span className="text-slate-400 text-xs">{fmt(p.createdAt)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {canViewWallet && (
            <section className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 font-medium text-slate-900 text-sm">Balance ledger</div>
              {sectionErrors.transactions && <p className="px-4 py-3 text-sm text-red-600">{sectionErrors.transactions}</p>}
              {!sectionErrors.transactions && transactions.length === 0 && !loading && <EmptyState text="No transactions yet" />}
              <ul className="divide-y divide-slate-100">
                {transactions.map((t) => (
                  <li key={t._id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                    <span className="flex items-center gap-2 min-w-0">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs ${TX_BADGE[t.type] || "bg-slate-100 text-slate-600"}`}>{t.type}</span>
                      <span className="text-slate-700 break-all">{txLabel(t)}</span>
                    </span>
                    <span className="font-medium tabular-nums text-slate-900">
                      {t.type === "DEBIT" ? "−" : t.type === "CREDIT" ? "+" : ""}
                      {formatCurrency(t.amount)}
                    </span>
                    <span className="text-slate-500 text-xs">Balance after {formatCurrency(t.balanceAfter)}</span>
                    <span className="text-slate-400 text-xs">{fmt(t.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-lg font-semibold text-slate-900 tabular-nums">{value}</p>
      <p className="text-xs text-slate-400">{sub}</p>
    </div>
  );
}
