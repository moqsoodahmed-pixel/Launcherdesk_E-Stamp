// Phase 21 - shared KPI tile used by every role dashboard. `trend` is
// rendered ONLY when the caller passes a real comparison value it computed
// from actual backend data - this component never fabricates one itself.
export default function KpiCard({ label, value, hint, trend }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <div className="flex items-baseline gap-2 mt-1">
        <p className="text-xl font-semibold text-slate-900">{value ?? 0}</p>
        {trend != null && (
          <span className={`text-xs font-medium ${trend >= 0 ? "text-emerald-600" : "text-red-600"}`}>
            {trend >= 0 ? "▲" : "▼"} {Math.abs(trend).toFixed(1)}%
          </span>
        )}
      </div>
      {hint && <p className="text-[11px] text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}
