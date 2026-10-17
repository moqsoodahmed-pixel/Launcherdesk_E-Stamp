// Shared page title row: heading + optional subtitle on the left, actions
// (buttons/links) on the right. Wraps on narrow screens.
export default function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
      <div>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[#1d1d1f]">{title}</h1>
        {subtitle && <p className="text-sm font-medium text-black/50 mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
