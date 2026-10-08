import { Link } from "react-router-dom";

// Phase 21 - a single visual style for every dashboard's "quick actions"
// row. Purely a styled Link - no logic of its own, so each role dashboard
// decides which actions that role can actually perform (never hardcoded
// here).
export default function QuickActionButton({ to, label, icon }) {
  return (
    <Link
      to={to}
      className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 transition-colors"
    >
      {icon && <span aria-hidden="true">{icon}</span>}
      {label}
    </Link>
  );
}
