import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from "lucide-react";

const TONE = {
  success: { cls: "border-emerald-200 bg-emerald-50 text-emerald-800", Icon: CheckCircle2 },
  error: { cls: "border-vermilion-200 bg-vermilion-50 text-vermilion-800", Icon: AlertCircle },
  info: { cls: "border-brand-200 bg-brand-50 text-brand-800", Icon: Info },
  warning: { cls: "border-marigold-200 bg-marigold-50 text-marigold-800", Icon: AlertTriangle },
};

// Inline notice or floating toast. role="alert" for errors, "status"
// otherwise.
export default function Toast({ tone = "info", children, onClose, className = "", floating = false }) {
  const t = TONE[tone] || TONE.info;
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${t.cls} ${floating ? "shadow-overlay" : ""} ${className}`}>
      <t.Icon size={18} className="mt-px shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">{children}</div>
      {onClose && (
        <button type="button" onClick={onClose} className="-m-1 rounded p-1 opacity-70 hover:opacity-100" aria-label="Dismiss">
          <X size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
