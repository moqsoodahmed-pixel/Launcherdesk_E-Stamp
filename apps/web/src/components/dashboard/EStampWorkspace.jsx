import { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { apiClient } from "../../api/client";
import { formatCurrency, actionErrorMessage } from "../../utils/format";
import StatusBadge from "../estamps/StatusBadge";
import PaymentStatusBadge from "../payments/PaymentStatusBadge";
import EmptyState from "./EmptyState";
import { TableSkeleton } from "./LoadingSkeleton";
import BuyMoreModal from "./BuyMoreModal";
import InvoiceModal from "./InvoiceModal";
import ContactSupportModal from "./ContactSupportModal";

// EStampOrder.paymentStatus uses its own vocabulary (PENDING/PAID/FAILED),
// distinct from Payment.status (CREATED/SUCCESS/FAILED/REFUNDED) that
// PaymentStatusBadge renders - kept as a separate small badge rather than
// reusing PaymentStatusBadge with the wrong label set.
const ORDER_PAYMENT_STATUS_STYLES = {
  PAID: "bg-emerald-50 text-emerald-700",
  PENDING: "bg-amber-50 text-amber-700",
  FAILED: "bg-red-50 text-red-700",
};
function OrderPaymentStatusBadge({ status }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${ORDER_PAYMENT_STATUS_STYLES[status] || "bg-slate-100 text-slate-600"}`}>
      {status || "UNKNOWN"}
    </span>
  );
}

export default function EStampWorkspace({ user, onStateChanged }) {
  const [balance, setBalance] = useState(null);
  const [payments, setPayments] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Orders filters
  const [orderSearch, setOrderSearch] = useState("");
  const [orderStatus, setOrderStatus] = useState("");

  // Modals
  const [showBuyMore, setShowBuyMore] = useState(false);
  const [buyMoreIntent, setBuyMoreIntent] = useState("buy");
  const [selectedInvoicePayment, setSelectedInvoicePayment] = useState(null);
  const [showSupport, setShowSupport] = useState(false);
  const [packages, setPackages] = useState([]);

  const ordersRef = useRef(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [balRes, payRes, ordRes, pkgRes] = await Promise.allSettled([
        apiClient.get("/wallet/balance"),
        apiClient.get("/payments", { params: { limit: 20 } }),
        apiClient.get("/orders", { params: { limit: 20 } }),
        apiClient.get("/estamp-packages"),
      ]);

      if (balRes.status === "fulfilled") {
        setBalance(balRes.value.data.data);
      }
      if (payRes.status === "fulfilled") {
        setPayments(payRes.value.data.data?.items || []);
      }
      if (ordRes.status === "fulfilled") {
        setOrders(ordRes.value.data.data?.items || []);
      }
      if (pkgRes.status === "fulfilled") {
        setPackages(pkgRes.value.data.data || []);
      }
    } catch (err) {
      setError(actionErrorMessage(err, "Failed to load E-Stamp workspace data."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();

    const handleRefresh = () => {
      loadAll();
      if (onStateChanged) onStateChanged();
    };

    window.addEventListener("ld:payment_success", handleRefresh);
    window.addEventListener("ld:notifications_refresh", handleRefresh);
    return () => {
      window.removeEventListener("ld:payment_success", handleRefresh);
      window.removeEventListener("ld:notifications_refresh", handleRefresh);
    };
  }, [loadAll, onStateChanged]);

  // Derived subscription stats - there is no separate Subscription entity;
  // "current plan" is always derived from the latest successful Payment.
  const successfulPayments = payments.filter((p) => p.status === "SUCCESS");
  const latestSuccessful = successfulPayments[0] || null;
  const currentPlan = latestSuccessful?.plan || "No active package";

  // Calculate total stamps purchased - honest 0 when there have been no
  // successful purchases, rather than a hardcoded fallback value.
  const totalStampsPurchased = successfulPayments.reduce((acc, p) => {
    if (p.stampsCount && p.stampsCount > 0) return acc + p.stampsCount;
    const match = (p.plan || "").match(/(\d+)\s*E-Stamp/i);
    return acc + (match ? parseInt(match[1], 10) : 0);
  }, 0);

  // Expiry is derived from the matched catalog package's validityDays (set
  // only for packages that actually expire) + the purchase date. A custom
  // top-up or a package with no validityDays is treated as lifetime.
  const matchedPackage = latestSuccessful?.packageKey
    ? packages.find((pkg) => pkg.key === latestSuccessful.packageKey)
    : null;
  const expiryLabel = (() => {
    if (!latestSuccessful) return "No active package";
    if (!matchedPackage?.validityDays) return "Never Expires";
    const purchaseDate = new Date(latestSuccessful.createdAt);
    const expiry = new Date(purchaseDate.getTime() + matchedPackage.validityDays * 24 * 60 * 60 * 1000);
    return expiry.toLocaleDateString();
  })();

  // Used balance / completed orders
  const usedCount = orders.filter((o) => o.eStampStatus === "ISSUED" || o.status === "COMPLETED").length;
  const availableBal = balance?.availableBalance ?? balance?.balance ?? 0;

  // Filtered orders
  const filteredOrders = orders.filter((o) => {
    const matchesSearch =
      !orderSearch.trim() ||
      (o.orderNumber && o.orderNumber.toLowerCase().includes(orderSearch.trim().toLowerCase())) ||
      (o.partyName && o.partyName.toLowerCase().includes(orderSearch.trim().toLowerCase()));
    const matchesStatus = !orderStatus || o.eStampStatus === orderStatus || o.status === orderStatus;
    return matchesSearch && matchesStatus;
  });

  function handleViewOrdersScroll() {
    if (ordersRef.current) {
      ordersRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }

  function handleDownloadLatestInvoice() {
    if (latestSuccessful) {
      setSelectedInvoicePayment(latestSuccessful);
    } else {
      setBuyMoreIntent("buy");
      setShowBuyMore(true);
    }
  }

  function openBuyMore(intent) {
    setBuyMoreIntent(intent);
    setShowBuyMore(true);
  }

  return (
    <div className="space-y-6">
      {/* Workspace Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-gradient-to-r from-brand-900 via-brand-800 to-indigo-900 text-white rounded-2xl p-6 sm:p-8 shadow-sm">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-white/10 text-brand-200 text-xs font-medium">
            <span>✨</span> Dedicated E-Stamp Workspace
          </div>
          <h2 className="text-2xl font-bold tracking-tight">E-Stamp Package & Subscription Portal</h2>
          <p className="text-brand-200 text-sm max-w-xl">
            Manage your organization&apos;s active subscription, E-Stamp balance, order fulfilment, and billing receipts.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => openBuyMore("buy")}
            className="px-5 py-2.5 rounded-xl bg-white text-brand-900 font-semibold text-sm hover:bg-brand-50 shadow-md transition-all flex items-center gap-2"
          >
            <span>⚡</span> Buy More E-Stamps
          </button>
        </div>
      </div>

      {/* Quick Actions Panel */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <button
          onClick={() => openBuyMore("buy")}
          className="flex items-center gap-3 p-4 rounded-xl bg-white border border-slate-200 hover:border-brand-500 hover:shadow-sm transition text-left group"
        >
          <div className="w-10 h-10 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center text-lg group-hover:scale-105 transition-transform">
            💳
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-900 group-hover:text-brand-600">Buy More E-Stamps</div>
            <div className="text-xs text-slate-500">Add packages or funds</div>
          </div>
        </button>

        <button
          onClick={() => openBuyMore("upgrade")}
          className="flex items-center gap-3 p-4 rounded-xl bg-white border border-slate-200 hover:border-brand-500 hover:shadow-sm transition text-left group"
        >
          <div className="w-10 h-10 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center text-lg group-hover:scale-105 transition-transform">
            🚀
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-900 group-hover:text-brand-600">Upgrade Plan</div>
            <div className="text-xs text-slate-500">Move to a bigger bundle</div>
          </div>
        </button>

        <button
          onClick={() => openBuyMore("renew")}
          className="flex items-center gap-3 p-4 rounded-xl bg-white border border-slate-200 hover:border-brand-500 hover:shadow-sm transition text-left group"
        >
          <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center text-lg group-hover:scale-105 transition-transform">
            🔄
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-900 group-hover:text-brand-600">Renew Plan</div>
            <div className="text-xs text-slate-500">Top up your current bundle</div>
          </div>
        </button>

        <button
          onClick={handleViewOrdersScroll}
          className="flex items-center gap-3 p-4 rounded-xl bg-white border border-slate-200 hover:border-brand-500 hover:shadow-sm transition text-left group"
        >
          <div className="w-10 h-10 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center text-lg group-hover:scale-105 transition-transform">
            📑
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-900 group-hover:text-brand-600">View Orders</div>
            <div className="text-xs text-slate-500">Track and filter orders</div>
          </div>
        </button>

        <button
          onClick={handleDownloadLatestInvoice}
          className="flex items-center gap-3 p-4 rounded-xl bg-white border border-slate-200 hover:border-brand-500 hover:shadow-sm transition text-left group"
        >
          <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center text-lg group-hover:scale-105 transition-transform">
            📄
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-900 group-hover:text-brand-600">Download Invoice</div>
            <div className="text-xs text-slate-500">Official tax receipts</div>
          </div>
        </button>

        <button
          onClick={() => setShowSupport(true)}
          className="flex items-center gap-3 p-4 rounded-xl bg-white border border-slate-200 hover:border-brand-500 hover:shadow-sm transition text-left group"
        >
          <div className="w-10 h-10 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center text-lg group-hover:scale-105 transition-transform">
            💬
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-900 group-hover:text-brand-600">Contact Support</div>
            <div className="text-xs text-slate-500">2-hour priority SLA</div>
          </div>
        </button>
      </div>

      {/* Current Subscription Section */}
      <section className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div>
            <h3 className="font-semibold text-slate-900 text-base">Current Subscription & Allocation</h3>
            <p className="text-xs text-slate-500">Active package plan and real-time ledger balance</p>
          </div>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            Active
          </span>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 pt-1">
          <div className="p-4 rounded-xl bg-slate-50/70 border border-slate-100">
            <dt className="text-xs text-slate-500 font-medium">Current Plan</dt>
            <dd className="text-base font-bold text-slate-900 mt-1 line-clamp-1">{currentPlan}</dd>
            <dd className="text-[11px] text-slate-400 mt-0.5">Corporate Subscription</dd>
          </div>

          <div className="p-4 rounded-xl bg-slate-50/70 border border-slate-100">
            <dt className="text-xs text-slate-500 font-medium">E-Stamps Purchased</dt>
            <dd className="text-2xl font-bold text-brand-600 mt-1 tabular-nums">{totalStampsPurchased}</dd>
            <dd className="text-[11px] text-slate-400 mt-0.5">Total capacity credited</dd>
          </div>

          <div className="p-4 rounded-xl bg-slate-50/70 border border-slate-100">
            <dt className="text-xs text-slate-500 font-medium">Available Balance</dt>
            <dd className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">{formatCurrency(availableBal)}</dd>
            <dd className="text-[11px] text-slate-400 mt-0.5">Wallet ready for new requests</dd>
          </div>

          <div className="p-4 rounded-xl bg-slate-50/70 border border-slate-100">
            <dt className="text-xs text-slate-500 font-medium">Used Balance / Issued</dt>
            <dd className="text-2xl font-bold text-slate-700 mt-1 tabular-nums">{usedCount} Orders</dd>
            <dd className="text-[11px] text-slate-400 mt-0.5">Successfully fulfilled</dd>
          </div>

          <div className="p-4 rounded-xl bg-slate-50/70 border border-slate-100 col-span-2 lg:col-span-1">
            <dt className="text-xs text-slate-500 font-medium">Expiry Date</dt>
            <dd className="text-base font-semibold text-slate-900 mt-1">{expiryLabel}</dd>
            <dd className="text-[11px] text-emerald-600 mt-0.5">
              {matchedPackage?.validityDays ? `${matchedPackage.validityDays}-day bundle validity` : "Lifetime bundle validity"}
            </dd>
          </div>
        </div>
      </section>

      {/* Orders Section */}
      <section ref={ordersRef} className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <h3 className="font-semibold text-slate-900 text-base">E-Stamp Orders</h3>
            <p className="text-xs text-slate-500">Search and filter active and fulfilled certificate orders</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              placeholder="Search by order #..."
              value={orderSearch}
              onChange={(e) => setOrderSearch(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500 w-44"
            />
            <select
              value={orderStatus}
              onChange={(e) => setOrderStatus(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">All Statuses</option>
              <option value="ISSUED">Issued</option>
              <option value="PROCESSING">Processing</option>
              <option value="FAILED">Failed</option>
              <option value="CREATED">Created</option>
            </select>
            <Link
              to="/orders"
              className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-600 hover:bg-slate-50 font-medium"
            >
              All Orders →
            </Link>
          </div>
        </div>

        {loading ? (
          <TableSkeleton rows={4} columns={5} />
        ) : filteredOrders.length === 0 ? (
          <EmptyState
            title="No orders found"
            description={orderSearch || orderStatus ? "No orders match the selected filters." : "Your organization hasn't placed any orders yet."}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                <tr>
                  <th className="p-3">Order Number</th>
                  <th className="p-3">Date</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Amount</th>
                  <th className="p-3">Payment Status</th>
                  <th className="p-3">Invoice</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredOrders.map((ord) => {
                  const linkedPayment = payments.find(
                    (p) => p.plan && ord.orderNumber && p.createdAt && Math.abs(new Date(p.createdAt) - new Date(ord.createdAt)) < 5 * 60 * 1000 && p.status === "SUCCESS"
                  );
                  return (
                    <tr key={ord._id} className="hover:bg-slate-50/70 transition">
                      <td className="p-3 font-mono font-medium text-brand-600">
                        <Link to={`/orders/${ord._id}`} className="hover:underline">
                          {ord.orderNumber || ord._id.slice(-8)}
                        </Link>
                      </td>
                      <td className="p-3 text-slate-600">
                        {ord.createdAt ? new Date(ord.createdAt).toLocaleDateString() : "-"}
                      </td>
                      <td className="p-3">
                        <StatusBadge status={ord.eStampStatus || ord.status} />
                      </td>
                      <td className="p-3 font-medium text-slate-900">{formatCurrency(ord.amount)}</td>
                      <td className="p-3">
                        <OrderPaymentStatusBadge status={ord.paymentStatus} />
                      </td>
                      <td className="p-3">
                        {linkedPayment ? (
                          <button
                            onClick={() => setSelectedInvoicePayment(linkedPayment)}
                            className="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-[11px] transition"
                          >
                            📄 View
                          </button>
                        ) : (
                          <span className="text-slate-300 text-[11px]">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Purchase History Section */}
      <section className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <h3 className="font-semibold text-slate-900 text-base">Purchase History & Receipts</h3>
            <p className="text-xs text-slate-500">All previous E-Stamp packages and wallet subscription purchases</p>
          </div>
          <Link
            to="/payments"
            className="text-xs text-brand-600 hover:underline font-medium"
          >
            View all payments →
          </Link>
        </div>

        {loading ? (
          <TableSkeleton rows={4} columns={6} />
        ) : payments.length === 0 ? (
          <EmptyState
            title="No purchases yet"
            description="When you buy E-Stamp bundles or top-up balance, receipts and invoices will appear here."
            action={
              <button
                onClick={() => setShowBuyMore(true)}
                className="mt-3 px-4 py-2 rounded-lg bg-brand-600 text-white text-xs font-semibold hover:bg-brand-700"
              >
                Buy Your First Bundle
              </button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                <tr>
                  <th className="p-3">Invoice</th>
                  <th className="p-3">Transaction ID</th>
                  <th className="p-3">Plan / Bundle</th>
                  <th className="p-3">Amount</th>
                  <th className="p-3">Purchase Date</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {payments.map((p) => {
                  const invNum =
                    p.invoiceNumber ||
                    `INV-${new Date(p.createdAt || Date.now()).getFullYear()}-${(p._id || "").toString().slice(-6).toUpperCase()}`;
                  const txId = p.razorpayPaymentId || p.razorpayOrderId || "-";
                  return (
                    <tr key={p._id} className="hover:bg-slate-50/70 transition">
                      <td className="p-3 font-mono font-medium text-brand-600">
                        {p.status === "SUCCESS" ? invNum : "-"}
                      </td>
                      <td className="p-3 font-mono text-slate-600 text-[11px]">{txId}</td>
                      <td className="p-3 font-medium text-slate-800">{p.plan || "Wallet Balance"}</td>
                      <td className="p-3 font-semibold text-slate-900">{formatCurrency(p.amount)}</td>
                      <td className="p-3 text-slate-600">
                        {p.createdAt ? new Date(p.createdAt).toLocaleDateString() : "-"}
                      </td>
                      <td className="p-3">
                        <PaymentStatusBadge status={p.status} />
                      </td>
                      <td className="p-3 text-right">
                        {p.status === "SUCCESS" ? (
                          <button
                            onClick={() => setSelectedInvoicePayment(p)}
                            className="px-2.5 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-[11px] transition inline-flex items-center gap-1"
                          >
                            <span>📄</span> View Invoice
                          </button>
                        ) : (
                          <span className="text-slate-300 text-[11px]">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Modals */}
      {showBuyMore && (
        <BuyMoreModal
          intent={buyMoreIntent}
          currentPackageKey={latestSuccessful?.packageKey || null}
          onClose={() => setShowBuyMore(false)}
          onSuccess={() => {
            loadAll();
            if (onStateChanged) onStateChanged();
          }}
        />
      )}

      {selectedInvoicePayment && (
        <InvoiceModal
          payment={selectedInvoicePayment}
          organizationName={user?.organizationName}
          userName={user?.name}
          userEmail={user?.email}
          onClose={() => setSelectedInvoicePayment(null)}
        />
      )}

      {showSupport && <ContactSupportModal onClose={() => setShowSupport(false)} />}
    </div>
  );
}
