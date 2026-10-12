import { useRef, useState } from "react";
import { apiClient } from "../../api/client";
import { actionErrorMessage } from "../../utils/format";

// Vendor-stage labels. Staff and vendor screens only - client pages never
// render these (the API never sends vendor fields to a client role).
export const VENDOR_STATUS_LABELS = {
  NOT_SENT: "Not sent",
  SENT: "To do",
  ACCEPTED: "In progress",
  UPLOADED: "Awaiting review",
  REJECTED: "Needs re-upload",
  APPROVED: "Approved",
};
const BADGE_CLASSES = {
  NOT_SENT: "bg-slate-100 text-slate-600",
  SENT: "bg-blue-50 text-blue-700",
  ACCEPTED: "bg-indigo-50 text-indigo-700",
  UPLOADED: "bg-amber-50 text-amber-700",
  REJECTED: "bg-red-50 text-red-700",
  APPROVED: "bg-green-50 text-green-700",
};
// Statuses in which a vendor may (re-)upload a certificate.
export const UPLOADABLE = ["SENT", "ACCEPTED", "REJECTED", "UPLOADED"];
export const ACCEPTED_FILE_TYPES = "application/pdf,image/png,image/jpeg";

export function VendorStatusBadge({ status, label }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${BADGE_CLASSES[status] || BADGE_CLASSES.NOT_SENT}`}>{label || VENDOR_STATUS_LABELS[status] || status}</span>;
}

export function CopyButton({ value, label }) {
  const [copied, setCopied] = useState(false);
  const text = value == null ? "" : String(value);
  if (!text) return null;
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
    <button type="button" onClick={copy} aria-label={`Copy ${label}`} className="ml-1 rounded border border-slate-300 px-1.5 py-0.5 text-[11px] text-slate-500 hover:bg-slate-50">
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

// The API answers file requests with a short-lived signed URL; open it in a
// new tab (never stored, never put in the page).
export async function openSignedUrl(path) {
  const res = await apiClient.get(path);
  const url = res.data?.data?.url;
  if (url) window.open(url, "_blank", "noopener,noreferrer");
  return res.data?.data;
}

// Inline "Upload certificate": file + stamp reference, posted to
// /vendor/orders/:id/upload. Used on every queue row and on the detail page
// so a vendor can work through many orders one by one.
export function UploadCertificateForm({ order, onUploaded, compact = false }) {
  const [file, setFile] = useState(null);
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const fileRef = useRef(null);
  const refOk = reference.trim().length >= 3 && reference.trim().length <= 100;

  async function submit(e) {
    e.preventDefault();
    setError("");
    setDone("");
    if (!file) return setError("Choose the certificate file (PDF, PNG or JPG).");
    if (!refOk) return setError("Stamp reference must be 3 to 100 characters.");
    if (order.vendorStatus === "UPLOADED" && !window.confirm(`Replace the certificate already uploaded for ${order.orderNumber}?`)) return;
    const form = new FormData();
    form.append("file", file);
    form.append("stampReference", reference.trim());
    if (notes.trim()) form.append("notes", notes.trim());
    setBusy(true);
    try {
      const res = await apiClient.post(`/vendor/orders/${order._id}/upload`, form);
      setFile(null);
      setReference("");
      setNotes("");
      if (fileRef.current) fileRef.current.value = "";
      setDone("Uploaded for review.");
      onUploaded?.(res.data?.data);
    } catch (err) {
      setError(actionErrorMessage(err, "Upload failed. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className={compact ? "flex flex-wrap items-center gap-2" : "space-y-3"} aria-label={`Upload certificate for ${order.orderNumber}`}>
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPTED_FILE_TYPES}
        aria-label={`Certificate file for ${order.orderNumber}`}
        onChange={(e) => setFile(e.target.files?.[0] || null)}
        className="text-xs max-w-[14rem]"
      />
      <input
        type="text"
        value={reference}
        onChange={(e) => setReference(e.target.value)}
        placeholder="Stamp reference"
        aria-label={`Stamp reference for ${order.orderNumber}`}
        maxLength={100}
        className="rounded-lg border border-slate-300 px-2 py-1 text-xs w-40"
      />
      {!compact && (
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" aria-label="Notes" maxLength={1000} rows={2} className="w-full rounded-lg border border-slate-300 px-2 py-1 text-sm" />
      )}
      <button type="submit" disabled={busy} className="rounded-lg bg-brand-600 hover:bg-brand-700 text-white px-3 py-1 text-xs font-medium disabled:opacity-50">
        {busy ? "Uploading..." : order.vendorStatus === "UPLOADED" ? "Replace upload" : "Upload certificate"}
      </button>
      {error && <p role="alert" className="text-xs text-red-600 w-full">{error}</p>}
      {done && <p className="text-xs text-green-700 w-full">{done}</p>}
    </form>
  );
}
