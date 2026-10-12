import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiClient } from "../../api/client";
import { useApi } from "../../hooks/useApi";
import { actionErrorMessage } from "../../utils/format";
import PageHeader from "../../components/common/PageHeader";
import LoadingState from "../../components/common/LoadingState";
import ErrorState from "../../components/common/ErrorState";
import EmptyState from "../../components/common/EmptyState";
import { formatAge } from "./FulfilQueuePage";

const REASON_LABELS = {
  NOT_FOUND: "Order not found",
  NOT_LOCKED: "Request is not locked yet",
  NOT_CHARGED: "Amount not charged",
  ALREADY_ISSUED: "Already issued",
  ALREADY_FAILED: "Marked failed",
  ALREADY_WITH_VENDOR: "Already with a vendor",
  INVALID_STATE: "Not open for fulfilment",
  CHANGED_CONCURRENTLY: "Changed meanwhile, reload",
};

// "Send to vendor": the orders-to-fulfil queue limited to orders not with a
// vendor (never sent, or handed back / rejected), with checkboxes, a vendor
// picker and per-order results.
export default function DispatchPage() {
  const [selected, setSelected] = useState(() => new Set());
  const [vendorId, setVendorId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const queue = useApi(
    (signal) =>
      Promise.all([
        apiClient.get("/orders", { signal, params: { queue: "fulfil", vendorStatus: "NOT_SENT", sortBy: "createdAt", sortDir: "asc", limit: 100 } }),
        apiClient.get("/orders", { signal, params: { queue: "fulfil", vendorStatus: "REJECTED", sortBy: "createdAt", sortDir: "asc", limit: 100 } }),
      ]).then(([a, b]) => [...a.data.data.items, ...b.data.data.items]),
    [],
    { errorMessage: "Failed to load orders waiting for dispatch." }
  );
  const vendors = useApi((signal) => apiClient.get("/orders/vendors", { signal }).then((r) => r.data.data.items), [], {
    errorMessage: "Failed to load vendors.",
  });
  const items = queue.data || [];
  const groups = useMemo(() => {
    const map = new Map();
    for (const o of items) {
      const key = o.organizationName || "-";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(o);
    }
    return [...map.entries()];
  }, [items]);

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function selectGroup(groupItems, on) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const o of groupItems) on ? next.add(o._id) : next.delete(o._id);
      return next;
    });
  }
  async function send() {
    setError("");
    if (!vendorId) return setError("Choose a vendor.");
    if (selected.size === 0) return setError("Select at least one order.");
    if (selected.size > 200) return setError("Send at most 200 orders at a time.");
    const vendor = (vendors.data || []).find((v) => v._id === vendorId);
    if (!window.confirm(`Send ${selected.size} order${selected.size === 1 ? "" : "s"} to ${vendor?.name || "this vendor"}?`)) return;
    setBusy(true);
    try {
      const res = await apiClient.post("/orders/dispatch", { orderIds: [...selected], vendorId });
      setResult(res.data.data);
      setSelected(new Set());
      queue.refetch();
    } catch (err) {
      setError(actionErrorMessage(err, "Could not send the orders."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Send to vendor" subtitle="Locked and charged orders not yet with a vendor, oldest first" />
      <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap items-center gap-3">
        <label htmlFor="vendor" className="text-sm text-slate-700">
          Vendor
        </label>
        <select id="vendor" value={vendorId} onChange={(e) => setVendorId(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm min-w-[12rem]">
          <option value="">Choose a vendor</option>
          {(vendors.data || []).map((v) => (
            <option key={v._id} value={v._id}>
              {v.name}
            </option>
          ))}
        </select>
        {vendors.error && <span className="text-xs text-red-600">{vendors.error}</span>}
        <span className="text-sm text-slate-500">{selected.size} selected</span>
        <div className="flex-1" />
        <button type="button" onClick={send} disabled={busy} className="rounded-lg bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 text-sm font-medium disabled:opacity-50">
          {busy ? "Sending..." : "Send"}
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {result && (
        <section className="bg-white rounded-xl border border-slate-200 p-4" aria-label="Dispatch result">
          <p className="text-sm font-medium text-slate-900">
            {result.sent} sent, {result.failed} not sent
          </p>
          {result.failed > 0 && (
            <ul className="mt-2 text-sm text-red-700 list-disc pl-5">
              {result.results
                .filter((r) => !r.ok)
                .map((r) => (
                  <li key={r.orderId}>
                    {r.orderNumber || r.orderId}: {REASON_LABELS[r.reason] || r.reason}
                  </li>
                ))}
            </ul>
          )}
        </section>
      )}
      {queue.loading && <LoadingState text="Loading orders..." />}
      {!queue.loading && queue.error && <ErrorState message={queue.error} onRetry={queue.refetch} />}
      {!queue.loading && !queue.error && items.length === 0 && (
        <div className="bg-white rounded-xl border border-slate-200">
          <EmptyState title="Nothing waiting for dispatch" description="Charged orders appear here once their window ends." />
        </div>
      )}
      {!queue.loading &&
        !queue.error &&
        groups.map(([org, groupItems]) => {
          const allOn = groupItems.every((o) => selected.has(o._id));
          return (
            <section key={org} className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
              <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100">
                <h2 className="text-sm font-medium text-slate-800">{org}</h2>
                <button type="button" onClick={() => selectGroup(groupItems, !allOn)} className="text-xs text-brand-600 hover:underline">
                  {allOn ? "Clear" : "Select all"} ({groupItems.length})
                </button>
              </div>
              <table className="w-full text-sm min-w-[640px]">
                <tbody>
                  {groupItems.map((o) => (
                    <tr key={o._id} className="border-t border-slate-100 first:border-t-0">
                      <td className="px-4 py-2 w-8">
                        <input type="checkbox" checked={selected.has(o._id)} onChange={() => toggle(o._id)} aria-label={`Select ${o.orderNumber}`} />
                      </td>
                      <td className="px-4 py-2 font-medium text-slate-900">
                        <Link to={`/orders/${o._id}`} className="hover:underline">
                          {o.orderNumber}
                        </Link>
                      </td>
                      <td className="px-4 py-2 text-slate-600">{o.stateCode}</td>
                      <td className="px-4 py-2 text-slate-600">{o.articleTitle || "-"}</td>
                      <td className="px-4 py-2 text-slate-500 tabular-nums">{formatAge(o.lockedAt || o.createdAt)}</td>
                      <td className="px-4 py-2 text-xs text-red-700">{o.vendorStatus === "REJECTED" ? "Handed back / rejected" : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          );
        })}
    </div>
  );
}
