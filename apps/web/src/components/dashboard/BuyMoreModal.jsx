import { useState, useRef, useEffect } from "react";
import { apiClient } from "../../api/client";
import { formatCurrency, actionErrorMessage } from "../../utils/format";
import { loadRazorpayScript } from "../../pages/wallet/WalletPage";

const CUSTOM_PACKAGE = {
  id: "custom",
  key: "custom",
  name: "Custom Top-up",
  stampsCount: 0,
  price: 0,
  description: "Enter a custom balance amount to add to your organization wallet.",
};

const INTENT_COPY = {
  buy: { title: "Buy E-Stamps & Add Balance", subtitle: "Select an E-Stamp bundle or top-up balance for your organization" },
  upgrade: { title: "Upgrade Your E-Stamp Plan", subtitle: "Move to a bigger bundle for more E-Stamps and better value" },
  renew: { title: "Renew Your E-Stamp Plan", subtitle: "Renew your current bundle to keep your balance topped up" },
};

function formatValidity(validityDays) {
  if (!validityDays) return "Lifetime validity";
  return `Valid for ${validityDays} days`;
}

// `intent` ("buy" | "upgrade" | "renew") only changes the modal's copy and
// default selection - functionally every intent still creates a Payment and
// credits stamps the same way, since there's no separate subscription entity
// to upgrade/renew against (see EStampWorkspace.jsx's "Current Subscription",
// which is derived from the latest successful Payment).
export default function BuyMoreModal({ onClose, onSuccess, intent = "buy", currentPackageKey = null }) {
  const [packages, setPackages] = useState([]);
  const [loadingPackages, setLoadingPackages] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [customAmount, setCustomAmount] = useState("1000");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [successResult, setSuccessResult] = useState(null);
  const purchasingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await apiClient.get("/estamp-packages");
        const items = data.data || [];
        if (cancelled) return;
        setPackages(items);
        // Upgrade defaults to the next bundle above the current one (by
        // price); renew defaults to the current package itself; buy defaults
        // to the recommended bundle.
        let defaultPkg = items.find((p) => p.recommended) || items[0];
        if (intent === "renew" && currentPackageKey) {
          defaultPkg = items.find((p) => p.key === currentPackageKey) || defaultPkg;
        } else if (intent === "upgrade" && currentPackageKey) {
          const current = items.find((p) => p.key === currentPackageKey);
          const above = items
            .filter((p) => !current || p.price > current.price)
            .sort((a, b) => a.price - b.price)[0];
          defaultPkg = above || defaultPkg;
        }
        setSelectedId(defaultPkg?.key || "custom");
      } catch (err) {
        if (!cancelled) setLoadError(actionErrorMessage(err, "Failed to load E-Stamp packages."));
      } finally {
        if (!cancelled) setLoadingPackages(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allOptions = [...packages, CUSTOM_PACKAGE];
  const selectedPkg = allOptions.find((p) => p.key === selectedId) || CUSTOM_PACKAGE;
  const isCustom = selectedPkg.key === "custom";
  const finalAmount = isCustom ? Number(customAmount) : selectedPkg.price;
  const finalPlanName = isCustom
    ? `Custom Wallet Top-up (₹${finalAmount})`
    : `${selectedPkg.name} (${selectedPkg.stampsCount} E-Stamps)`;
  const finalStamps = isCustom ? Math.floor(finalAmount / 15) : selectedPkg.stampsCount;
  const copy = INTENT_COPY[intent] || INTENT_COPY.buy;

  async function handleCheckout(e) {
    e.preventDefault();
    if (purchasingRef.current) return;
    setError(null);

    if (!Number.isFinite(finalAmount) || finalAmount < 100) {
      setError("Please specify an amount of at least ₹100.");
      return;
    }

    purchasingRef.current = true;
    setBusy(true);

    try {
      // 1. Create order on backend. A catalog package sends only its key -
      // the server resolves price/stampsCount itself (see
      // payment.controller.js createRazorpayOrder) so a tampered client can
      // never alter the amount charged or the stamps granted.
      const orderBody = isCustom
        ? { amount: finalAmount }
        : { packageKey: selectedPkg.key };
      const { data } = await apiClient.post("/payments/razorpay/order", orderBody);

      const order = data.data;

      // 2. If Razorpay key is present, open real Razorpay checkout
      if (order.keyId) {
        await loadRazorpayScript();
        const razorpay = new window.Razorpay({
          key: order.keyId,
          amount: Math.round(order.amount * 100),
          currency: "INR",
          order_id: order.razorpayOrderId,
          name: "LauncherDesk E-Stamping",
          description: finalPlanName,
          handler: async (response) => {
            try {
              const verifyRes = await apiClient.post("/payments/razorpay/verify", {
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
              });

              completeSuccess(verifyRes.data?.data || order);
            } catch (vErr) {
              setError(actionErrorMessage(vErr, "Payment verification failed."));
            } finally {
              purchasingRef.current = false;
              setBusy(false);
            }
          },
          modal: {
            ondismiss: () => {
              purchasingRef.current = false;
              setBusy(false);
            },
          },
        });

        razorpay.on("payment.failed", () => {
          setError("Payment failed or was cancelled.");
          purchasingRef.current = false;
          setBusy(false);
        });

        razorpay.open();
      } else {
        // Dev / test mode fallback with MockPaymentProvider
        const devPaymentId = `pay_mock_${Date.now()}`;
        const verifyRes = await apiClient.post("/payments/razorpay/verify", {
          razorpay_order_id: order.razorpayOrderId,
          razorpay_payment_id: devPaymentId,
          razorpay_signature: "mock_signature_dev_only",
        });

        completeSuccess(verifyRes.data?.data || { ...order, razorpayPaymentId: devPaymentId });
      }
    } catch (err) {
      setError(actionErrorMessage(err, "Failed to initiate purchase."));
      purchasingRef.current = false;
      setBusy(false);
    }
  }

  function completeSuccess(paymentData) {
    // Notify all app listeners to sync state
    window.dispatchEvent(new CustomEvent("ld:notifications_refresh"));
    window.dispatchEvent(new CustomEvent("ld:payment_success", { detail: paymentData }));

    setSuccessResult(paymentData);
    if (onSuccess) onSuccess(paymentData);
  }

  if (successResult) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
        <div className="bg-white rounded-2xl max-w-md w-full p-6 text-center space-y-5 shadow-2xl border border-slate-200">
          <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto text-2xl font-bold">
            ✓
          </div>
          <div>
            <h3 className="text-xl font-bold text-slate-900">Purchase Successful!</h3>
            <p className="text-xs text-slate-500 mt-1">
              Your E-Stamp package has been processed and credited.
            </p>
          </div>

          <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 text-xs text-left space-y-2">
            <div className="flex justify-between">
              <span className="text-slate-500">Plan Purchased:</span>
              <span className="font-semibold text-slate-800">{finalPlanName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">E-Stamps Added:</span>
              <span className="font-semibold text-emerald-600">+{finalStamps} E-Stamps</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Amount Paid:</span>
              <span className="font-semibold text-slate-900">{formatCurrency(finalAmount)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Transaction ID:</span>
              <span className="font-mono text-slate-600">
                {successResult.razorpayPaymentId || successResult.razorpayOrderId || "Confirmed"}
              </span>
            </div>
          </div>

          <p className="text-xs text-slate-400">
            A confirmation receipt and invoice have been sent to your registered email address.
          </p>

          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium text-sm transition"
          >
            Back to E-Stamp Workspace
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-xl w-full p-6 sm:p-7 space-y-6 shadow-2xl border border-slate-200 my-8">
        <div className="flex justify-between items-start border-b border-slate-100 pb-4">
          <div>
            <h3 className="text-lg font-bold text-slate-900">{copy.title}</h3>
            <p className="text-xs text-slate-500">{copy.subtitle}</p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-lg leading-none p-1"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {(error || loadError) && (
          <div className="rounded-lg bg-red-50 text-red-700 text-xs px-3.5 py-2.5 border border-red-200">
            {error || loadError}
          </div>
        )}

        <div className="space-y-3">
          <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider">
            Choose Package
          </label>

          {loadingPackages ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 animate-pulse">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-36 rounded-xl bg-slate-100" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {packages.map((pkg) => {
                const isSelected = selectedId === pkg.key;
                return (
                  <div
                    key={pkg.key}
                    onClick={() => setSelectedId(pkg.key)}
                    className={`relative cursor-pointer rounded-xl p-4 border transition-all text-left flex flex-col justify-between ${
                      isSelected
                        ? "border-brand-600 bg-brand-50/40 ring-2 ring-brand-500 shadow-sm"
                        : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/50"
                    }`}
                  >
                    {pkg.recommended && (
                      <span className="absolute -top-2.5 right-3 bg-brand-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                        Popular
                      </span>
                    )}
                    <div>
                      <h4 className="font-semibold text-sm text-slate-900">{pkg.name}</h4>
                      <p className="text-xs text-brand-600 font-medium mt-0.5">
                        {pkg.stampsCount} E-Stamps
                      </p>
                      <p className="text-[11px] text-slate-500 mt-2 line-clamp-2">
                        {pkg.description}
                      </p>
                      {pkg.features?.length > 0 && (
                        <ul className="mt-2 space-y-0.5">
                          {pkg.features.slice(0, 3).map((f) => (
                            <li key={f} className="text-[10px] text-slate-500 flex items-start gap-1">
                              <span className="text-emerald-600">✓</span> {f}
                            </li>
                          ))}
                        </ul>
                      )}
                      <p className="text-[10px] text-slate-400 mt-1.5">{formatValidity(pkg.validityDays)}</p>
                    </div>
                    <div className="mt-4 pt-2 border-t border-slate-100 flex items-baseline justify-between">
                      <span className="text-lg font-bold text-slate-900">
                        {formatCurrency(pkg.price)}
                      </span>
                      {pkg.stampsCount > 0 && (
                        <span className="text-[10px] text-slate-400">
                          ~₹{(pkg.price / pkg.stampsCount).toFixed(0)}/stamp
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div
            onClick={() => setSelectedId("custom")}
            className={`mt-2 cursor-pointer rounded-xl p-3.5 border transition ${
              selectedId === "custom"
                ? "border-brand-600 bg-brand-50/40 ring-2 ring-brand-500"
                : "border-slate-200 hover:border-slate-300"
            }`}
          >
            <div className="flex items-center justify-between">
              <div>
                <span className="font-semibold text-sm text-slate-900">Custom Amount Top-Up</span>
                <p className="text-xs text-slate-500">Fund wallet balance with any custom amount</p>
              </div>
              <input
                type="radio"
                name="pkg"
                checked={selectedId === "custom"}
                onChange={() => setSelectedId("custom")}
                className="h-4 w-4 text-brand-600 focus:ring-brand-500"
              />
            </div>
            {selectedId === "custom" && (
              <div className="mt-3 pt-3 border-t border-slate-200/60 flex items-center gap-3">
                <div className="relative flex-1">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-500 text-sm">
                    ₹
                  </span>
                  <input
                    type="number"
                    min="100"
                    step="100"
                    value={customAmount}
                    onChange={(e) => setCustomAmount(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                    placeholder="Enter amount"
                  />
                </div>
                <span className="text-xs text-slate-500 whitespace-nowrap">
                  ≈ {Math.floor(Number(customAmount) / 15)} E-Stamps equivalent
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-2 text-xs">
          <div className="flex justify-between text-slate-600">
            <span>Selected Plan:</span>
            <span className="font-medium text-slate-900">{finalPlanName}</span>
          </div>
          <div className="flex justify-between text-slate-600">
            <span>E-Stamp Capacity:</span>
            <span className="font-medium text-slate-900">+{finalStamps} E-Stamps</span>
          </div>
          <div className="flex justify-between text-slate-900 font-semibold text-sm pt-2 border-t border-slate-200">
            <span>Total Payable:</span>
            <span className="text-brand-600 text-base">{formatCurrency(finalAmount)}</span>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCheckout}
            disabled={busy || loadingPackages}
            className="px-5 py-2.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold shadow-sm transition disabled:opacity-50"
          >
            {busy ? "Processing Secure Payment..." : `Pay ${formatCurrency(finalAmount)}`}
          </button>
        </div>
      </div>
    </div>
  );
}
