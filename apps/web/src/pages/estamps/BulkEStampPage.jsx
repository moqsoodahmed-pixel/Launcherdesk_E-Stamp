import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiClient } from "../../api/client";
import { errorMessage, formatCurrency } from "../../utils/format";
import StatusBadge from "../../components/estamps/StatusBadge";
import EmptyState from "../../components/dashboard/EmptyState";
import { TableSkeleton } from "../../components/dashboard/LoadingSkeleton";

// Phase 23 - restructured into the LANDING/LIST page for Bulk E-Stamp
// (Phase 11's backend, Phase 21/22's shell + patterns). Upload/preview/
// confirm now live in BulkUploadWizard.jsx; a single batch's full detail
// lives in BulkBatchDetailPage.jsx (/estamps/bulk/:batchId). This page only
// lists batches - it never fabricates a status or count the backend hasn't
// returned, and reuses the exact GET /bulk-estamps?page&limit shape and the
// exact template-download link the single-page version used.
export default function BulkEStampPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback((pageNum) => {
    setLoading(true);
    setError(null);
    apiClient
      .get("/bulk-estamps", { params: { page: pageNum, limit } })
      .then((res) => {
        setItems(res.data.data.items);
        setTotal(res.data.data.total);
      })
      .catch((err) => setError(errorMessage(err, "Unable to load bulk batches.")))
      .finally(() => setLoading(false));
  }, [limit]);

  useEffect(() => {
    load(page);
  }, [load, page]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Bulk E-Stamp Requests</h1>
          <p className="text-sm text-slate-500 mt-1">Upload a CSV/XLSX to create many E-Stamp requests at once.</p>
        </div>
        <div className="flex items-center gap-3">
          <a href={`${apiClient.defaults.baseURL}/bulk-estamps/template`} className="text-sm text-brand-600 hover:underline">
            Download CSV template
          </a>
          <button
            type="button"
            onClick={() => navigate("/estamps/bulk/new")}
            className="bg-brand-600 hover:bg-brand-700 text-white rounded-lg px-4 py-2 text-sm font-medium"
          >
            Create Bulk Request
          </button>
        </div>
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>}

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 text-sm font-medium text-slate-700">Batches</div>
        {loading ? (
          <div className="p-4">
            <TableSkeleton rows={5} />
          </div>
        ) : items.length === 0 ? (
          <EmptyState text="No bulk batches yet. Create one to get started." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                  <tr>
                    <th className="text-left px-4 py-2">Batch #</th>
                    <th className="text-left px-4 py-2">Status</th>
                    <th className="text-left px-4 py-2">Total Rows</th>
                    <th className="text-left px-4 py-2">Valid</th>
                    <th className="text-left px-4 py-2">Invalid</th>
                    <th className="text-left px-4 py-2">Amount</th>
                    <th className="text-left px-4 py-2">Created</th>
                    <th className="text-left px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((b) => (
                    <tr key={b._id} className="border-t border-slate-100">
                      <td className="px-4 py-2 font-medium text-slate-900">{b.batchNumber}</td>
                      <td className="px-4 py-2">
                        <StatusBadge status={b.status} />
                      </td>
                      <td className="px-4 py-2">{b.totalRows}</td>
                      <td className="px-4 py-2">{b.validRows}</td>
                      <td className="px-4 py-2">{b.invalidRows}</td>
                      <td className="px-4 py-2">{formatCurrency(b.totalStampDuty)}</td>
                      <td className="px-4 py-2 text-slate-500">{new Date(b.createdAt).toLocaleString()}</td>
                      <td className="px-4 py-2">
                        <Link to={`/estamps/bulk/${b._id}`} className="text-brand-600 hover:underline">
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 text-sm text-slate-500 border-t border-slate-100">
                <span>
                  Page {page} of {totalPages} ({total} batch{total === 1 ? "" : "es"})
                </span>
                <div className="space-x-2">
                  <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="px-3 py-1 rounded-lg border border-slate-300 disabled:opacity-40">
                    Previous
                  </button>
                  <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="px-3 py-1 rounded-lg border border-slate-300 disabled:opacity-40">
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
