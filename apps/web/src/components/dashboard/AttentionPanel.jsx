import { AlertTriangle, CheckCircle2, OctagonAlert } from "lucide-react";

// "Attention Required" panel. Every alert passed in must be derived from a
// REAL, already-queried operational signal - this component never invents
// one. When `alerts` is genuinely empty, it shows an honest all-clear.
export default function AttentionPanel({ alerts, loading }) {
  return (
    <section className="card p-5 sm:p-6">
      <h2 className="mb-3 font-display text-base font-semibold text-slate-900">Attention Required</h2>
      {loading && <p className="text-sm text-slate-500">Checking...</p>}
      {!loading && (!alerts || alerts.length === 0) && (
        <p className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
          <CheckCircle2 size={18} aria-hidden="true" />
          Everything is operating normally.
        </p>
      )}
      {!loading && alerts && alerts.length > 0 && (
        <ul className="space-y-2">
          {alerts.map((a, i) => {
            const critical = a.level === "critical";
            const IconCmp = critical ? OctagonAlert : AlertTriangle;
            return (
              <li key={i} className={`flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm ${critical ? "bg-vermilion-50 text-vermilion-800" : "bg-marigold-50 text-marigold-800"}`}>
                <IconCmp size={18} className="mt-px shrink-0" aria-hidden="true" />
                {a.text}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
