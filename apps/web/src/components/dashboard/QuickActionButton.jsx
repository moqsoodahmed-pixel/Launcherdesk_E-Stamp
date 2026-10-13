import { Link } from "react-router-dom";

// A single visual style for every dashboard's quick actions. Purely a styled
// Link - each role dashboard decides which actions that role can perform.
// `icon` is a lucide component. `primary` renders the filled variant.
export default function QuickActionButton({ to, label, icon: IconCmp, primary = false }) {
  return (
    <Link
      to={to}
      className={`inline-flex min-h-[44px] items-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors sm:min-h-[40px] ${
        primary ? "bg-brand-600 text-white hover:bg-brand-700" : "border border-slate-300 bg-white text-slate-800 hover:border-slate-400 hover:bg-slate-50"
      }`}
    >
      {IconCmp && typeof IconCmp !== "string" && <IconCmp size={16} aria-hidden="true" />}
      {label}
    </Link>
  );
}
