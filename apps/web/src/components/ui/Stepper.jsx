import { Check } from "lucide-react";

// steps: array of labels; current: zero-based index of the active step.
export default function Stepper({ steps, current = 0, className = "", label = "Progress" }) {
  return (
    <ol aria-label={label} className={`flex w-full items-center gap-2 ${className}`}>
      {steps.map((stepLabel, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={stepLabel} aria-current={active ? "step" : undefined} className="flex min-w-0 flex-1 items-center gap-2 last:flex-none">
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums ${
                done ? "bg-brand-600 text-white" : active ? "bg-white text-brand-700 ring-2 ring-brand-600" : "bg-slate-100 text-slate-500"
              }`}
              aria-hidden="true"
            >
              {done ? <Check size={14} /> : i + 1}
            </span>
            <span className={`truncate text-sm ${active ? "font-medium text-slate-900" : "hidden text-slate-500 sm:inline"}`}>
              <span className="sr-only">{`Step ${i + 1}${done ? ", done" : ""}: `}</span>
              {stepLabel}
            </span>
            {i < steps.length - 1 && <span className={`h-px min-w-[12px] flex-1 ${done ? "bg-brand-600" : "bg-slate-200"}`} aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}
