import { useState } from "react";
import { apiClient } from "../../api/client";
import { actionErrorMessage, formatCurrency } from "../../utils/format";

const inputClass = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500";

function CopyRow({ label, value }) {
  const [copied, setCopied] = useState(false);
  const text = value == null || value === "" ? "" : String(value);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 py-2 last:border-0">
      <div className="min-w-0">
        <p className="text-xs text-slate-500">{label}</p>
        <p className="text-sm text-slate-900 break-words">{text || "-"}</p>
      </div>
      {text && (
        <button type="button" onClick={copy} aria-label={`Copy ${label}`} className="shrink-0 rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">
          {copied ? "Copied" : "Copy"}
        </button>
      )}
    </div>
  );
}

function ConfirmBox({ text, onConfirm, onCancel, busy, confirmLabel = "Confirm", danger }) {
  return (
    <div role="alertdialog" aria-label="Confirm action" className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
      <p className="text-slate-700 mb-2">{text}</p>
      <div className="flex gap-2">
        <button type="button" onClick={onConfirm} disabled={busy} className={`rounded-lg px-3 py-1.5 text-sm text-white disabled:opacity-50 ${danger ? "bg-red-600 hover:bg-red-700" : "bg-slate-900"}`}>
          {busy ? "Working..." : confirmLabel}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm">
          Cancel
        </button>
      </div>
    </div>
  );
}

