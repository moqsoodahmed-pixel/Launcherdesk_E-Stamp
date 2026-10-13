import { BarChart3 } from "lucide-react";

// Honest empty state used everywhere a widget has zero data. Never rendered
// alongside a fabricated 0/N/A value - callers show EITHER this OR the real
// content, never both.
export default function EmptyState({ text = "Nothing here yet." }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      <BarChart3 size={22} strokeWidth={1.75} className="text-slate-400" aria-hidden="true" />
      <p className="text-sm text-slate-500">{text}</p>
    </div>
  );
}
