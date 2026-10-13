// Vertical timeline. steps: [{ label, when, state, suffix?, note? }]
// state: "done" | "current" | "upcoming" | "failed". `when` is preformatted
// text (a date, "in progress", "-"). Colour is always paired with the label.
const DOT = {
  done: "bg-emerald-500",
  current: "bg-brand-600",
  upcoming: "bg-slate-300",
  failed: "bg-vermilion-500",
};
const TEXT = {
  done: "text-slate-800",
  current: "font-medium text-brand-700",
  upcoming: "text-slate-600",
  failed: "font-medium text-vermilion-700",
};

export default function Timeline({ steps, label = "Timeline" }) {
  return (
    <ol className="text-sm" aria-label={label}>
      {steps.map((s, i) => (
        <li key={`${s.label}-${i}`} className="relative flex items-start justify-between gap-3 pb-4 pl-7 last:pb-0">
          {i < steps.length - 1 && <span className="absolute left-[9px] top-5 h-full w-px bg-slate-200" aria-hidden="true" />}
          <span className={`absolute left-0 top-0.5 flex h-[19px] w-[19px] items-center justify-center rounded-full ring-4 ring-white ${DOT[s.state] || DOT.done}`} aria-hidden="true">
            <span className="h-1.5 w-1.5 rounded-full bg-white" />
          </span>
          <span className="min-w-0">
            <span className={TEXT[s.state] || TEXT.done}>{s.label}</span>
            {s.suffix && <span className="text-slate-500">{s.suffix}</span>}
            {s.note && <span className="block break-words text-xs text-vermilion-700">{s.note}</span>}
          </span>
          <span className="shrink-0 text-right text-xs text-slate-500 tabular-nums">{s.when}</span>
        </li>
      ))}
    </ol>
  );
}
