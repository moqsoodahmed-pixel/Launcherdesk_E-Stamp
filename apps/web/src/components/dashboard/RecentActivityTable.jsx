import { Link } from "react-router-dom";
import EmptyState from "./EmptyState";
import { TableSkeleton } from "./LoadingSkeleton";

// Phase 21 - generic-enough recent-activity table for requests/orders/audit
// lists: `columns` is [{key, label, render?}], `rowLinkPrefix` (optional)
// makes each row a link to `${rowLinkPrefix}/${row._id}`. Deliberately
// dumb/presentational - every dashboard supplies its own real, already-
// tenant-scoped rows fetched from an existing (or the new bounded
// recent-activity) report endpoint; this component fabricates nothing.
export default function RecentActivityTable({ title, columns, rows, loading, error, onRetry, emptyText = "Nothing here yet.", rowLinkPrefix, action }) {
  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-5 py-4 sm:px-6">
        <h2 className="font-display text-base font-semibold text-slate-900">{title}</h2>
        {action}
      </div>
      <div className={rows && rows.length > 0 && !loading && !error ? "" : "p-4"}>
        {loading && <TableSkeleton />}
        {!loading && error && (
          <div role="alert" className="py-4 text-center text-sm text-vermilion-700">
            {error}
            {onRetry && (
              <button type="button" onClick={onRetry} className="ml-2 min-h-[36px] font-medium underline">
                Retry
              </button>
            )}
          </div>
        )}
        {!loading && !error && (!rows || rows.length === 0) && <EmptyState text={emptyText} />}
        {!loading && !error && rows && rows.length > 0 && (
          <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <thead className="bg-slate-50 text-xs text-slate-600">
              <tr>
                {columns.map((c) => (
                  <th key={c.key} scope="col" className="px-4 py-2.5 text-left font-semibold">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                if (!rowLinkPrefix) {
                  return (
                    <tr key={row._id} className="border-t border-slate-100">
                      {columns.map((c) => (
                        <td key={c.key} className="px-4 py-3 text-slate-700">
                          {c.render ? c.render(row) : (row[c.key] ?? "-")}
                        </td>
                      ))}
                    </tr>
                  );
                }
                // A single `<Link>` (renders as `<a>`) cannot legally contain
                // `<td>` children per the HTML table content model - use plain
                // `<div>` grid cells inside the link instead, with ONE real
                // `<td colSpan>` as the only actual table cell in this row.
                return (
                  <tr key={row._id} className="border-t border-slate-100 transition-colors hover:bg-brand-50/40">
                    <td colSpan={columns.length} className="p-0">
                      <Link to={`${rowLinkPrefix}/${row._id}`} className="grid min-h-[44px] w-full items-center" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}>
                        {columns.map((c) => (
                          <div key={c.key} className="min-w-0 px-4 py-3 text-slate-700">
                            {c.render ? c.render(row) : (row[c.key] ?? "-")}
                          </div>
                        ))}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </section>
  );
}
