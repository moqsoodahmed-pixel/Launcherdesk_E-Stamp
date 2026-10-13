import { useRef } from "react";

// Accessible tabs: tabs=[{ id, label }], value, onChange(id). Arrow keys,
// Home and End move between tabs.
export default function Tabs({ tabs, value, onChange, label, className = "" }) {
  const refs = useRef([]);
  function onKeyDown(e, index) {
    let next = null;
    if (e.key === "ArrowRight") next = (index + 1) % tabs.length;
    if (e.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = tabs.length - 1;
    if (next === null) return;
    e.preventDefault();
    refs.current[next]?.focus();
    onChange(tabs[next].id);
  }
  return (
    <div role="tablist" aria-label={label} className={`flex gap-1 overflow-x-auto border-b border-slate-200 ${className}`}>
      {tabs.map((t, i) => {
        const selected = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => (refs.current[i] = el)}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`-mb-px min-h-[44px] whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors ${selected ? "border-brand-600 text-brand-700" : "border-transparent text-slate-600 hover:text-slate-900"}`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
