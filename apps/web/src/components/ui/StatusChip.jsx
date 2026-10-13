import { useAuth } from "../../context/AuthContext";
import { DOT, TONES, isClientRole, statusMeta } from "./status";
import { useWindowCountdown, formatCountdown } from "./WindowCountdown";

export { statusMeta, isClientRole } from "./status";

// The viewer's role, or null outside an AuthProvider (e.g. isolated tests).
export function useViewerRole() {
  try {
    return useAuth()?.user?.role ?? null;
  } catch {
    return null;
  }
}

function Chip({ tone, children, className = "" }) {
  return (
    <span className={`inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone] || TONES.grey} ${className}`}>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[tone] || DOT.grey}`} aria-hidden="true" />
      {children}
    </span>
  );
}

// Live "14:32 left to edit" chip; once the window reaches zero a client sees
// "Being prepared".
function WindowChip({ seconds, deadline, fallback, client }) {
  const [left] = useWindowCountdown(seconds, deadline);
  if (left === null) return <Chip tone={fallback.tone}>{fallback.label}</Chip>;
  if (left <= 0) return client ? <Chip tone="violet">Being prepared</Chip> : <Chip tone={fallback.tone}>{fallback.label}</Chip>;
  return (
    <Chip tone="blue">
      <span className="tabular-nums">{`${formatCountdown(left)} left to edit`}</span>
    </Chip>
  );
}

// kind: "request" (requests, orders, bulk items), "batch", "payment",
// "balance", "account" or "vendor". `audience` overrides the viewer's role
// ("client" | "staff"). For MODIFICATION_WINDOW pass `remainingSeconds`
// (server-provided, preferred) or `deadline` to get the live countdown.
export default function StatusChip({ status, kind = "request", audience, label, remainingSeconds, deadline, className }) {
  const role = useViewerRole();
  const client = audience ? audience === "client" : isClientRole(role);
  const meta = statusMeta(status, { kind, client });
  if (kind === "request" && status === "MODIFICATION_WINDOW" && (typeof remainingSeconds === "number" || deadline)) {
    return <WindowChip seconds={remainingSeconds} deadline={deadline} fallback={meta} client={client} />;
  }
  return (
    <Chip tone={meta.tone} className={className}>
      {label || meta.label}
    </Chip>
  );
}
