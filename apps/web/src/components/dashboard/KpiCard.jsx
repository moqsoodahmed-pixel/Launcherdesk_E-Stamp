import { TrendingUp, TrendingDown } from "lucide-react";
import { TILE_TONES } from "../ui/StatTile";

// Shared KPI tile used by every role dashboard. `trend` is rendered ONLY when
// the caller passes a real comparison value it computed from actual backend
// data - this component never fabricates one itself. Optional `icon` (lucide)
// and `tone` give it the coloured icon tile of StatTile.
export default function KpiCard({ label, value, hint, trend, icon: IconCmp, tone = "blue" }) {
  return (
    <div className="card flex items-start gap-3 p-4">
      {IconCmp && (
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${TILE_TONES[tone] || TILE_TONES.blue}`}>
          <IconCmp size={20} strokeWidth={1.75} aria-hidden="true" />
        </span>
      )}
      <div className="min-w-0">
        <p className="text-sm text-slate-600">{label}</p>
        <div className="mt-0.5 flex items-baseline gap-2">
          <p className="font-display text-2xl font-semibold text-slate-900 tabular-nums">{value ?? 0}</p>
          {trend != null && (
            <span className={`inline-flex items-center gap-0.5 text-xs font-medium tabular-nums ${trend >= 0 ? "text-emerald-700" : "text-vermilion-700"}`}>
              {trend >= 0 ? <TrendingUp size={14} aria-hidden="true" /> : <TrendingDown size={14} aria-hidden="true" />}
              {Math.abs(trend).toFixed(1)}%
            </span>
          )}
        </div>
        {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      </div>
    </div>
  );
}
