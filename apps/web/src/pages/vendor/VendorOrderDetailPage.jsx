import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiClient } from "../../api/client";
import { useApi } from "../../hooks/useApi";
import { actionErrorMessage, formatCurrency } from "../../utils/format";
import PageHeader from "../../components/common/PageHeader";
import LoadingState from "../../components/common/LoadingState";
import ErrorState from "../../components/common/ErrorState";
import { CopyButton, openSignedUrl, UploadCertificateForm, UPLOADABLE, VendorStatusBadge } from "../../components/vendor/vendorUi";

const UPLOAD_STATUS_LABELS = { PENDING: "Awaiting review", SUPERSEDED: "Replaced", REJECTED: "Rejected", APPROVED: "Approved" };

function Field({ label, value, copy = true }) {
  const text = value == null || value === "" ? "" : String(value);
  return (
    <div className="py-2 border-b border-slate-100 last:border-0">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-sm text-slate-900 break-words">
        {text || "-"}
        {copy && <CopyButton value={text} label={label} />}
      </dd>
    </div>
  );
}

// One order sent to this vendor (GET /vendor/orders/:id - a restricted
// projection: no money beyond the duty, no contact details).
export default function VendorOrderDetailPage() {
  const { id } = useParams();
  const { data: order, loading, error, refetch } = useApi((signal) => apiClient.get(`/vendor/orders/${id}`, { signal }).then((r) => r.data.data), [id], {
    errorMessage: "Failed to load this order.",
  });
  const [actionError, setActionError] = useState("");
  const [reason, setReason] = useState("");
  const [showDecline, setShowDecline] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run(fn, fallback) {
    setActionError("");
    setBusy(true);
    try {
      await fn();
      await refetch();
      return true;
    } catch (err) {
      setActionError(actionErrorMessage(err, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  }
  const accept = () => run(() => apiClient.post(`/vendor/orders/${id}/accept`), "Could not accept this order.");
  async function decline(e) {
    e.preventDefault();
    if (reason.trim().length < 5) return setActionError("Please give a reason of at least 5 characters.");
    if (!window.confirm("Hand this order back to LauncherDesk? You will not be able to upload for it afterwards.")) return;
    if (await run(() => apiClient.post(`/vendor/orders/${id}/cannot-process`, { reason: reason.trim() }), "Could not hand this order back.")) {
      setShowDecline(false);
      setReason("");
    }
  }
  const openFile = (fileId) => run(() => openSignedUrl(`/vendor/orders/${id}/files/${fileId}`), "Could not open the file.");

  if (loading) return <LoadingState text="Loading order..." />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;
  if (!order) return null;
  const canUpload = UPLOADABLE.includes(order.vendorStatus) && !order.declined && !order.closed;
  const canDecline = ["SENT", "ACCEPTED", "REJECTED"].includes(order.vendorStatus) && !order.declined && !order.closed;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Order ${order.orderNumber}`}
        subtitle={order.organizationName}
        actions={
          <Link to="/vendor/orders" className="text-sm rounded-lg border border-slate-300 px-3 py-2 text-slate-600 hover:bg-slate-50">
            Back to my orders
          </Link>
        }
      />
      <div className="flex flex-wrap items-center gap-3">
        <VendorStatusBadge status={order.vendorStatus} label={order.declined ? "Handed back" : undefined} />
        {order.vendorStatus === "SENT" && !order.declined && (
          <button type="button" disabled={busy} onClick={accept} className="rounded-lg bg-brand-600 hover:bg-brand-700 text-white px-3 py-1.5 text-sm font-medium disabled:opacity-50">
            Accept
          </button>
        )}
        {order.declined && <p className="text-sm text-slate-600">You handed this order back: {order.declineReason}</p>}
      </div>
      {actionError && <p role="alert" className="text-sm text-red-600">{actionError}</p>}

      <section className="bg-white rounded-xl border border-slate-200 p-5">
        <h2 className="font-medium text-slate-900 mb-2">Details</h2>
        <dl className="grid sm:grid-cols-2 gap-x-8">
          <Field label="Order number" value={order.orderNumber} />
          <Field label="Batch" value={order.bulkBatchNumber} />
          <Field label="State" value={order.stateCode} />
          <Field label="Article" value={order.articleTitle} />
          <Field label="First party" value={order.firstParty} />
          <Field label="Second party" value={order.secondParty} />
          <Field label="Description of document" value={order.descriptionOfDocument} />
          <Field label="Property description" value={order.propertyDescription} />
          <Field label="Consideration price" value={order.considerationPrice == null ? "" : formatCurrency(order.considerationPrice)} />
          <Field label="Stamp duty" value={order.stampDuty == null ? "" : formatCurrency(order.stampDuty)} />
          <Field label="Paid by" value={order.stampDutyPaidBy} />
          <Field label="Number of E-Stamps" value={order.numberOfEStamps} />
          <Field label="Organization" value={order.organizationName} copy={false} />
        </dl>
      </section>

      <section className="bg-white rounded-xl border border-slate-200 p-5">
        <h2 className="font-medium text-slate-900 mb-2">Client documents</h2>
        {order.documents?.length ? (
          <ul className="divide-y divide-slate-100">
            {order.documents.map((d) => (
              <li key={d._id} className="flex items-center justify-between py-2 text-sm">
                <span className="text-slate-700">{d.originalFileName}</span>
                <button type="button" onClick={() => openFile(d._id)} className="text-xs text-brand-600 hover:underline" aria-label={`Download ${d.originalFileName}`}>
                  Download
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">No documents were attached by the client.</p>
        )}
      </section>

      {canUpload && (
        <section className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="font-medium text-slate-900 mb-2">{order.vendorStatus === "UPLOADED" ? "Replace upload" : "Upload certificate"}</h2>
          <UploadCertificateForm order={order} onUploaded={refetch} />
        </section>
      )}

      <section className="bg-white rounded-xl border border-slate-200 p-5">
        <h2 className="font-medium text-slate-900 mb-2">Upload history</h2>
        {order.uploads?.length ? (
          <ul className="divide-y divide-slate-100">
            {[...order.uploads].reverse().map((u) => (
              <li key={u._id} className="py-2 text-sm">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-medium text-slate-800">{u.stampReference}</span>
                  <span className="text-xs text-slate-500">{new Date(u.uploadedAt).toLocaleString()}</span>
                  <span className="text-xs rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">{UPLOAD_STATUS_LABELS[u.status] || u.status}</span>
                </div>
                {u.reviewNotes && <p className="text-xs text-red-700 mt-1">Reason: {u.reviewNotes}</p>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">Nothing uploaded yet.</p>
        )}
      </section>

      {canDecline && (
        <section className="bg-white rounded-xl border border-slate-200 p-5">
          {!showDecline ? (
            <button type="button" onClick={() => setShowDecline(true)} className="text-sm text-red-700 hover:underline">
              Can&apos;t process this order
            </button>
          ) : (
            <form onSubmit={decline} className="space-y-2">
              <label htmlFor="decline-reason" className="text-sm font-medium text-slate-800">
                Why can&apos;t you process it?
              </label>
              <textarea id="decline-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={3} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              <div className="flex gap-2">
                <button type="submit" disabled={busy} className="rounded-lg bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 text-sm disabled:opacity-50">
                  Hand back to LauncherDesk
                </button>
                <button type="button" onClick={() => setShowDecline(false)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm">
                  Cancel
                </button>
              </div>
            </form>
          )}
        </section>
      )}
    </div>
  );
}
