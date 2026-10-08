import EmptyState from "./EmptyState";
import { ChartSkeleton } from "./LoadingSkeleton";

// Phase 21 - a self-contained chart/section wrapper with its own
// loading/empty/error states, so one failed widget's fetch never takes down
// the rest of the dashboard (each dashboard does independent try/catch per
// call, never one giant Promise.all that fails everything together).
export default function ChartCard({ title, action, loading, error, empty, emptyText, height = 220, children }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {action}
      </div>
      {loading && <ChartSkeleton height={height} />}
      {!loading && error && <div className="text-sm text-red-600 py-6 text-center">{error}</div>}
      {!loading && !error && empty && <EmptyState text={emptyText} />}
      {!loading && !error && !empty && children}
    </div>
  );
}
