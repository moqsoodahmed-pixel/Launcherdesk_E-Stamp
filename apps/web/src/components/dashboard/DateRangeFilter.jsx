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
          aria-pressed={value === opt.value}
          className={`min-h-[32px] rounded-full border px-3 text-xs font-medium transition-colors ${
            value === opt.value ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 text-slate-600 hover:bg-slate-50"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
