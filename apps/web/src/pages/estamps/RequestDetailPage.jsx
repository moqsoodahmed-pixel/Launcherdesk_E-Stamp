import { clientRequestSteps } from "../../utils/clientTimeline";
import { isClientRole } from "../../components/ui/status";
import Toast from "../../components/ui/Toast";
import { useConfirm } from "../../components/ui/useConfirm";
import VerifyDocumentsDialog from "../../components/estamps/VerifyDocumentsDialog";
import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { apiClient } from "../../api/client";
import { formatCurrency, errorMessage } from "../../utils/format";
import StatusBadge from "../../components/estamps/StatusBadge";
import { useAuth } from "../../context/AuthContext";
import { hasPermission, PERMISSIONS } from "../../utils/permissions";
import { isManualFulfilment } from "../../utils/fulfilment";

function formatCountdown(totalSeconds) {
  const s = Math.max(0, totalSeconds || 0);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// Backend distinguishes WINDOW_EXPIRED / INVALID_STATE / ALREADY_CANCELLED via
// ApiError's `code` (see estamp-request.service.js) - show a clear message per
// case rather than one generic string, but fall back to the server's own
// `message` (already clear) for anything else instead of over-engineering this.
const ERROR_MESSAGES_BY_CODE = {
  WINDOW_EXPIRED: "The 20-minute modification window has closed for this request.",
  INVALID_STATE: "This request is no longer in a state that can be modified or cancelled.",
  ALREADY_CANCELLED: "This request has already been cancelled.",
};
function describeError(err, fallback) {
  const code = err?.response?.data?.code;
  return ERROR_MESSAGES_BY_CODE[code] || errorMessage(err, fallback);
}

export default function RequestDetailPage() {
  const [confirm, confirmDialog] = useConfirm();
  const { id } = useParams();
  const { user } = useAuth();
  const [request, setRequest] = useState(null);
  const [order, setOrder] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(null);
  const [error, setError] = useState(null);
  // e.g. "Request REQ-0001 created..." handed over by the New Request wizard.
  const location = useLocation();
  const [notice, setNotice] = useState(location.state?.notice || null);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState(null);
  // WHICH party pays, tracked separately from the name string that actually
  // gets submitted - mirrors the fix on the New Request wizard. Two parties
  // can share a name, and a plain text box here (the old "Edit details" form)
  // let the payer be edited into any arbitrary text with no link back to
  // either actual party at all. null means "doesn't match either party
  // exactly" (e.g. it was typed free-form before this fix) - the field falls
  // back to a plain text box rather than guessing.
  const [paidBySide, setPaidBySide] = useState(null);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [showVerifyModal, setShowVerifyModal] = useState(false);
  const [verifyNotes, setVerifyNotes] = useState("");
  // Only drives the initial-load empty/error state (never re-enters true once
  // the first successful load has happened - a later reload() failure during
  // save/cancel is already surfaced via `error` without hiding the page).
  const [initialLoading, setInitialLoading] = useState(true);

  async function handleVerifyDocuments() {
    setVerifying(true);
    setError(null);
    try {
      await apiClient.post(`/estamps/${id}/verify-documents`, { notes: verifyNotes });
      setNotice("Documents verified and confirmed as correct.");
      setShowVerifyModal(false);
      await reload();
    } catch (err) {
      setError(describeError(err, "Unable to verify documents"));
    } finally {
      setVerifying(false);
    }
  }

  // ---- Data loading (unchanged authority: the server's canModify/canCancel/
  // windowExpiresAt/windowRemainingSeconds are always trusted as-is, never
  // re-derived here) ----
  function reload() {
    return apiClient.get(`/estamps/${id}`).then((res) => {
      setRequest(res.data.data);
      setSecondsLeft(typeof res.data.data.windowRemainingSeconds === "number" ? res.data.data.windowRemainingSeconds : null);
      const { firstParty, secondParty, stampDutyPaidBy } = res.data.data;
      setEditForm({
        firstParty,
        secondParty,
        descriptionOfDocument: res.data.data.descriptionOfDocument,
        propertyDescription: res.data.data.propertyDescription || "",
        stampDutyPaidBy,
        considerationPrice: String(res.data.data.considerationPrice ?? ""),
        numberOfEStamps: String(res.data.data.numberOfEStamps ?? ""),
      });
      // Only inferred when it names exactly one of the two parties - if both
      // happen to share that name, or it matches neither, this intentionally
      // stays unset rather than guessing.
      const matchesFirst = stampDutyPaidBy === firstParty;
      const matchesSecond = stampDutyPaidBy === secondParty;
      setPaidBySide(matchesFirst && !matchesSecond ? "FIRST" : matchesSecond && !matchesFirst ? "SECOND" : null);
      if (res.data.data.orderId) {
        apiClient
          .get(`/orders/${res.data.data.orderId}`)
          .then((r) => setOrder(r.data.data))
          .catch(() => setOrder(null));
      } else {
        setOrder(null);
      }
    });
  }

  useEffect(() => {
    setError(null);
    reload()
      // Without this, a failed initial load (404/500/network) left `request`
      // null forever - the page stayed on "Loading..." indefinitely with no
      // visible error and no way to retry, since the rejection was never
      // caught anywhere.
      .catch((err) => setError(describeError(err, "Unable to load this request.")))
      .finally(() => setInitialLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function choosePayer(side) {
    setPaidBySide(side);
    setEditForm((f) => ({ ...f, stampDutyPaidBy: side === "FIRST" ? f.firstParty : f.secondParty }));
  }

  // Keeps the submitted name in step with the chosen party if that party's
  // name is edited in the same form, and clears the selection if the chosen
  // party's name is emptied out entirely - same safeguard as the creation
  // wizard, applied here too.
  useEffect(() => {
    if (!editForm || !paidBySide) return;
    const name = paidBySide === "FIRST" ? editForm.firstParty : editForm.secondParty;
    if (!name) {
      setPaidBySide(null);
      setEditForm((f) => ({ ...f, stampDutyPaidBy: "" }));
      return;
    }
    if (name !== editForm.stampDutyPaidBy) {
      setEditForm((f) => ({ ...f, stampDutyPaidBy: name }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paidBySide, editForm?.firstParty, editForm?.secondParty]);

  async function handleSaveEdit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      // Amount fields are sent only when changed: the server recalculates the
      // stamp duty and adjusts the reservation (or rejects INSUFFICIENT_BALANCE).
      const { considerationPrice, numberOfEStamps, ...descriptive } = editForm;
      const body = { ...descriptive };
      if (considerationPrice !== "" && Number(considerationPrice) !== request.considerationPrice) body.considerationPrice = Number(considerationPrice);
      if (numberOfEStamps !== "" && Number(numberOfEStamps) !== request.numberOfEStamps) body.numberOfEStamps = Number(numberOfEStamps);
      await apiClient.patch(`/estamps/${id}`, body);
      setEditing(false);
      setNotice("Request updated.");
      await reload();
    } catch (err) {
      setError(describeError(err, "Unable to save changes"));
    } finally {
      setSaving(false);
    }
  }

  // DISPLAY ONLY - counts down the seconds the server already reported.
  // Never itself decides canModify/canCancel; those stay exactly what the
  // server returned as of the last successful load/action. Real enforcement
  // remains the backend's atomic conditional update.
  useEffect(() => {
    if (secondsLeft === null || request?.status !== "MODIFICATION_WINDOW") return;
    const interval = setInterval(() => {
      setSecondsLeft((s) => (s === null ? s : Math.max(s - 1, 0)));
    }, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.status, secondsLeft === null]);

  async function handleCancel() {
    setError(null);
    const ok = await confirm({ title: "Cancel this E-Stamp request?", message: "This cannot be undone.", confirmLabel: "Cancel the request", tone: "danger" });
    if (!ok) return;
    try {
      await apiClient.post(`/estamps/${id}/cancel`);
      setNotice("Request cancelled.");
      await reload();
    } catch (err) {
      setError(describeError(err, "Unable to cancel"));
    }
  }

  if (!request && initialLoading) return <div className="text-slate-500">Loading...</div>;
  if (!request) {
    return (
      <div className="space-y-3">
        <Link to="/estamps/requests" className="inline-flex min-h-[36px] items-center text-sm text-slate-600 hover:text-slate-900 hover:underline">
          ← Requests
        </Link>
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
          {error || "Unable to load this request."}
        </div>
        <button
          onClick={() => {
            setInitialLoading(true);
            setError(null);
            reload()
              .catch((err) => setError(describeError(err, "Unable to load this request.")))
              .finally(() => setInitialLoading(false));
          }}
          className="inline-flex min-h-[44px] sm:min-h-[40px] items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50"
        >
          Retry
        </button>
      </div>
    );
  }

  // The server's canModify/canCancel are the authority, but they are a
  // snapshot: once the displayed countdown reaches 0 the window is treated as
  // closed (the server would answer 409 WINDOW_EXPIRED). They are also not
  // permission-aware, so the user's own ESTAMP_MODIFY/ESTAMP_CANCEL is
  // checked too (USER has neither, ADMIN has no cancel).
  const windowOpen = secondsLeft === null || secondsLeft > 0;
  const canModify = !!request.canModify && windowOpen && hasPermission(user, PERMISSIONS.ESTAMP_MODIFY);
  const mayCancel = hasPermission(user, PERMISSIONS.ESTAMP_CANCEL);
  const canCancel = !!request.canCancel && windowOpen && mayCancel;
  const windowStillOpen = (!!request.canModify || !!request.canCancel) && windowOpen;

  return (
    <div className="max-w-3xl space-y-6 pb-10">
      {confirmDialog}
      <div>
        <Link to="/estamps/requests" className="inline-flex min-h-[36px] items-center text-sm text-slate-600 hover:text-slate-900 hover:underline">
          ← Requests
        </Link>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <h1 className="font-display text-2xl font-semibold text-slate-900">{request.requestNumber}</h1>
          <StatusBadge status={request.status} remainingSeconds={request.status === "MODIFICATION_WINDOW" && typeof secondsLeft === "number" ? secondsLeft : undefined} />
        </div>
      </div>

      {notice && <Toast tone="success">{notice}</Toast>}
      {error && <Toast tone="error">{error}</Toast>}

      {/* Request Information */}
      <Section title="Request Information">
        {!editing ? (
          <div className="space-y-3 text-sm">
            <Row label="First Party" value={request.firstParty} />
            <Row label="Second Party" value={request.secondParty} />
            <Row label="Description" value={request.descriptionOfDocument} />
            <Row label="Property Description" value={request.propertyDescription || "-"} />
            {canModify && (
              <button onClick={() => setEditing(true)} className="text-sm font-medium text-brand-700 hover:underline">
                Edit details
              </button>
            )}
          </div>
        ) : (
          <form onSubmit={handleSaveEdit} className="space-y-3">
            <EditField label="First Party" value={editForm.firstParty} onChange={(v) => setEditForm((f) => ({ ...f, firstParty: v }))} />
            <EditField label="Second Party" value={editForm.secondParty} onChange={(v) => setEditForm((f) => ({ ...f, secondParty: v }))} />
            <EditField
              label="Description of Document"
              value={editForm.descriptionOfDocument}
              onChange={(v) => setEditForm((f) => ({ ...f, descriptionOfDocument: v }))}
            />
            <EditField
              label="Property Description"
              value={editForm.propertyDescription}
              onChange={(v) => setEditForm((f) => ({ ...f, propertyDescription: v }))}
            />
            {editForm.firstParty && editForm.secondParty ? (
              <div className="block">
                <span className="mb-1.5 block text-sm font-medium text-slate-800">Who pays the stamp duty?</span>
                <div role="group" aria-label="Who pays the stamp duty?" className="flex gap-2">
                  <button
                    type="button"
                    aria-pressed={paidBySide === "FIRST"}
                    onClick={() => choosePayer("FIRST")}
                    className={`px-3 py-2 rounded-lg border text-sm flex-1 text-left ${
                      paidBySide === "FIRST" ? "border-brand-600 bg-brand-50 text-brand-700 font-medium" : "border-slate-300 text-slate-600"
                    }`}
                  >
                    {editForm.firstParty} (First Party)
                  </button>
                  <button
                    type="button"
                    aria-pressed={paidBySide === "SECOND"}
                    onClick={() => choosePayer("SECOND")}
                    className={`px-3 py-2 rounded-lg border text-sm flex-1 text-left ${
                      paidBySide === "SECOND" ? "border-brand-600 bg-brand-50 text-brand-700 font-medium" : "border-slate-300 text-slate-600"
                    }`}
                  >
                    {editForm.secondParty} (Second Party)
                  </button>
                </div>
                {!paidBySide && editForm.stampDutyPaidBy && (
                  <p className="text-xs text-amber-700 mt-1">
                    Currently set to "{editForm.stampDutyPaidBy}", which doesn't match either party above. Pick one to fix it.
                  </p>
                )}
              </div>
            ) : (
              <EditField
                label="Stamp Duty Paid By"
                value={editForm.stampDutyPaidBy}
                onChange={(v) => setEditForm((f) => ({ ...f, stampDutyPaidBy: v }))}
              />
            )}
            {request.chargeStatus === "RESERVED" && (
              <>
                <EditField label="Consideration Price" type="number" value={editForm.considerationPrice} onChange={(v) => setEditForm((f) => ({ ...f, considerationPrice: v }))} />
                <EditField label="No. of E-Stamps" type="number" value={editForm.numberOfEStamps} onChange={(v) => setEditForm((f) => ({ ...f, numberOfEStamps: v }))} />
              </>
            )}
            <p className="text-xs text-slate-500">
              {request.chargeStatus === "RESERVED"
                ? "Changing the consideration price or number of E-Stamps recalculates the stamp duty and adjusts the amount reserved from your available balance. Article and state cannot be changed."
                : "Consideration price, article, state and number of E-Stamps cannot be changed after creation."}
            </p>
            <div className="flex gap-2">
              <button
                disabled={saving || !editForm.stampDutyPaidBy || (!!editForm.firstParty && !!editForm.secondParty && !paidBySide)}
                className="inline-flex min-h-[44px] sm:min-h-[40px] items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save changes"}
              </button>
              <button type="button" onClick={() => setEditing(false)} className="inline-flex min-h-[36px] items-center text-sm text-slate-600 hover:text-slate-900 hover:underline">
                Cancel
              </button>
            </div>
          </form>
        )}
      </Section>

      {/* State & Article / Calculation / Financial Information */}
      <Section title="State & Article">
        <Row label="State" value={request.stateCode} />
        <Row label="Article version used" value={request.articleVersionUsed ?? "-"} />
        <Row label="No. of E-Stamps" value={request.numberOfEStamps} />
      </Section>

      <Section title="Financial Information">
        <Row label="Consideration Price" value={formatCurrency(request.considerationPrice)} />
        <Row label={`Stamp Duty (${chargeLabel(request.chargeStatus)})`} value={formatCurrency(request.calculatedStampDuty)} />
        <Row label="Stamp Duty Paid By" value={request.stampDutyPaidBy} />
      </Section>

      {/* Document Review & Verification */}
      <Section title="Document Verification">
        <div className="space-y-3 text-sm">
          <Row
            label="Verification status"
            value={
              request.documentsVerified
                ? "Documents Verified & Confirmed"
                : "Awaiting Admin Review"
            }
          />
          {request.verifiedAt && <Row label="Verified at" value={new Date(request.verifiedAt).toLocaleString()} />}
          {request.verificationNotes && <Row label="Notes" value={request.verificationNotes} />}
          {!request.documentsVerified && (
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setShowVerifyModal(true)}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white transition-colors hover:bg-brand-700 sm:min-h-[40px]"
              >
                Confirm Documents Correct
              </button>
            </div>
          )}
        </div>
      </Section>

      {/* Lifecycle timeline */}
      <Section title="Lifecycle">
        <RequestTimeline request={request} order={order} manual={isManualFulfilment(user)} client={isClientRole(user?.role)} />
        {request.status === "MODIFICATION_WINDOW" && (
          <div className="mt-4 pt-4 border-t border-slate-100">
            <p className="text-sm text-slate-600 mb-3">
              {windowStillOpen ? (
                <>
                  Modification/cancellation window closes in <span className="font-medium tabular-nums">{formatCountdown(secondsLeft)}</span>.{" "}
                  {request.chargeStatus === "RESERVED" && "The amount is reserved and charged when the window ends; cancelling now costs nothing."}
                </>
              ) : (
                "Modification window has closed."
              )}
            </p>
            {mayCancel && (
              <button onClick={handleCancel} disabled={!canCancel} className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-vermilion-200 bg-white px-4 text-sm font-medium text-vermilion-700 transition-colors hover:bg-vermilion-50 disabled:opacity-40 sm:min-h-[40px]">
                Cancel Request
              </button>
            )}
          </div>
        )}
      </Section>

      {/* Order summary (link out to the existing, already-hardened Order detail page rather than duplicating it) */}
      {order && (
        <Section title="Order">
          <Row label="Order Number" value={order.order.orderNumber} />
          <Row label="Processing Status" value={<StatusBadge status={order.order.eStampStatus} />} />
          <Row label="Order Status" value={<StatusBadge status={order.order.status} />} />
          <Row label="Created" value={new Date(order.order.createdAt).toLocaleString()} />
          {order.order.issuedAt && <Row label="Issued" value={new Date(order.order.issuedAt).toLocaleString()} />}
          <Link to={`/orders/${order.order._id}`} className="inline-block mt-2 text-sm text-brand-600 hover:underline">
            View Order →
          </Link>
        </Section>
      )}

      {/* Certificate - same 4-state pattern as OrderDetailPage, summary + link only */}
      {order && (
        <Section title="Documents">
          {order.order.eStampStatus !== "ISSUED" ? (
            <p className="text-sm text-slate-500">Certificate not issued yet.</p>
          ) : !order.certificateAvailable ? (
            <p className="text-sm text-slate-500">Certificate issued; document is not yet available.</p>
          ) : (
            <div className="text-sm text-slate-600 space-y-1">
              {order.document?.filename && <p>{order.document.filename}</p>}
              <Link to={`/orders/${order.order._id}`} className="font-medium text-brand-700 hover:underline">
                View & download on the Order page →
              </Link>
            </div>
          )}
        </Section>
      )}

      {showVerifyModal && (
        <VerifyDocumentsDialog
          request={request}
          notes={verifyNotes}
          onNotesChange={setVerifyNotes}
          verifying={verifying}
          onConfirm={handleVerifyDocuments}
          onCancel={() => setShowVerifyModal(false)}
        />
      )}
    </div>
  );
}

// Only renders stages that have actually happened or are the request's real
// current state - never a future stage marked as completed. Branches for
// CANCELLED/FAILED paths rather than forcing them onto the "happy path".
// Manual fulfilment: Submitted, Window ends, Queued, In progress, then
// Issued (Download) or Failed - plain wording, real timestamps only.
function manualSteps(request, order) {
  const o = order?.order;
  const steps = [{ label: "Submitted", at: request.createdAt, done: true }];
  if (request.status === "CANCELLED") {
    steps.push({ label: "Cancelled", at: request.cancelledAt || request.updatedAt, done: true, tone: "red" });
    return steps;
  }
  const inWindow = request.status === "MODIFICATION_WINDOW";
  steps.push({ label: "Window ends", at: request.modificationDeadline, done: !inWindow, pending: inWindow });
  if (!inWindow) steps.push({ label: "Queued", at: request.lockedAt, done: true });
  if (o?.startedAt) steps.push({ label: "In progress", at: o.startedAt, done: true });
  if (o?.eStampStatus === "ISSUED") steps.push({ label: "Issued (Download)", at: o.issuedAt, done: true });
  else if (request.status === "FAILED" || o?.eStampStatus === "FAILED") steps.push({ label: "Failed", at: o?.updatedAt, done: true, tone: "red", note: o?.failureReason });
  else if (!inWindow) steps.push({ label: "Being prepared by LauncherDesk", at: null, done: false, pending: true });
  return steps;
}

function RequestTimeline({ request, order, manual, client }) {
  // Clients only ever see Submitted, Being prepared and Issued (or Failed /
  // Cancelled), whichever fulfilment mode is running.
  if (client) return <TimelineList steps={clientRequestSteps(request, order)} />;
  if (manual) return <TimelineList steps={manualSteps(request, order)} />;
  const steps = [];
  steps.push({ label: "Request created", at: request.createdAt, done: true });

  if (request.status === "CANCELLED") {
    steps.push({ label: "Cancelled", at: request.cancelledAt || request.updatedAt, done: true, tone: "red" });
  } else if (request.status === "FAILED" || order?.order?.eStampStatus === "FAILED") {
    steps.push({ label: "Modification window", at: request.modificationDeadline, done: true });
    steps.push({ label: "Failed", at: order?.order?.updatedAt, done: true, tone: "red", note: order?.order?.failureReason });
  } else {
    const reachedLock = ["LOCKED", "PROCESSING", "COMPLETED", "DOWNLOAD_AVAILABLE"].includes(request.status);
    steps.push({
      label: "Modification window",
      at: request.modificationDeadline,
      done: reachedLock || request.status === "MODIFICATION_WINDOW",
      pending: request.status === "MODIFICATION_WINDOW",
    });
    if (reachedLock) steps.push({ label: "Locked", at: request.lockedAt, done: true });
    if (order?.order?.submittedAt) steps.push({ label: "Submitted to provider", at: order.order.submittedAt, done: true });
    if (order?.order?.eStampStatus === "PROCESSING" || order?.order?.eStampStatus === "ISSUED")
      steps.push({ label: "Processing", at: order?.order?.updatedAt, done: true });
    if (order?.order?.issuedAt) steps.push({ label: "Certificate issued", at: order.order.issuedAt, done: true });
  }
  return <TimelineList steps={steps} />;
}

function TimelineList({ steps }) {
  return (
    <ol className="text-sm">
      {steps.map((s, i) => (
        <li key={i} className="relative flex items-start justify-between gap-3 pb-4 pl-7 last:pb-0">
          {i < steps.length - 1 && <span className="absolute left-[9px] top-5 h-full w-px bg-slate-200" aria-hidden="true" />}
          <span
            className={`absolute left-0 top-0.5 flex h-[19px] w-[19px] items-center justify-center rounded-full ring-4 ring-white ${
              s.tone === "red" ? "bg-vermilion-500" : s.pending ? "bg-brand-600" : s.done ? "bg-emerald-500" : "bg-slate-300"
            }`}
            aria-hidden="true"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-white" />
          </span>
          <span className={`min-w-0 ${s.tone === "red" ? "font-medium text-vermilion-700" : s.pending ? "font-medium text-brand-700" : "text-slate-800"}`}>
            {s.label}
            {s.note && <span className="text-slate-500"> ({s.note})</span>}
          </span>
          <span className="shrink-0 text-right text-xs text-slate-500 tabular-nums">{s.at ? new Date(s.at).toLocaleString() : s.pending ? "in progress" : "-"}</span>
        </li>
      ))}
    </ol>
  );
}

function Section({ title, children }) {
  return (
    <section className="card p-5 sm:p-6">
      <h2 className="mb-4 font-display text-base font-semibold text-slate-900">{title}</h2>
      {children}
    </section>
  );
}

// Legacy requests (no chargeStatus) were debited at submit.
function chargeLabel(chargeStatus) {
  switch (chargeStatus) {
    case "RESERVED":
      return "reserved";
    case "RELEASED":
      return "released, not charged";
    case "SHORTFALL":
      return "on hold: balance too low";
    default:
      return "charged";
  }
}

function EditField({ label, value, onChange, type = "text" }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-800">{label}</span>
      <input type={type} min={type === "number" ? 0 : undefined} className="input" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-b border-slate-100 py-2.5 text-sm first:pt-0 last:border-0 last:pb-0">
      <span className="text-slate-600">{label}</span>
      <span className="text-right font-medium text-slate-900">{value}</span>
    </div>
  );
}
