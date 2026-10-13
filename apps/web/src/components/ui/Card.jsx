// Flat card with a hairline border. Optional title row with actions.
export default function Card({ title, subtitle, actions, children, className = "", padding = "p-5 sm:p-6", as: Tag = "section" }) {
  return (
    <Tag className={`card ${padding} ${className}`}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <h2 className="font-display text-base font-semibold text-slate-900">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </Tag>
  );
}
