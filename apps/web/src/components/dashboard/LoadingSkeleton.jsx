// Phase 21 - a lightweight pulse skeleton so a slow widget shows a shape
// immediately instead of a blank flash before its data (or error) arrives.
export function KpiSkeleton({ count = 4 }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-white rounded-2xl border border-slate-200 p-4 animate-pulse">
          <div className="h-3 w-16 bg-slate-100 rounded mb-3" />
          <div className="h-5 w-10 bg-slate-200 rounded" />
        </div>
      ))}
    </div>
  );
}

export function ChartSkeleton({ height = 220 }) {
  return <div className="bg-slate-100 rounded-xl animate-pulse" style={{ height }} />;
}

export function TableSkeleton({ rows = 4 }) {
  return (
    <div className="space-y-2 animate-pulse">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-9 bg-slate-100 rounded-lg" />
      ))}
    </div>
  );
}
