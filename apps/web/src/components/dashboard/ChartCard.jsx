import EmptyState from "./EmptyState";
import { ChartSkeleton } from "./LoadingSkeleton";

// A self-contained chart/section wrapper with its own loading/empty/error
// states, so one failed widget's fetch never takes down the rest of the
// dashboard.
export default function ChartCard({ title, action, loading, error, onRetry, empty, emptyText, height = 220, children }) {
  return (
    <section className="card p-5 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-base font-semibold text-slate-900">{title}</h2>
        {action}
      </div>
      {loading && <ChartSkeleton height={height} />}
      {!loading && error && (
        <div role="alert" className="py-6 text-center text-sm text-vermilion-700">
          {error}
          {onRetry && (
            <button type="button" onClick={onRetry} className="ml-2 min-h-[36px] font-medium underline">
              Retry
            </button>
          )}
        </div>
      )}
      {!loading && !error && empty && <EmptyState text={emptyText} />}
      {!loading && !error && !empty && children}
    </section>
  );
}
