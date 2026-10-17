import EmptyState from "./EmptyState";
import { ChartSkeleton } from "./LoadingSkeleton";

// Phase 21 - a self-contained chart/section wrapper with its own
// loading/empty/error states, so one failed widget's fetch never takes down
// the rest of the dashboard (each dashboard does independent try/catch per
// call, never one giant Promise.all that fails everything together).
export default function ChartCard({ title, action, loading, error, onRetry, empty, emptyText, height = 220, children }) {
  return (
    <div className="liquid-glass rounded-[2.5rem] p-6 sm:p-8">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-lg font-extrabold tracking-tight text-[#1d1d1f]">{title}</h2>
        {action}
      </div>
      {loading && <ChartSkeleton height={height} />}
      {!loading && error && (
        <div role="alert" className="text-sm text-red-600 py-6 text-center">
          {error}
          {onRetry && (
            <button type="button" onClick={onRetry} className="ml-2 underline font-medium">
              Retry
            </button>
          )}
        </div>
      )}
      {!loading && !error && empty && <EmptyState text={emptyText} />}
      {!loading && !error && !empty && children}
    </div>
  );
}
