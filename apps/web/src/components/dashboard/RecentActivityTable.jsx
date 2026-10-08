import { Link } from "react-router-dom";
import EmptyState from "./EmptyState";
import { TableSkeleton } from "./LoadingSkeleton";

// Phase 21 - generic-enough recent-activity table for requests/orders/audit
// lists: `columns` is [{key, label, render?}], `rowLinkPrefix` (optional)
// makes each row a link to `${rowLinkPrefix}/${row._id}`. Deliberately
// dumb/presentational - every dashboard supplies its own real, already-
// tenant-scoped rows fetched from an existing (or the new bounded
// recent-activity) report endpoint; this component fabricates nothing.
export default function RecentActivityTable({ title, columns, rows, loading, error, emptyText = "Nothing here yet.", rowLinkPrefix }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      </div>
      <div className="p-4">
        {loading && <TableSkeleton />}
        {!loading && error && <div className="text-sm text-red-600 py-4 text-center">{error}</div>}
        {!loading && !error && (!rows || rows.length === 0) && <EmptyState text={emptyText} />}
        {!loading && !error && rows && rows.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-slate-500 text-xs uppercase">
              <tr>
                {columns.map((c) => (
                  <th key={c.key} className="text-left px-2 py-2">
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
                        <td key={c.key} className="px-2 py-2.5">
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
                  <tr key={row._id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td colSpan={columns.length} className="p-0">
                      <Link to={`${rowLinkPrefix}/${row._id}`} className="grid w-full" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}>
                        {columns.map((c) => (
                          <div key={c.key} className="px-2 py-2.5">
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
        )}
      </div>
    </div>
  );
}
