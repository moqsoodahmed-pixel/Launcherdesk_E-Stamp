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
  DRAFT: "bg-slate-100 text-slate-600",
  PAYMENT_PENDING: "bg-amber-100 text-amber-700",
  PAYMENT_SUCCESS: "bg-sky-100 text-sky-700",
  REQUEST_CREATED: "bg-sky-100 text-sky-700",
  MODIFICATION_WINDOW: "bg-amber-100 text-amber-700",
  LOCKED: "bg-slate-200 text-slate-700",
  PROCESSING: "bg-indigo-100 text-indigo-700",
  COMPLETED: "bg-green-100 text-green-700",
  DOWNLOAD_AVAILABLE: "bg-green-100 text-green-700",
  CANCELLED: "bg-red-100 text-red-700",
  FAILED: "bg-red-100 text-red-700",
  // Bulk batch statuses
  UPLOADED: "bg-slate-100 text-slate-600",
  VALIDATING: "bg-indigo-100 text-indigo-700",
  PREVIEW_READY: "bg-sky-100 text-sky-700",
  CONFIRMED: "bg-indigo-100 text-indigo-700",
  PARTIALLY_FAILED: "bg-amber-100 text-amber-700",
  // Bulk batch item statuses
  PENDING: "bg-slate-100 text-slate-600",
  VALID: "bg-green-100 text-green-700",
  INVALID: "bg-amber-100 text-amber-700",
  CREATED: "bg-green-100 text-green-700",
  // Order processing / order statuses (EStampOrderProcessingStatus, OrderStatus)
  SUBMITTING: "bg-amber-100 text-amber-700",
  SUBMITTED: "bg-sky-100 text-sky-700",
  ISSUED: "bg-green-100 text-green-700",
  ONGOING: "bg-indigo-100 text-indigo-700",
};

export default function StatusBadge({ status }) {
  const style = STYLES[status] || "bg-slate-100 text-slate-600";
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${style}`}>
      {String(status || "").replace(/_/g, " ")}
    </span>
  );
}
