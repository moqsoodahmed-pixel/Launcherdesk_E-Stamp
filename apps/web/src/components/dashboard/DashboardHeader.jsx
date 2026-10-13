// Greeting + subtitle on the left, the role's primary actions on the right.
export default function DashboardHeader({ name, subtitle, actions, children }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-semibold text-slate-900 sm:text-[28px]">Welcome back, {name}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-600">{subtitle}</p>}
      </div>
      {(actions || children) && (
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          {children}
        </div>
      )}
    </div>
  );
}

// Requests currently inside their 20-minute window, from the summary's
// byStatus breakdown (an array of { status, count }, or a status->count map).
export function inWindowCount(summary) {
  const by = summary?.requests?.byStatus;
  if (Array.isArray(by)) return by.find((r) => r.status === "MODIFICATION_WINDOW")?.count ?? 0;
  return by?.MODIFICATION_WINDOW ?? 0;
}
