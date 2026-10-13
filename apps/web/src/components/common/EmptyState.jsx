import { Inbox } from "lucide-react";

export default function EmptyState({ title = "Nothing here yet.", description, action, icon: IconCmp = Inbox }) {
  return (
    <div className="flex flex-col items-center px-4 py-10 text-center">
      <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-500">
        <IconCmp size={20} strokeWidth={1.75} aria-hidden="true" />
      </span>
      <p className="text-sm font-medium text-slate-800">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
