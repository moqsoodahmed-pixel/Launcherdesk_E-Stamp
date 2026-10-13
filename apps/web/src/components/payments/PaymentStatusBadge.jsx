import StatusChip from "../ui/StatusChip";

// Renders the backend PaymentStatus values (CREATED, SUCCESS, FAILED,
// REFUNDED). Kept separate from StatusBadge because CREATED means "awaiting
// payment" here but "item created" in the bulk vocabulary.
export default function PaymentStatusBadge({ status }) {
  return <StatusChip status={status} kind="payment" />;
}
