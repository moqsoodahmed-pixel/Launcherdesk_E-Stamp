import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { apiClient } from "../../api/client";
import { errorMessage, formatCurrency } from "../../utils/format";
import StatusBadge from "../../components/estamps/StatusBadge";
import EmptyState from "../../components/dashboard/EmptyState";
import { TableSkeleton } from "../../components/dashboard/LoadingSkeleton";

// Phase 23 - dedicated batch detail page (/estamps/bulk/:batchId). Reached
// from the list page's "View" link, or from BulkUploadWizard right after a
// confirm. Preserves, unchanged, every real gate/behavior the old
// single-page version had: polling ONLY while PROCESSING, the exact
// canConfirm/canCancel derivation, the window.confirm() amount prompt, and
// the reload-on-rejected-confirm handling (a rejected confirm still updates
// the batch server-side, e.g. to FAILED on insufficient balance).
export default function BulkBatchDetailPage() {
  const { batchId } = useParams();
  const navigate = useNavigate();
  const [batch, setBatch] = useState(null);
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [itemsTotal, setItemsTotal] = useState(0);
  const [limit] = useState(25);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const pollRef = useRef(null);

  const loadBatch = useCallback(
    (pageNum = 1) => {
      return apiClient
        .get(`/bulk-estamps/${batchId}`, { params: { page: pageNum, limit } })
        .then((res) => {
          setBatch(res.data.data.batch);
          setItems(res.data.data.items);
          setItemsTotal(res.data.data.itemsTotal);
          return res.data.data.batch;
        });
    },
    [batchId, limit]
  );

  useEffect(() => {
    setLoading(true);
    setError(null);
    loadBatch(1)
      .catch((err) => setError(errorMessage(err, "Unable to load this batch.")))
      .finally(() => setLoading(false));
  }, [loadBatch]);

  // Poll only while PROCESSING - stops the moment a terminal status is
  // reported by the server, never a client-guessed progress bar. Resumes
  // correctly whenever this effect re-runs (e.g. navigating away and back
  // remounts the page and re-reads the real current status first).
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (batch && batch.status === "PROCESSING") {
      pollRef.current = setInterval(() => {
        loadBatch(page).catch(() => {});
      }, 3000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [batch, page, loadBatch]);

  async function handleConfirm() {
    if (!batch) return;
    if (!window.confirm(`Confirm this batch? ${formatCurrency(batch.totalStampDuty || 0)} will be charged to your wallet for ${batch.validRows} valid row(s).`)) {
      return;
    }
    setConfirming(true);
    setError(null);
    setNotice(null);
    try {
      const { data } = await apiClient.post(`/bulk-estamps/${batch._id}/confirm`);
      setBatch(data.data.batch);
      setItems(data.data.items || []);
      setNotice("Batch confirmed. Processing outcome shown below.");
    } catch (err) {
      // Even on a rejected confirm (e.g. insufficient balance, or an
      // already-processed batch rejected by the backend's atomic claim)
      // the batch was still updated/read server-side - reload and show its
      // real current state rather than silently retrying.
      setError(errorMessage(err, "Confirm failed."));
      await loadBatch(page).catch(() => {});
    } finally {
      setConfirming(false);
    }
  }

  async function handleCancel() {
    if (!batch) return;
    if (!window.confirm("Cancel this batch? Nothing has been charged yet.")) return;
    setError(null);
    try {
      const { data } = await apiClient.post(`/bulk-estamps/${batch._id}/cancel`);
      setBatch(data.data);
      setNotice("Batch cancelled.");
    } catch (err) {
      setError(errorMessage(err, "Cancel failed."));
    }
  }

  function changePage(next) {
    setPage(next);
    loadBatch(next);
  }

  if (loading) {
    return (
      <div className="max-w-5xl">
        <TableSkeleton rows={6} />
      </div>
    );
  }

  if (!batch) {
    return (
      <div className="max-w-5xl">
        {error && <div className="mb-4 rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>}
        <EmptyState text="This batch could not be found." />
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(itemsTotal / limit));
  const canConfirm = batch.status === "PREVIEW_READY" && batch.validRows > 0;
  const canCancel = ["UPLOADED", "VALIDATING", "PREVIEW_READY"].includes(batch.status);

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-4">
        <button type="button" onClick={() => navigate("/estamps/bulk")} className="text-sm text-slate-500 hover:underline">
          &larr; Back to Bulk Requests
        </button>
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>}
      {notice && <div className="mb-4 rounded-lg bg-green-50 text-green-700 text-sm px-3 py-2">{notice}</div>}

      <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <p className="text-sm text-slate-500">Batch</p>
            <p className="text-lg font-semibold text-slate-900">{batch.batchNumber}</p>
            {batch.fileName && <p className="text-xs text-slate-400">{batch.fileName}</p>}
          </div>
          <StatusBadge status={batch.status} />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4 text-sm">
          <Stat label="Total rows" value={batch.totalRows} />
          <Stat label="Valid rows" value={batch.validRows} />
          <Stat label="Invalid rows" value={batch.invalidRows} />
          <Stat
            label={batch.status === "PREVIEW_READY" ? "Estimated total" : "Total charged"}
            value={formatCurrency(batch.totalStampDuty || 0)}
          />
        </div>

        {["COMPLETED", "PARTIALLY_FAILED", "PROCESSING", "FAILED"].includes(batch.status) && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-4 text-sm">
            <Stat label="Requests created" value={batch.createdRequests} />
            <Stat label="Failed" value={batch.failedRows} />
            <Stat label="Out of" value={batch.totalRows} />
          </div>
        )}

        {batch.errorSummary && <p className="text-sm text-red-600 mb-4">{batch.errorSummary}</p>}

        <div className="flex flex-wrap gap-3">
          {canConfirm && (
            <button
              type="button"
              onClick={handleConfirm}
              disabled={confirming}
              className="bg-brand-600 hover:bg-brand-700 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {confirming ? "Confirming..." : `Confirm & charge ${formatCurrency(batch.totalStampDuty || 0)}`}
            </button>
          )}
          {canCancel && (
            <button type="button" onClick={handleCancel} className="text-sm text-red-600 border border-red-200 rounded-lg px-4 py-2">
              Cancel batch
            </button>
          )}
          {batch.status === "PROCESSING" && <span className="text-sm text-slate-500 self-center">Processing... this page refreshes automatically.</span>}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 text-sm font-medium text-slate-700">Rows</div>
        {items.length === 0 ? (
          <EmptyState text="No rows to show." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                  <tr>
                    <th className="text-left px-3 py-2">Row</th>
                    <th className="text-left px-3 py-2">Status</th>
                    <th className="text-left px-3 py-2">First Party</th>
                    <th className="text-left px-3 py-2">Second Party</th>
                    <th className="text-left px-3 py-2">Amount</th>
                    <th className="text-left px-3 py-2">Notes</th>
                    <th className="text-left px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item._id} className="border-t border-slate-100">
                      <td className="px-3 py-2">{item.rowNumber}</td>
                      <td className="px-3 py-2">
                        <StatusBadge status={item.status} />
                        {item.isDuplicateSuspect && <span className="ml-1 text-amber-600 text-xs">possible duplicate</span>}
                      </td>
                      <td className="px-3 py-2">{item.inputData?.firstParty}</td>
                      <td className="px-3 py-2">{item.inputData?.secondParty}</td>
                      <td className="px-3 py-2">{item.calculatedAmount != null ? formatCurrency(item.calculatedAmount) : "-"}</td>
                      <td className="px-3 py-2 text-slate-500">
                        {item.validationErrors?.length > 0 && <div>{item.validationErrors.join("; ")}</div>}
                        {item.failureReason && <div className="text-red-600">{item.failureReason}</div>}
                      </td>
                      <td className="px-3 py-2">
                        {/* Section 3 - "View Request" only when this row genuinely
                            produced a real EStampRequest (item.requestId), pointing
                            into Phase 22's SAME single-request lifecycle page -
                            never a second bulk-only lifecycle UI. No retry button:
                            there is no bulk-specific row retry endpoint. */}
                        {item.status === "CREATED" && item.requestId && (
                          <Link to={`/estamps/requests/${item.requestId}`} className="text-brand-600 hover:underline">
                            View Request
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 text-sm text-slate-500 border-t border-slate-100">
                <span>
                  Page {page} of {totalPages} ({itemsTotal} row(s))
                </span>
                <div className="space-x-2">
                  <button type="button" disabled={page <= 1} onClick={() => changePage(page - 1)} className="px-3 py-1 rounded-lg border border-slate-300 disabled:opacity-40">
                    Previous
                  </button>
                  <button type="button" disabled={page >= totalPages} onClick={() => changePage(page + 1)} className="px-3 py-1 rounded-lg border border-slate-300 disabled:opacity-40">
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

function Stat({ label, value }) {
  return (
    <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-base font-semibold text-slate-900">{value ?? 0}</p>
    </div>
  );
}
