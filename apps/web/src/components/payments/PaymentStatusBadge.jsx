// Renders the backend PaymentStatus values exactly (CREATED, SUCCESS, FAILED,
// REFUNDED). Kept separate from StatusBadge because CREATED means "awaiting
// payment" here but "item created" in the bulk vocabulary.
const STYLES = {
  CREATED: "bg-amber-100 text-amber-700",
  SUCCESS: "bg-green-100 text-green-700",
  FAILED: "bg-red-100 text-red-700",
  REFUNDED: "bg-slate-200 text-slate-700",
};

export default function PaymentStatusBadge({ status }) {
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLES[status] || "bg-slate-100 text-slate-600"}`}>{String(status || "")}</span>;
}
