export default function EmptyState({ title = "Nothing here yet.", description, action }) {
  return (
    <div className="py-10 text-center">
      <p className="text-sm font-medium text-slate-600">{title}</p>
      {description && <p className="text-sm text-slate-400 mt-1">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
