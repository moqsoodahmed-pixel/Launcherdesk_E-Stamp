// Detail-page building blocks: a titled hairline card and label/value rows.

export function SectionCard({ title, action, icon: IconCmp, children, className = "", id }) {
  return (
    <section className={`card p-5 sm:p-6 ${className}`} aria-labelledby={id}>
      {(title || action) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 id={id} className="flex items-center gap-2 font-display text-base font-semibold text-slate-900">
            {IconCmp && <IconCmp size={18} strokeWidth={1.75} className="text-slate-500" aria-hidden="true" />}
            {title}
          </h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

// Stacked on narrow screens, label left / value right from sm up.
export function DetailRow({ label, value, mono = false }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-slate-100 py-2.5 text-sm first:pt-0 last:border-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <span className="shrink-0 text-slate-600">{label}</span>
      <span className={`min-w-0 break-words font-medium text-slate-900 sm:text-right ${mono ? "font-mono text-[13px]" : ""}`}>{value}</span>
    </div>
  );
}

export function DetailList({ children, className = "" }) {
  return <div className={className}>{children}</div>;
}
