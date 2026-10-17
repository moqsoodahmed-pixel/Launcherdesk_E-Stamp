// Phase 21 - shared KPI tile used by every role dashboard. `trend` is
// rendered ONLY when the caller passes a real comparison value it computed
// from actual backend data - this component never fabricates one itself.
export default function KpiCard({ label, value, hint, trend }) {
  return (
    <div className="liquid-glass liquid-glass-hover rounded-[2rem] p-6">
      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-black/35">{label}</p>
      <div className="flex items-end justify-between gap-2 mt-4">
        <p className="text-3xl font-extrabold tracking-tight text-[#1d1d1f]">{value ?? 0}</p>
        {trend != null && (
          <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border border-white/60 ${trend >= 0 ? "bg-green-400/20 text-emerald-600" : "bg-red-400/20 text-red-600"}`}>
            {trend >= 0 ? "▲" : "▼"} {Math.abs(trend).toFixed(1)}%
          </span>
        )}
      </div>
      {hint && <p className="text-[11px] font-medium text-black/40 mt-2">{hint}</p>}
    </div>
  );
}
