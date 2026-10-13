import StatusChip from "../ui/StatusChip";

// Whether a successful payment has reached the organization's balance yet.
// A verified Razorpay payment waits (PENDING_CREDIT) until LauncherDesk
// confirms it. A SUCCESS payment with no balanceStatus predates that flow
// and was credited automatically, so it reads as Credited. Renders nothing
// for payments that never succeeded.
export function balanceStatusOf(payment) {
  if (!payment || payment.status !== "SUCCESS") return null;
  return payment.balanceStatus === "PENDING_CREDIT" ? "PENDING_CREDIT" : "CREDITED";
}

export default function BalanceStatusBadge({ payment }) {
  const state = balanceStatusOf(payment);
  if (!state) return null;
  return <StatusChip status={state} kind="balance" />;
}
