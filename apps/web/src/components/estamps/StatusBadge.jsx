import StatusChip from "../ui/StatusChip";

// Shared renderer for the request, order, order-processing and bulk status
// enums (exactly the values the backend returns). Delegates to StatusChip:
// client roles see plain-language labels ("Being prepared" for every
// internal stage), staff see the enum. See components/ui/status.js.
// Pass `remainingSeconds` (server-provided) or `deadline` for a live
// edit-window countdown on MODIFICATION_WINDOW.
export default function StatusBadge({ status, kind = "request", remainingSeconds, deadline, audience }) {
  return <StatusChip status={status} kind={kind} remainingSeconds={remainingSeconds} deadline={deadline} audience={audience} />;
}
