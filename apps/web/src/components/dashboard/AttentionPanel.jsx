// Phase 21 - "Attention Required" panel. Every alert passed in must be
// derived from a REAL, already-queried operational signal (failed orders,
// low provider balance, failed payments, inactive organizations, etc.) -
// this component never invents one. When `alerts` is genuinely empty, it
// shows an honest all-clear message rather than fabricating a warning to
// look busy.
export default function AttentionPanel({ alerts, loading }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6">
      <h2 className="text-sm font-semibold text-slate-900 mb-3">Attention Required</h2>
      {loading && <p className="text-sm text-slate-400">Checking...</p>}
      {!loading && (!alerts || alerts.length === 0) && (
        <p className="text-sm text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">Everything is operating normally.</p>
      )}
      {!loading && alerts && alerts.length > 0 && (
        <ul className="space-y-2">
          {alerts.map((a, i) => (
            <li key={i} className={`text-sm rounded-lg px-3 py-2 ${a.level === "critical" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>
              {a.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
