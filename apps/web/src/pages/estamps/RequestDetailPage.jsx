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
  const [saving, setSaving] = useState(false);
  // Only drives the initial-load empty/error state (never re-enters true once
  // the first successful load has happened - a later reload() failure during
  // save/cancel is already surfaced via `error` without hiding the page).
  const [initialLoading, setInitialLoading] = useState(true);

  // ---- Data loading (unchanged authority: the server's canModify/canCancel/
  // windowExpiresAt/windowRemainingSeconds are always trusted as-is, never
  // re-derived here) ----
  function reload() {
    return apiClient.get(`/estamps/${id}`).then((res) => {
      setRequest(res.data.data);
      setSecondsLeft(typeof res.data.data.windowRemainingSeconds === "number" ? res.data.data.windowRemainingSeconds : null);
      setEditForm({
        firstParty: res.data.data.firstParty,
        secondParty: res.data.data.secondParty,
        descriptionOfDocument: res.data.data.descriptionOfDocument,
        propertyDescription: res.data.data.propertyDescription || "",
        stampDutyPaidBy: res.data.data.stampDutyPaidBy,
        considerationPrice: String(res.data.data.considerationPrice ?? ""),
        numberOfEStamps: String(res.data.data.numberOfEStamps ?? ""),
      });
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
    if (!window.confirm("Cancel this E-Stamp request? This cannot be undone.")) return;
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
        <Link to="/estamps/requests" className="text-sm text-slate-500 hover:underline">
          ← Requests
        </Link>
        <div role="alert" className="rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">
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
          className="text-sm rounded-lg border border-slate-300 px-4 py-2 text-slate-600 hover:bg-slate-50"
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
      <div>
        <Link to="/estamps/requests" className="text-sm text-slate-500 hover:underline">
          ← Requests
        </Link>
        <div className="flex items-center justify-between mt-1">
          <h1 className="text-xl font-semibold text-slate-900">{request.requestNumber}</h1>
          <StatusBadge status={request.status} />
        </div>
      </div>

      {notice && <div className="rounded-lg bg-green-50 text-green-700 text-sm px-3 py-2">{notice}</div>}
      {error && <div className="rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>}

      {/* Request Information */}
      <Section title="Request Information">
        {!editing ? (
          <div className="space-y-3 text-sm">
            <Row label="First Party" value={request.firstParty} />
            <Row label="Second Party" value={request.secondParty} />
            <Row label="Description" value={request.descriptionOfDocument} />
            <Row label="Property Description" value={request.propertyDescription || "-"} />
            {canModify && (
              <button onClick={() => setEditing(true)} className="text-sm text-brand-600 hover:underline">
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
            <EditField
              label="Stamp Duty Paid By"
              value={editForm.stampDutyPaidBy}
              onChange={(v) => setEditForm((f) => ({ ...f, stampDutyPaidBy: v }))}
            />
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
              <button disabled={saving} className="bg-brand-600 hover:bg-brand-700 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">
                {saving ? "Saving..." : "Save changes"}
              </button>
              <button type="button" onClick={() => setEditing(false)} className="text-sm text-slate-500 hover:underline">
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

      {/* Lifecycle timeline */}
      <Section title="Lifecycle">
        <RequestTimeline request={request} order={order} manual={isManualFulfilment(user)} />
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
              <button onClick={handleCancel} disabled={!canCancel} className="text-sm text-red-600 border border-red-200 rounded-lg px-4 py-2 disabled:opacity-40">
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
          <Row label="Processing Status" value={order.order.eStampStatus} />
          <Row label="Order Status" value={order.order.status} />
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
              <Link to={`/orders/${order.order._id}`} className="text-brand-600 hover:underline">
                View & download on the Order page →
              </Link>
            </div>
          )}
        </Section>
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

function RequestTimeline({ request, order, manual }) {
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
    <ol className="space-y-2 text-sm">
      {steps.map((s, i) => (
        <li key={i} className="flex items-start justify-between border-b border-slate-100 pb-2 last:border-0">
          <span className={`flex items-center gap-2 ${s.tone === "red" ? "text-red-600" : s.pending ? "text-amber-600" : "text-slate-700"}`}>
            <span className={`h-2 w-2 rounded-full ${s.tone === "red" ? "bg-red-500" : s.pending ? "bg-amber-500" : s.done ? "bg-green-500" : "bg-slate-300"}`} />
            {s.label}
            {s.note && <span className="text-slate-400">({s.note})</span>}
          </span>
          <span className="text-slate-400">{s.at ? new Date(s.at).toLocaleString() : s.pending ? "in progress" : "-"}</span>
        </li>
      ))}
    </ol>
  );
}

function Section({ title, children }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6">
      <h2 className="font-medium text-slate-900 mb-3">{title}</h2>
      {children}
    </div>
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
      <span className="block text-xs font-medium text-slate-700 mb-1">{label}</span>
      <input type={type} min={type === "number" ? 0 : undefined} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between border-b border-slate-100 pb-2 last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-900">{value}</span>
    </div>
  );
}
