import { Link } from "react-router-dom";

export const TILE_TONES = {
  blue: "bg-brand-50 text-brand-700",
  violet: "bg-violet-50 text-violet-700",
  emerald: "bg-emerald-50 text-emerald-700",
  vermilion: "bg-vermilion-50 text-vermilion-700",
  marigold: "bg-marigold-100 text-marigold-800",
  teal: "bg-teal-50 text-teal-700",
  magenta: "bg-magenta-50 text-magenta-700",
  grey: "bg-slate-100 text-slate-600",
};

// Coloured icon tile + large number + label. Colour carries meaning (see the
// style guide); the label always says it in words.
export default function StatTile({ icon: IconCmp, value, label, hint, tone = "blue", to, className = "" }) {
  const body = (
    <>
      {IconCmp && (
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${TILE_TONES[tone] || TILE_TONES.blue}`}>
          <IconCmp size={20} strokeWidth={1.75} aria-hidden="true" />
        </span>
      )}
      <div className="min-w-0">
        <p className="font-display text-2xl font-semibold leading-tight text-slate-900 tabular-nums">{value}</p>
        <p className="mt-0.5 text-sm text-slate-600">{label}</p>
        {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
      </div>
    </>
  );
  const cls = `card flex items-start gap-3 p-4 sm:p-5 ${className}`;
  return to ? (
    <Link to={to} className={`${cls} transition-colors hover:border-brand-300`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
