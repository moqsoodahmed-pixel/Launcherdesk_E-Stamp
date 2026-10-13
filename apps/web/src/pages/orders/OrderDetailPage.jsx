import { CheckCircle2 } from "lucide-react";
import { useEffect, useRef, useState, useCallback } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { apiClient } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { hasPermission, PERMISSIONS } from "../../utils/permissions";
import ErrorState from "../../components/common/ErrorState";
import StatusBadge from "../../components/estamps/StatusBadge";
import { actionErrorMessage, formatCurrency } from "../../utils/format";
import FulfilmentPanel from "../../components/orders/FulfilmentPanel";

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
  const location = useLocation();
  const backTo = location.state?.from || "/orders";
  const backLabel = location.state?.label || "Orders";
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
  const [viewing, setViewing] = useState(false);
  // { objectUrl, isImage } while the in-portal certificate viewer is open.
  const [viewer, setViewer] = useState(null);
  const viewerRef = useRef(null);
  viewerRef.current = viewer;
  const [verifying, setVerifying] = useState(false);
  const [verifyNotes, setVerifyNotes] = useState("");
  const [showVerifyModal, setShowVerifyModal] = useState(false);
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

  // Both View and Download go through the same authenticated endpoint, so the
  // same role/organization checks apply to each, and the short-lived signed
  // storage URL is only ever fetched here - never shown, linked or emailed.
  async function fetchCertificateBlob() {
    const { data: res } = await apiClient.get(`/files/estamp/${id}/download`);
    const { url, filename, contentType } = res.data;
    const blobResponse = await fetch(url);
    if (!blobResponse.ok) throw new Error("Certificate could not be loaded");
    const raw = await blobResponse.blob();
    // Re-typed from what OUR server said the file is, not whatever the
    // storage host happened to label it, so it renders inline as a PDF/image
    // instead of falling back to a forced download.
    const blob = contentType ? new Blob([raw], { type: contentType }) : raw;
    return { blob, filename, contentType: contentType || blob.type };
  }

  async function handleDownload() {
    setDownloadError(null);
    setDownloading(true);
    try {
      const { blob, filename } = await fetchCertificateBlob();
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

  // Shows the certificate inside the portal itself. The blob URL is released
  // as soon as the viewer closes (or the page unmounts).
  async function handleView() {
    setDownloadError(null);
    setViewing(true);
    try {
      const { blob, contentType } = await fetchCertificateBlob();
      setViewer({ objectUrl: URL.createObjectURL(blob), isImage: /^image\//i.test(contentType || "") });
    } catch (err) {
      setDownloadError(actionErrorMessage(err, "Certificate could not be opened. Please try again."));
    } finally {
      setViewing(false);
    }
  }

  function closeViewer() {
    setViewer((current) => {
      if (current) URL.revokeObjectURL(current.objectUrl);
      return null;
    });
  }

  useEffect(() => () => viewerRef.current && URL.revokeObjectURL(viewerRef.current.objectUrl), []);

  async function handleVerifyDocuments() {
    setVerifying(true);
    setError(null);
    try {
      await apiClient.post(`/orders/${id}/verify-documents`, { notes: verifyNotes });
      setNotice("Documents verified and confirmed as correct.");
      setShowVerifyModal(false);
      await load(true);
    } catch (err) {
      setError(actionErrorMessage(err, "Failed to verify documents."));
    } finally {
      setVerifying(false);
    }
  }

  if (loading) return <div className="p-8 text-center text-slate-500">Loading...</div>;
  if (error && !data) {
    return (
      <div className="space-y-3">
        <Link to={backTo} className="inline-flex min-h-[36px] items-center text-sm text-slate-600 hover:text-slate-900 hover:underline">
          ← {backLabel}
        </Link>
        <ErrorState message={error} onRetry={() => load()} />
      </div>
    );
  }
  if (!data) return null;

  const { order, request, certificateAvailable, document: certificateDocument, timeline, history, availableActions = {} } = data;
  // Manual fulfilment: LauncherDesk staff stamp outside the app - plain
  // wording for clients, a Fulfilment panel for permitted staff.
  const manual = data.fulfilmentMode === "manual";
  const showFulfilment = manual && (availableActions.start || availableActions.fulfil || availableActions.fail);
  const isIssued = order.eStampStatus === "ISSUED";
  const isFailed = order.eStampStatus === "FAILED";
  const certificateReady = isIssued && certificateAvailable && certificateDocument?.downloadAvailable !== false;
  const inFlight = NON_TERMINAL_STATUSES.includes(order.eStampStatus);
  // SUBMITTING with no provider reference = the provider call's outcome is
  // unknown. Shown honestly; never "fixed" by resubmitting.
  const ambiguousSubmit = !manual && order.eStampStatus === "SUBMITTING" && !order.providerReference;
  const canProcess = !!availableActions.process;
  const canSync = !!availableActions.sync;

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link to={backTo} className="inline-flex min-h-[36px] items-center text-sm text-slate-600 hover:text-slate-900 hover:underline">
          ← {backLabel}
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
        <div role="status" className="rounded-lg border border-green-200 bg-green-50 px-3 py-2.5 text-sm text-green-700">
          {notice}
        </div>
      )}
      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
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

      {showFulfilment && (
        <FulfilmentPanel
          order={order}
          request={request}
          articleTitle={request?.articleTitle}
          actions={availableActions}
          onDone={(message) => {
            setNotice(message);
            load(true);
          }}
        />
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
            <p className="font-medium text-slate-900">{isIssued ? "Issued" : isFailed ? "Failed" : manual ? "Being prepared by LauncherDesk" : "Not issued yet"}</p>
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
                  <span className="text-slate-800">
                    {step.label}
                    {step.upcoming && <span className="text-amber-600"> (upcoming)</span>}
                    {step.downloadable && <span className="text-slate-500"> (Download below)</span>}
                  </span>
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
            <Link to={`/estamps/requests/${request._id}`} className="text-sm font-medium text-brand-700 hover:underline">
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

      {/* Document Review & Verification */}
      <Card
        title="Document Verification"
        action={
          order.documentsVerified || request?.documentsVerified ? (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
              <CheckCircle2 size={14} className="mr-1" aria-hidden="true" />
              Documents Verified
            </span>
          ) : (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
              Pending Review
            </span>
          )
        }
      >
        <div className="space-y-4 text-sm">
          <p className="text-slate-600">
            Admins and Master Admins can review all party details, agreement descriptions, and uploaded document attachments to confirm everything is accurate before the 20-minute window closes.
          </p>

          <Row
            label="Verification status"
            value={
              order.documentsVerified || request?.documentsVerified
                ? "Verified & Confirmed"
                : "Awaiting Admin Review"
            }
          />
          {(order.verifiedAt || request?.verifiedAt) && (
            <Row label="Verified at" value={fmt(order.verifiedAt || request?.verifiedAt)} />
          )}
          {(order.verificationNotes || request?.verificationNotes) && (
            <Row label="Notes" value={order.verificationNotes || request?.verificationNotes} />
          )}

          {Array.isArray(data?.supportingDocuments) && data.supportingDocuments.length > 0 && (
            <div className="mt-3 pt-3 border-t border-slate-100">
              <h4 className="text-xs font-semibold text-slate-500 mb-2">Uploaded Documents ({data.supportingDocuments.length})</h4>
              <ul className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                {data.supportingDocuments.map((doc) => (
                  <li key={doc._id} className="p-3 flex items-center justify-between text-sm">
                    <div>
                      <p className="font-medium text-slate-800">{doc.originalFileName}</p>
                      <p className="text-xs text-slate-400">
                        {doc.fileType} • {doc.sizeBytes ? `${(doc.sizeBytes / 1024).toFixed(1)} KB` : ""} • {fmt(doc.createdAt)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!(order.documentsVerified || request?.documentsVerified) && (
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setShowVerifyModal(true)}
                className="bg-brand-600 hover:bg-brand-700 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors"
              >
                Confirm Documents Correct
              </button>
            </div>
          )}
        </div>
      </Card>

      {manual ? (
        <Card title="Stamp details">
          <div className="space-y-3 text-sm">
            <Row label="Stamp reference" value={order.providerReference || "Not issued yet"} />
            <Row label="Work started" value={fmt(order.startedAt)} />
            <Row label="Issued at" value={fmt(order.issuedAt)} />
          </div>
        </Card>
      ) : (
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
      )}

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
                <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
                  {downloadError}
                </div>
              )}
              {canDownload ? (
                <div className="flex flex-wrap gap-2">
                  <button onClick={handleView} disabled={viewing || downloading} className="border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">
                    {viewing ? "Opening…" : "View Certificate"}
                  </button>
                  <button onClick={handleDownload} disabled={downloading || viewing} className="inline-flex min-h-[44px] sm:min-h-[40px] items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50">
                    {downloading ? "Downloading…" : downloadError ? "Retry download" : "Download Certificate"}
                  </button>
                </div>
              ) : (
                <p className="text-xs text-slate-500">You do not have permission to view or download certificates.</p>
              )}
              <p className="text-xs text-slate-400">Certificates are never sent by email - view and download them here.</p>
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

      {showVerifyModal && (
        <div className="fixed inset-0 bg-midnight-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-dialog max-w-md w-full p-6 shadow-overlay border border-slate-200">
            <h3 className="text-lg font-semibold text-slate-900 mb-2">Confirm Document Verification</h3>
            <p className="text-sm text-slate-600 mb-4">
              Please verify that party names ({request?.firstParty} & {request?.secondParty}), consideration value, and attached document descriptions are correct.
            </p>
            <div className="mb-4">
              <label className="mb-1.5 block text-sm font-medium text-slate-800">Verification Notes (Optional)</label>
              <textarea
                value={verifyNotes}
                onChange={(e) => setVerifyNotes(e.target.value)}
                rows={3}
                placeholder="e.g. Identity and agreement documents verified against registry..."
                className="w-full text-sm rounded-lg border border-slate-300 p-2.5 focus:ring-2 focus:ring-brand-500 focus:outline-none"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowVerifyModal(false)}
                disabled={verifying}
                className="rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleVerifyDocuments}
                disabled={verifying}
                className="rounded-lg px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 text-white font-medium disabled:opacity-50"
              >
                {verifying ? "Confirming..." : "Confirm & Mark Verified"}
              </button>
            </div>
          </div>
        </div>
      )}

      {viewer && (
        <div role="dialog" aria-modal="true" aria-label="Certificate viewer" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white rounded-dialog shadow-overlay w-full max-w-4xl h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
              <h2 className="font-medium text-slate-900">E-Stamp certificate</h2>
              <button type="button" onClick={closeViewer} className="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">
                Close
              </button>
            </div>
            <div className="flex-1 min-h-0 bg-slate-100">
              {viewer.isImage ? (
                <img src={viewer.objectUrl} alt="E-Stamp certificate" className="w-full h-full object-contain" />
              ) : (
                <iframe src={viewer.objectUrl} title="E-Stamp certificate" className="w-full h-full border-0" />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Card({ title, action, children }) {
  return (
    <section className="card p-5 sm:p-6">
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
