// Phase 22 - a single, shared status-badge renderer for the canonical
// EStampRequestStatus enum (DRAFT, PAYMENT_PENDING, PAYMENT_SUCCESS,
// REQUEST_CREATED, MODIFICATION_WINDOW, LOCKED, PROCESSING, COMPLETED,
// DOWNLOAD_AVAILABLE, CANCELLED, FAILED) - exactly the values the backend
// returns, never invented ones. Color is always paired with the plain-text
// label (never color alone) for accessibility.
//
// Phase 23 - extended (not duplicated) to also cover BulkBatchStatus
// (UPLOADED, VALIDATING, PREVIEW_READY, CONFIRMED, PARTIALLY_FAILED) and
// BulkEStampBatchItem.status (PENDING, VALID, INVALID, CREATED) - the two
// vocabularies don't collide on any key (PROCESSING/COMPLETED/CANCELLED/
// FAILED are shared and already mean the same thing in both), so one
// shared component covers both rather than maintaining two badge
// implementations.
//
// Phase 24 - extended again to cover EStampOrderProcessingStatus
// (CREATED, SUBMITTING, SUBMITTED, PROCESSING, ISSUED, FAILED) and
// OrderStatus (ONGOING, COMPLETED, CANCELLED, FAILED). CREATED/PROCESSING/
// COMPLETED/CANCELLED/FAILED are already shared keys meaning the same
// thing; only SUBMITTING, SUBMITTED, ISSUED and ONGOING are new.
const STYLES = {
  DRAFT: "bg-slate-100 text-slate-700 border border-slate-200",
  PAYMENT_PENDING: "bg-amber-100 text-amber-800 border border-amber-200",
  PAYMENT_SUCCESS: "bg-sky-100 text-sky-800 border border-sky-200",
  REQUEST_CREATED: "bg-sky-100 text-sky-800 border border-sky-200",
  MODIFICATION_WINDOW: "bg-amber-100 text-amber-800 border border-amber-200",
  LOCKED: "bg-slate-200 text-slate-800 border border-slate-300",
  PROCESSING: "bg-indigo-100 text-indigo-800 border border-indigo-200",
  COMPLETED: "bg-emerald-100 text-emerald-800 border border-emerald-200",
  DOWNLOAD_AVAILABLE: "bg-emerald-100 text-emerald-800 border border-emerald-200",
  CANCELLED: "bg-rose-100 text-rose-800 border border-rose-200",
  FAILED: "bg-rose-100 text-rose-800 border border-rose-200",
  // Bulk batch statuses
  UPLOADED: "bg-slate-100 text-slate-700 border border-slate-200",
  VALIDATING: "bg-indigo-100 text-indigo-800 border border-indigo-200",
  PREVIEW_READY: "bg-sky-100 text-sky-800 border border-sky-200",
  CONFIRMED: "bg-indigo-100 text-indigo-800 border border-indigo-200",
  PARTIALLY_FAILED: "bg-amber-100 text-amber-800 border border-amber-200",
  // Bulk batch item statuses
  PENDING: "bg-slate-100 text-slate-700 border border-slate-200",
  VALID: "bg-emerald-100 text-emerald-800 border border-emerald-200",
  INVALID: "bg-amber-100 text-amber-800 border border-amber-200",
  CREATED: "bg-emerald-100 text-emerald-800 border border-emerald-200",
  // Order processing / order statuses (EStampOrderProcessingStatus, OrderStatus)
  SUBMITTING: "bg-amber-100 text-amber-800 border border-amber-200",
  SUBMITTED: "bg-sky-100 text-sky-800 border border-sky-200",
  ISSUED: "bg-emerald-100 text-emerald-800 border border-emerald-200",
  ONGOING: "bg-indigo-100 text-indigo-800 border border-indigo-200",
};

export default function StatusBadge({ status }) {
  const style = STYLES[status] || "bg-slate-100 text-slate-600";
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${style}`}>
      {String(status || "").replace(/_/g, " ")}
    </span>
  );
}
