import { useState } from "react";
import { Link } from "react-router-dom";
import { apiClient } from "../../api/client";
import { useApi } from "../../hooks/useApi";
import { actionErrorMessage } from "../../utils/format";
import PageHeader from "../../components/common/PageHeader";
import LoadingState from "../../components/common/LoadingState";
import ErrorState from "../../components/common/ErrorState";
import EmptyState from "../../components/common/EmptyState";
import { openSignedUrl } from "../../components/vendor/vendorUi";

// "Vendor review": vendor uploads awaiting a decision (GET
// /orders?queue=vendor-review). Approve releases the certificate to the
// client organization (same issue step as manual fulfilment); Reject sends
// it back to the vendor with a reason.
export default function VendorReviewPage() {
  const { data, loading, error, refetch } = useApi(
    (signal) => apiClient.get("/orders", { signal, params: { queue: "vendor-review", sortBy: "updatedAt", sortDir: "asc", limit: 100 } }).then((r) => r.data.data),
    [],
    { errorMessage: "Failed to load vendor uploads." }
  );
  const [selected, setSelected] = useState(() => new Set());
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const items = data?.items || [];

  async function act(fn, success, fallback) {
    setBusy(true);
    setActionError("");
    setMessage("");
    try {
      const res = await fn();
      setMessage(typeof success === "function" ? success(res) : success);
      setSelected(new Set());
      await refetch();
    } catch (err) {
      setActionError(actionErrorMessage(err, fallback));
    } finally {
      setBusy(false);
    }
  }
  function view(o) {
    setActionError("");
    openSignedUrl(`/orders/${o._id}/vendor-upload`).catch((err) => setActionError(actionErrorMessage(err, "Could not open the vendor's file.")));
  }
  function approve(o) {
    if (!window.confirm(`Approve the certificate for ${o.orderNumber}? It will be released to the client.`)) return;
    act(() => apiClient.post(`/orders/${o._id}/vendor-approve`), `${o.orderNumber} approved and released.`, "Could not approve.");
  }
  function approveSelected() {
    if (!window.confirm(`Approve ${selected.size} selected certificate${selected.size === 1 ? "" : "s"}? They will be released to the clients.`)) return;
    act(
      () => apiClient.post("/orders/vendor-approve-many", { orderIds: [...selected] }),
      (res) => {
        const d = res.data.data;
        const failed = d.results.filter((r) => !r.ok).map((r) => `${r.orderNumber || r.orderId} (${r.message || r.reason})`);
        return `${d.approved} approved${failed.length ? `; not approved: ${failed.join(", ")}` : ""}.`;
      },
      "Could not approve the selected orders."
    );
  }
  function submitReject(e) {
    e.preventDefault();
    if (reason.trim().length < 5) return setActionError("Give a reason of at least 5 characters.");
    const o = rejecting;
    act(() => apiClient.post(`/orders/${o._id}/vendor-reject`, { reason: reason.trim() }), `${o.orderNumber} sent back to the vendor.`, "Could not reject.").then(() => {
      setRejecting(null);
      setReason("");
    });
  }
  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Vendor review"
        subtitle="Certificates uploaded by vendors, waiting for your decision"
        actions={
          <button type="button" onClick={approveSelected} disabled={busy || selected.size === 0} className="rounded-lg bg-brand-600 hover:bg-brand-700 text-white px-3 py-2 text-sm font-medium disabled:opacity-50">
            Approve selected ({selected.size})
          </button>
        }
      />
      {message && <p className="text-sm text-green-700">{message}</p>}
      {actionError && <p role="alert" className="text-sm text-red-600">{actionError}</p>}
      {loading && <LoadingState text="Loading vendor uploads..." />}
      {!loading && error && <ErrorState message={error} onRetry={refetch} />}
      {!loading && !error && items.length === 0 && (
        <div className="bg-white rounded-xl border border-slate-200">
          <EmptyState title="Nothing to review" description="Vendor uploads appear here." />
        </div>
      )}
      {!loading && !error && items.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
          <table className="w-full text-sm min-w-[860px]">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 w-8">
                  <span className="sr-only">Select</span>
                </th>
                <th className="text-left px-4 py-3">Order</th>
                <th className="text-left px-4 py-3">Organization</th>
                <th className="text-left px-4 py-3">Vendor</th>
                <th className="text-left px-4 py-3">Stamp reference</th>
                <th className="text-left px-4 py-3">Uploaded</th>
                <th className="px-4 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((o) => (
                <tr key={o._id} className="border-t border-slate-100 align-top">
                  <td className="px-4 py-3">
                    <input type="checkbox" checked={selected.has(o._id)} onChange={() => toggle(o._id)} aria-label={`Select ${o.orderNumber}`} />
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    <Link to={`/orders/${o._id}`} className="hover:underline">
                      {o.orderNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{o.organizationName || "-"}</td>
                  <td className="px-4 py-3 text-slate-600">{o.vendorName || "-"}</td>
                  <td className="px-4 py-3 text-slate-800">{o.pendingVendorUpload?.stampReference || "-"}</td>
                  <td className="px-4 py-3 text-slate-500">{o.pendingVendorUpload?.uploadedAt ? new Date(o.pendingVendorUpload.uploadedAt).toLocaleString() : "-"}</td>
                  <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                    <button type="button" onClick={() => view(o)} className="rounded-lg border border-slate-300 px-2 py-1 text-xs" aria-label={`View file for ${o.orderNumber}`}>
                      View
                    </button>
                    <button type="button" disabled={busy} onClick={() => approve(o)} className="rounded-lg bg-green-600 hover:bg-green-700 text-white px-2 py-1 text-xs disabled:opacity-50" aria-label={`Approve ${o.orderNumber}`}>
                      Approve
                    </button>
                    <button type="button" disabled={busy} onClick={() => { setRejecting(o); setReason(""); }} className="rounded-lg border border-red-300 text-red-700 px-2 py-1 text-xs" aria-label={`Reject ${o.orderNumber}`}>
                      Reject
                    </button>
                    {rejecting?._id === o._id && (
                      <form onSubmit={submitReject} className="mt-2 flex gap-2 justify-end">
                        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for the vendor" aria-label={`Reject reason for ${o.orderNumber}`} maxLength={500} className="rounded-lg border border-slate-300 px-2 py-1 text-xs w-56" />
                        <button type="submit" disabled={busy} className="rounded-lg bg-red-600 text-white px-2 py-1 text-xs">
                          Send back
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
