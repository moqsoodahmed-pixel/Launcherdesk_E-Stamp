import { useEffect, useRef, useState, useCallback } from "react";
import { Link, useParams } from "react-router-dom";
import { apiClient } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { hasPermission, PERMISSIONS } from "../../utils/permissions";
import StatusBadge from "../../components/estamps/StatusBadge";
import { actionErrorMessage, formatCurrency } from "../../utils/format";

// Non-terminal processing statuses - the only states worth polling while
// this page is open. No fake progress: just a periodic re-fetch of the real
// order until it reaches a terminal state, then the poll stops.
const NON_TERMINAL_STATUSES = ["SUBMITTING", "SUBMITTED", "PROCESSING"];
const POLL_INTERVAL_MS = 8000;

function fmt(date) {
  return date ? new Date(date).toLocaleString() : "Not available";
}

export default function OrderDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const canDownload = hasPermission(user, PERMISSIONS.ESTAMP_DOWNLOAD);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  // null | "process" | "sync" - which action is currently in flight.
  const [busyAction, setBusyAction] = useState(null);
  // null | "process" | "sync" - which action is awaiting confirmation.
  const [confirming, setConfirming] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(null);
  const [pollStopped, setPollStopped] = useState(false);
  const pollRef = useRef(null);

  const load = useCallback(
    (silent = false) => {
      if (!silent) setLoading(true);
      return apiClient
        .get(`/orders/${id}`)
        .then((res) => {
          setData(res.data.data);
          setError(null);
          setPollStopped(false);
        })
        .catch((err) => {
          setError(actionErrorMessage(err, "Failed to load order."));
          // A failing background poll must not hammer the API - stop it.
          if (silent) setPollStopped(true);
        })
        .finally(() => {
          if (!silent) setLoading(false);
        });
    },
    [id]
  );

  useEffect(() => {
    load();
  }, [load]);

  // Poll only while the order is genuinely in flight at the provider; stops
  // on a terminal state, on a failed poll, while the tab is hidden, and is
  // always cleaned up on unmount.
  useEffect(() => {
    const currentStatus = data?.order?.eStampStatus;
    const shouldPoll = !!currentStatus && NON_TERMINAL_STATUSES.includes(currentStatus) && !pollStopped;
    if (!shouldPoll) return undefined;
    pollRef.current = setInterval(() => {
      if (document.visibilityState === "visible") load(true);
    }, POLL_INTERVAL_MS);
    return () => {
      clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [data?.order?.eStampStatus, pollStopped, load]);

  async function runAction(action) {
    setConfirming(null);
    setBusyAction(action);
    setError(null);
    setNotice(null);
    try {
      const res = await apiClient.post(`/orders/${id}/${action}`);
      const result = res.data.data || {};
      // Report what the backend actually did rather than always claiming
      // success.
      if (result.uncertain) {
        setNotice("The provider call did not return a confirmed result. The order stays in SUBMITTING and will not be resubmitted automatically.");
      } else if (result.alreadyTerminal) {
        setNotice("This order has already reached a terminal state; nothing was changed.");
      } else if (result.alreadySubmitting) {
        setNotice("This order is already being submitted; nothing was changed.");
      } else {
        setNotice(action === "process" ? "Order submitted for processing." : "Status synced with the provider.");
      }
      await load(true);
    } catch (err) {
      setError(actionErrorMessage(err, action === "process" ? "Failed to process order." : "Failed to sync status."));
      await load(true);
    } finally {
      setBusyAction(null);
    }
  }

  async function handleDownload() {
    setDownloadError(null);
    setDownloading(true);
    try {
      const { data: res } = await apiClient.get(`/files/estamp/${id}/download`);
      const { url, filename } = res.data;
      // Fetch the short-lived signed URL as a blob and save it under our
      // own sanitized filename - never navigate to the raw storage URL.
      const blobResponse = await fetch(url);
      if (!blobResponse.ok) throw new Error("Download failed");
      const blob = await blobResponse.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename || "estamp-certificate";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      setDownloadError(actionErrorMessage(err, "Certificate download failed. Please try again."));
    } finally {
      setDownloading(false);
    }
  }

  if (loading) return <div className="p-8 text-center text-slate-500">Loading...</div>;
  if (error && !data) {
    return (
      <div className="space-y-3">
        <Link to="/orders" className="text-sm text-slate-500 hover:underline">
          ← Orders
        </Link>
        <div role="alert" className="rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">
          {error}
        </div>
      </div>
    );
  }
  if (!data) return null;

  const { order, request, certificateAvailable, document: certificateDocument, timeline, history, availableActions = {} } = data;
  const isIssued = order.eStampStatus === "ISSUED";
  const isFailed = order.eStampStatus === "FAILED";
  const certificateReady = isIssued && certificateAvailable && certificateDocument?.downloadAvailable !== false;
  const inFlight = NON_TERMINAL_STATUSES.includes(order.eStampStatus);
  // SUBMITTING with no provider reference = the provider call's outcome is
  // unknown. Shown honestly; never "fixed" by resubmitting.
  const ambiguousSubmit = order.eStampStatus === "SUBMITTING" && !order.providerReference;
  const canProcess = !!availableActions.process;
  const canSync = !!availableActions.sync;

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link to="/orders" className="text-sm text-slate-500 hover:underline">
          ← Orders
        </Link>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-900 break-all">{order.orderNumber}</h1>
            <p className="text-xs text-slate-500 mt-1">
              Created {fmt(order.createdAt)} · Last updated {fmt(order.updatedAt)}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={order.status} />
            <StatusBadge status={order.eStampStatus} />
            <button onClick={() => load(true)} className="text-sm rounded-lg border border-slate-300 px-3 py-1 text-slate-600 hover:bg-slate-50">
              Refresh
            </button>
          </div>
        </div>
      </div>

      {notice && (
        <div role="status" className="rounded-lg bg-green-50 text-green-700 text-sm px-3 py-2">
          {notice}
        </div>
      )}
      {error && (
        <div role="alert" className="rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">
          {error}
        </div>
      )}
      {pollStopped && inFlight && <div className="rounded-lg bg-amber-50 text-amber-800 text-sm px-3 py-2">Automatic refresh paused after an error. Use Refresh to update.</div>}

      {isFailed && (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5 space-y-1">
          <h2 className="font-medium text-red-800">Processing Failed</h2>
          <p className="text-sm text-red-700">Failure Reason</p>
          <p className="text-sm text-red-900 break-words">{order.failureReason || "No failure reason was recorded."}</p>
          <p className="text-xs text-red-700 pt-1">FAILED is a terminal state; the backend does not offer an in-place retry or resubmission for it.</p>
        </div>
      )}
      {ambiguousSubmit && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 space-y-1">
          <h2 className="font-medium text-amber-800">Submission outcome unconfirmed</h2>
          <p className="text-sm text-amber-900">
            The provider did not return a confirmed result for this submission. To avoid a duplicate submission the system will not resubmit this order automatically, and there is no provider reference yet to sync
            against.
          </p>
          {order.failureReason && <p className="text-xs text-amber-800 break-words">Last error: {order.failureReason}</p>}
        </div>
      )}

      {/* Current status: E-Stamp vs Certificate are deliberately separate */}
      <Card title="Current status">
        <div className="grid sm:grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-xs text-slate-500 mb-1">Processing status</p>
            <StatusBadge status={order.eStampStatus} />
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">E-Stamp</p>
            <p className="font-medium text-slate-900">{isIssued ? "Issued" : isFailed ? "Failed" : "Not issued yet"}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">Certificate</p>
            <p className="font-medium text-slate-900">{certificateReady ? "Available" : isIssued ? "Not yet available" : "Not available"}</p>
          </div>
        </div>
        <div className="mt-4 space-y-3 text-sm">
          <Row label="Amount" value={formatCurrency(order.amount)} />
        </div>
        {(canProcess || canSync) && (
          <div className="mt-4 border-t border-slate-100 pt-4">
            <div className="flex flex-wrap gap-2">
              {canProcess && (
                <button disabled={!!busyAction || !!confirming} onClick={() => setConfirming("process")} className="text-sm rounded-lg bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 disabled:opacity-50">
                  {busyAction === "process" ? "Processing..." : "Process Order"}
                </button>
              )}
              {canSync && (
                <button disabled={!!busyAction || !!confirming} onClick={() => setConfirming("sync")} className="text-sm rounded-lg border border-slate-300 px-4 py-2 disabled:opacity-50 hover:bg-slate-50">
                  {busyAction === "sync" ? "Syncing..." : "Sync Status"}
                </button>
              )}
            </div>
            {confirming && (
              <div role="alertdialog" aria-label="Confirm action" className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                <p className="text-slate-700 mb-2">
                  {confirming === "process"
                    ? "Submit this order to the E-Stamp provider? This does not charge the wallet again; the wallet was debited once, when the request was created."
                    : "Ask the provider for this order's current status? This does not charge the wallet."}
                </p>
                <div className="flex gap-2">
                  <button onClick={() => runAction(confirming)} className="rounded-lg bg-slate-900 text-white px-3 py-1.5 text-sm">
                    Confirm
                  </button>
                  <button onClick={() => setConfirming(null)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm">
                    Cancel
                  </button>
                </div>
              </div>
            )}
            <p className="text-xs text-slate-500 mt-3">
              Actions are audited. Availability is decided by the server from your permissions and the order's current state. A real government E-Stamp provider integration is pending the official provider
              specification; outside production, processing runs against a development simulation.
            </p>
          </div>
        )}
      </Card>

      <Card title="Processing timeline">
        {timeline?.length > 0 ? (
          <ol className="relative border-l border-slate-200 ml-2 space-y-4">
            {timeline.map((step) => (
              <li key={`${step.label}-${step.at}`} className="ml-4">
                <span className={`absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full ${step.label === "Failed" ? "bg-red-500" : "bg-brand-600"}`} />
                <div className="flex flex-wrap justify-between gap-x-4 text-sm">
                  <span className="text-slate-800">{step.label}</span>
                  <span className="text-slate-400">{fmt(step.at)}</span>
                </div>
                {step.reason && <p className="text-xs text-red-700 break-words">{step.reason}</p>}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-slate-500">No timeline events recorded.</p>
        )}
        <p className="text-xs text-slate-400 mt-3">Only events with a recorded timestamp are shown.</p>
      </Card>

      {request ? (
        <Card
          title="Request information"
          action={
            <Link to={`/estamps/requests/${request._id}`} className="text-sm text-brand-600 hover:underline">
              View Request →
            </Link>
          }
        >
          <div className="space-y-3 text-sm">
            <Row label="Request ID" value={request.requestNumber} />
            <Row label="Request status" value={<StatusBadge status={request.status} />} />
            {request.stateCode && <Row label="State" value={request.stateCode} />}
            <Row label="First party" value={request.firstParty} />
            <Row label="Second party" value={request.secondParty} />
            <Row label="Description" value={request.descriptionOfDocument} />
            <Row label="Consideration price" value={request.considerationPrice != null ? formatCurrency(request.considerationPrice) : "Not available"} />
            <Row label="Stamp duty paid by" value={request.stampDutyPaidBy} />
            <Row label="No. of E-Stamps" value={request.numberOfEStamps} />
            <Row label="Calculated stamp duty" value={request.calculatedStampDuty != null ? formatCurrency(request.calculatedStampDuty) : "Not available"} />
            {request.createdAt && <Row label="Request created" value={fmt(request.createdAt)} />}
          </div>
        </Card>
      ) : (
        <Card title="Request information">
          <p className="text-sm text-slate-500">The linked request could not be loaded.</p>
        </Card>
      )}

      <Card title="Provider information">
        <div className="space-y-3 text-sm">
          <Row label="Provider reference" value={order.providerReference || "Not available"} />
          <Row label="Provider raw status" value={order.providerRawStatus || "Not available"} />
          <Row label="Submitted at" value={fmt(order.submittedAt)} />
          <Row label="Last synced at" value={fmt(order.lastSyncedAt)} />
          <Row label="Issued at" value={fmt(order.issuedAt)} />
          <Row label="Retry count" value={order.retryCount ?? 0} />
        </div>
      </Card>

      <Card title="Certificate">
        <div className="text-sm space-y-2">
          {!isIssued ? (
            <p className="text-slate-500">No certificate is available yet. A certificate can only exist once the E-Stamp has been issued.</p>
          ) : !certificateReady ? (
            <>
              <p className="font-medium text-slate-900">E-Stamp Issued</p>
              <p className="text-slate-500">Certificate document is not currently available.</p>
            </>
          ) : (
            <>
              <p className="font-medium text-slate-900">Certificate Available</p>
              {certificateDocument && (
                <div className="text-slate-600 space-y-0.5">
                  {certificateDocument.filename && <p className="break-all">{certificateDocument.filename}</p>}
                  {typeof certificateDocument.fileSize === "number" && <p className="text-slate-400">{(certificateDocument.fileSize / 1024).toFixed(1)} KB</p>}
                  {certificateDocument.createdAt && <p className="text-slate-400">Attached {fmt(certificateDocument.createdAt)}</p>}
                </div>
              )}
              {downloadError && (
                <div role="alert" className="rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">
                  {downloadError}
                </div>
              )}
              {canDownload ? (
                <button onClick={handleDownload} disabled={downloading} className="bg-brand-600 hover:bg-brand-700 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">
                  {downloading ? "Downloading…" : downloadError ? "Retry download" : "Download Certificate"}
                </button>
              ) : (
                <p className="text-xs text-slate-500">You do not have permission to download certificates.</p>
              )}
            </>
          )}
        </div>
      </Card>

      {/* Activity / audit - only returned by the server to actors with AUDIT_VIEW */}
      {Array.isArray(history) && (
        <Card title="Activity / audit">
          {history.length === 0 ? (
            <p className="text-sm text-slate-500">No audit activity recorded for this order.</p>
          ) : (
            <ol className="space-y-2 text-sm">
              {history.map((h) => (
                <li key={h._id || `${h.action}-${h.createdAt}`} className="flex flex-wrap justify-between gap-x-4 border-b border-slate-100 pb-2 last:border-0">
                  <span className="text-slate-700">
                    {h.action} <span className="text-slate-400">({h.actorRole})</span>
                  </span>
                  <span className="text-slate-400">{fmt(h.createdAt)}</span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      )}
    </div>
  );
}

function Card({ title, action, children }) {
  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-medium text-slate-900">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 pb-2 last:border-0">
      <span className="text-slate-500 shrink-0">{label}</span>
      <span className="font-medium text-slate-900 text-right break-words min-w-0">{value}</span>
    </div>
  );
}