// Manual fulfilment panel (ESTAMP_FULFILMENT=manual) for the assigned
// assistant / Master Admin. Which actions show is decided by the server
// (availableActions.start/fulfil/fail); every action is re-checked there.
export default function FulfilmentPanel({ order, request, articleTitle, actions, onDone }) {
  const [confirming, setConfirming] = useState(null); // "start" | "fulfil" | "fail"
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [file, setFile] = useState(null);
  const [stampReference, setStampReference] = useState("");
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");
  const [refundBalance, setRefundBalance] = useState(false);

  async function run(kind) {
    setBusy(true);
    setError(null);
    try {
      if (kind === "start") {
        await apiClient.post(`/orders/${order._id}/start`);
        onDone("Work started. The order is now in progress.");
      } else if (kind === "fulfil") {
        const form = new FormData();
        form.append("file", file);
        form.append("stampReference", stampReference.trim());
        if (notes.trim()) form.append("notes", notes.trim());
        await apiClient.post(`/orders/${order._id}/fulfil`, form);
        onDone("Certificate uploaded and order marked issued. The client has been notified.");
      } else {
        const { data } = await apiClient.post(`/orders/${order._id}/fail`, { reason: reason.trim(), refundBalance });
        onDone(data?.data?.refund ? `Order marked failed and ${formatCurrency(data.data.refund.amount)} returned to the client's balance.` : "Order marked failed. No charge was reversed.");
      }
      setConfirming(null);
    } catch (err) {
      setError(actionErrorMessage(err, "The action failed. Nothing was changed."));
    } finally {
      setBusy(false);
    }
  }

  const refOk = stampReference.trim().length >= 3 && stampReference.trim().length <= 100;
  const reasonOk = reason.trim().length >= 5 && reason.trim().length <= 500;

  return (
    <section aria-label="Fulfilment" className="bg-white rounded-2xl border border-brand-200 p-6 space-y-5">
      <div>
        <h2 className="font-medium text-slate-900">Fulfilment</h2>
        <p className="text-xs text-slate-500">Stamp this request outside the app using the details below, then upload the certificate.</p>
      </div>

      {error && (
        <div role="alert" className="rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">
          {error}
        </div>
      )}

      <div className="rounded-lg border border-slate-200 px-4">
        <CopyRow label="First party" value={request?.firstParty} />
        <CopyRow label="Second party" value={request?.secondParty} />
        <CopyRow label="State" value={request?.stateCode} />
        <CopyRow label="Article" value={articleTitle || request?.articleId} />
        <CopyRow label="Consideration price" value={request?.considerationPrice} />
        <CopyRow label="Stamp duty" value={request?.calculatedStampDuty} />
        <CopyRow label="Stamp duty paid by" value={request?.stampDutyPaidBy} />
        <CopyRow label="No. of E-Stamps" value={request?.numberOfEStamps} />
        <CopyRow label="Description" value={request?.descriptionOfDocument} />
      </div>

      {actions.start && (
        <div>
          <button type="button" disabled={busy || !!confirming} onClick={() => setConfirming("start")} className="rounded-lg bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 text-sm font-medium disabled:opacity-50">
            Start work
          </button>
          {confirming === "start" && (
            <ConfirmBox text="Mark this order as in progress? The client will see it is being prepared." busy={busy} onConfirm={() => run("start")} onCancel={() => setConfirming(null)} />
          )}
        </div>
      )}

      {actions.fulfil && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setConfirming("fulfil");
          }}
          className="space-y-3 border-t border-slate-100 pt-4"
        >
          <h3 className="text-sm font-medium text-slate-900">Upload certificate and mark issued</h3>
          <div>
            <label htmlFor="fulfil-file" className="block text-sm font-medium text-slate-700 mb-1">
              Certificate file (PDF, PNG or JPEG)
            </label>
            <input id="fulfil-file" type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => setFile(e.target.files?.[0] || null)} disabled={busy} className="block text-sm" />
          </div>
          <div>
            <label htmlFor="fulfil-ref" className="block text-sm font-medium text-slate-700 mb-1">
              Stamp reference
            </label>
            <input id="fulfil-ref" value={stampReference} onChange={(e) => setStampReference(e.target.value)} maxLength={100} disabled={busy} className={inputClass} />
            <p className="text-xs text-slate-500 mt-1">The certificate / stamp number, 3 to 100 characters.</p>
          </div>
          <div>
            <label htmlFor="fulfil-notes" className="block text-sm font-medium text-slate-700 mb-1">
              Notes (optional, internal)
            </label>
            <textarea id="fulfil-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} disabled={busy} className={inputClass} />
          </div>
          <button type="submit" disabled={busy || !!confirming || !file || !refOk} className="rounded-lg bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 text-sm font-medium disabled:opacity-50">
            Upload certificate and mark issued
          </button>
          {confirming === "fulfil" && (
            <ConfirmBox
              text={`Upload "${file?.name}" as the certificate and mark this order issued with stamp reference ${stampReference.trim()}? The client is notified and can download it.`}
              busy={busy}
              confirmLabel="Upload and issue"
              onConfirm={() => run("fulfil")}
              onCancel={() => setConfirming(null)}
            />
          )}
        </form>
      )}

      {actions.fail && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setConfirming("fail");
          }}
          className="space-y-3 border-t border-slate-100 pt-4"
        >
          <h3 className="text-sm font-medium text-slate-900">Mark failed</h3>
          <div>
            <label htmlFor="fail-reason" className="block text-sm font-medium text-slate-700 mb-1">
              Reason (shown to the client)
            </label>
            <textarea id="fail-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} disabled={busy} className={inputClass} />
          </div>
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={refundBalance} onChange={(e) => setRefundBalance(e.target.checked)} disabled={busy} className="mt-0.5 rounded border-slate-300" />
            <span>
              Also reverse the charge to the client&apos;s balance ({formatCurrency(request?.calculatedStampDuty)})
            </span>
          </label>
          <button type="submit" disabled={busy || !!confirming || !reasonOk} className="rounded-lg border border-red-300 text-red-700 px-4 py-2 text-sm font-medium hover:bg-red-50 disabled:opacity-50">
            Mark failed
          </button>
          {confirming === "fail" && (
            <ConfirmBox
              danger
              text={
                refundBalance
                  ? `Mark this order failed AND return ${formatCurrency(request?.calculatedStampDuty)} to the client's balance? This cannot be undone.`
                  : "Mark this order failed WITHOUT reversing the charge? The client keeps being charged. This cannot be undone."
              }
              busy={busy}
              confirmLabel="Mark failed"
              onConfirm={() => run("fail")}
              onCancel={() => setConfirming(null)}
            />
          )}
        </form>
      )}
    </section>
  );
}
