// Phase 21 - reuses the EXACT same preset vocabulary report.service.js's
// resolveDateRange already validates (today/yesterday/last7days/
// last30days/currentMonth/previousMonth) rather than inventing a
// different set of dashboard-only options. Applied only where it
// meaningfully matters (a trend chart), not force-fit onto every widget.
export const TREND_PRESETS = [
  { value: "last7days", label: "7 days" },
  { value: "last30days", label: "30 days" },
  { value: "previousMonth", label: "Last month" },
];

export default function DateRangeFilter({ value, onChange, options = TREND_PRESETS }) {
  return (
    <div className="flex gap-1" role="group" aria-label="Date range">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`text-xs px-2.5 py-1 rounded-full border ${
            value === opt.value ? "bg-brand-600 text-white border-brand-600" : "border-slate-200 text-slate-500 hover:bg-slate-50"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
