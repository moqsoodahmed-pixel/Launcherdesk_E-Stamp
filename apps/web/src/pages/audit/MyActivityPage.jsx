import { useEffect, useState, useCallback } from "react";
import { apiClient } from "../../api/client";
import { getErrorMessage } from "../../utils/errors";
import ErrorState from "../../components/common/ErrorState";

// Simpler than AuditLogsPage.jsx by design - hard-scoped server-side to the
// caller's own actorId, so there is nothing to filter by organization or
// permission here; available to any authenticated user.
export default function MyActivityPage() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    apiClient
      .get("/audit/mine", { params: { page, limit } })
      .then((r) => {
        setItems(r.data.data.items);
        setTotal(r.data.data.total);
      })
      .catch((err) => {
        setError(getErrorMessage(err, "Failed to load your activity."));
        setItems([]);
        setTotal(0);
      })
      .finally(() => setLoading(false));
  }, [page, limit]);

  useEffect(() => {
    load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900 mb-6">My Activity</h1>

      {error && (
        <div className="mb-4">
          <ErrorState message={error} onRetry={load} />
        </div>
      )}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-600">
            <tr>
              <th className="whitespace-nowrap px-4 py-2.5 text-left font-semibold">When</th>
              <th className="whitespace-nowrap px-4 py-2.5 text-left font-semibold">Action</th>
              <th className="whitespace-nowrap px-4 py-2.5 text-left font-semibold">Entity</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={3} className="px-4 py-10 text-center text-slate-500">
                  Loading...
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && !error && (
              <tr>
                <td colSpan={3} className="px-4 py-10 text-center text-slate-500">
                  No activity recorded yet.
                </td>
              </tr>
            )}
            {items.map((entry) => (
              <tr key={entry._id} className="border-t border-slate-100">
                <td className="px-4 py-3 text-slate-500">{new Date(entry.createdAt).toLocaleString()}</td>
                <td className="px-4 py-3 font-medium text-slate-900">{entry.action}</td>
                <td className="px-4 py-3 text-slate-500">
                  {entry.entityType || "-"}
                  {entry.entityId ? ` #${entry.entityId}` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm text-slate-500">
          <span>
            Page {page} of {totalPages} ({total} total)
          </span>
          <div className="space-x-2">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 text-slate-700 hover:bg-slate-50 disabled:opacity-40">
              Previous
            </button>
            <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 text-slate-700 hover:bg-slate-50 disabled:opacity-40">
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
