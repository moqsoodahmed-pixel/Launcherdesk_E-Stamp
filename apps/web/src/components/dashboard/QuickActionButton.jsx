import { Link } from "react-router-dom";

// Phase 21 - a single visual style for every dashboard's "quick actions"
// row. Purely a styled Link - no logic of its own, so each role dashboard
// decides which actions that role can actually perform (never hardcoded
// here).
export default function QuickActionButton({ to, label, icon }) {
  return (
    <Link
      to={to}
      className="group liquid-glass liquid-glass-hover flex items-center gap-3 rounded-3xl px-5 py-4 text-sm font-bold text-[#1d1d1f] hover:text-[#0066FF]"
    >
      {icon && (
        <span aria-hidden="true" className="w-10 h-10 shrink-0 rounded-2xl bg-blue-400/15 border border-white/70 flex items-center justify-center text-lg">
          {icon}
        </span>
      )}
      {label}
    </Link>
  );
}
