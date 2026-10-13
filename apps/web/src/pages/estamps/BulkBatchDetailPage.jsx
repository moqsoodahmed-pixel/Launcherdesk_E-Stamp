import { FileSpreadsheet } from "lucide-react";
import Toast from "../../components/ui/Toast";
import { useConfirm } from "../../components/ui/useConfirm";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { apiClient } from "../../api/client";
import { errorMessage, formatCurrency } from "../../utils/format";
import StatusBadge from "../../components/estamps/StatusBadge";
import EmptyState from "../../components/dashboard/EmptyState";
import { TableSkeleton } from "../../components/dashboard/LoadingSkeleton";
import ErrorState from "../../components/common/ErrorState";

// Phase 23 - dedicated batch detail page (/estamps/bulk/:batchId). Reached
// from the list page's "View" link, or from BulkUploadWizard right after a
// confirm. Preserves, unchanged, every real gate/behavior the old
// single-page version had: polling ONLY while PROCESSING, the exact
// canConfirm/canCancel derivation, the confirmation dialog's amount prompt, and
// the reload-on-rejected-confirm handling (a rejected confirm still updates
// the batch server-side, e.g. to FAILED on insufficient balance).
export default function BulkBatchDetailPage() {
  const [confirm, confirmDialog] = useConfirm();
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

  // Initial load: a 404 means "no such batch"; anything else (network, 500)
  // is a load failure the user can retry - never shown as "not found".
  const [loadFailure, setLoadFailure] = useState(null);
  const initialLoad = useCallback(() => {
    setLoading(true);
    setError(null);
    setLoadFailure(null);
    loadBatch(1)
      .catch((err) => setLoadFailure({ notFound: err?.response?.status === 404, message: errorMessage(err, "Unable to load this batch.") }))
      .finally(() => setLoading(false));
  }, [loadBatch]);
  useEffect(() => {
    initialLoad();
  }, [initialLoad]);

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
    const ok = await confirm({
      title: "Confirm this batch?",
      message: `${formatCurrency(batch.totalStampDuty || 0)} will be charged to your wallet for ${batch.validRows} valid row(s).`,
      confirmLabel: "Charge and confirm",
    });
    if (!ok) return;
    setConfirming(true);
    setError(null);
    setNotice(null);
    try {
      const { data } = await apiClient.post(`/bulk-estamps/${batch._id}/confirm`, {
        organizationId: batch.organizationId,
      });
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
    const ok = await confirm({ title: "Cancel this batch?", message: "Nothing has been charged yet.", confirmLabel: "Cancel batch", tone: "danger" });
    if (!ok) return;
    setError(null);
    try {
      const { data } = await apiClient.post(`/bulk-estamps/${batch._id}/cancel`, {
        organizationId: batch.organizationId,
      });
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
        {loadFailure && !loadFailure.notFound ? (
          <ErrorState message={loadFailure.message} onRetry={initialLoad} />
        ) : (
          <EmptyState text="This batch could not be found." />
        )}
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(itemsTotal / limit));
  const canConfirm = batch.status === "PREVIEW_READY" && batch.validRows > 0;
  const canCancel = ["UPLOADED", "VALIDATING", "PREVIEW_READY"].includes(batch.status);

  return (
    <div className="max-w-5xl">
      {confirmDialog}
      <div className="flex items-center justify-between mb-4">
        <button type="button" onClick={() => navigate("/estamps/bulk")} className="inline-flex min-h-[36px] items-center text-sm text-slate-600 hover:text-slate-900 hover:underline">
          &larr; Back to Bulk Requests
        </button>
      </div>

      {error && <Toast tone="error" className="mb-4">{error}</Toast>}
      {notice && <Toast tone="success" className="mb-4">{notice}</Toast>}

      <div className="card mb-6 p-5 sm:p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-slate-600">Batch</p>
            <h1 className="break-all font-display text-2xl font-semibold text-slate-900">{batch.batchNumber}</h1>
            {batch.fileName && (
              <p className="mt-0.5 flex items-center gap-1.5 text-sm text-slate-500">
                <FileSpreadsheet size={14} aria-hidden="true" />
                {batch.fileName}
              </p>
            )}
          </div>
          <StatusBadge status={batch.status} kind="batch" />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4 text-sm">
          <Stat label="Total rows" value={batch.totalRows} />
          <Stat label="Valid rows" value={batch.validRows} />
          <Stat label="Stamp Duty" value={formatCurrency(batch.totalStampDuty || 0)} />
          <Stat
            label={batch.status === "PREVIEW_READY" ? "Total Payable (inc. GST)" : "Total charged"}
            value={formatCurrency(batch.totalPayableAmount || batch.totalStampDuty || 0)}
          />
        </div>

        {["COMPLETED", "PARTIALLY_FAILED", "PROCESSING", "FAILED"].includes(batch.status) && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-4 text-sm">
            <Stat label="Requests created" value={batch.createdRequests} />
            <Stat label="Failed" value={batch.failedRows} />
            <Stat label="Out of" value={batch.totalRows} />
          </div>
        )}

        {batch.errorSummary && <Toast tone="error" className="mb-4">{batch.errorSummary}</Toast>}

        <div className="flex flex-wrap gap-3">
          {canConfirm && (
            <button
              type="button"
              onClick={handleConfirm}
              disabled={confirming}
              className="inline-flex min-h-[44px] sm:min-h-[40px] items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
            >
              {confirming ? "Confirming..." : `Confirm & charge ${formatCurrency(batch.totalPayableAmount || batch.totalStampDuty || 0)}`}
            </button>
          )}
          {canCancel && (
            <button type="button" onClick={handleCancel} className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-vermilion-200 bg-white px-4 text-sm font-medium text-vermilion-700 hover:bg-vermilion-50 sm:min-h-[40px]">
              Cancel batch
            </button>
          )}
          {batch.status === "PROCESSING" && <span className="self-center text-sm text-slate-600" role="status">Processing... this page refreshes automatically.</span>}
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="font-display text-base font-semibold text-slate-900">Rows</h2>
          <span className="text-sm text-slate-500 tabular-nums">{itemsTotal} row(s)</span>
        </div>
        {items.length === 0 ? (
          <EmptyState text="No rows to show." />
        ) : (
          <>
            <div className="max-h-[70vh] overflow-auto">
              <table className="w-full min-w-[1100px] text-left text-sm">
                <thead className="whitespace-nowrap text-xs text-slate-600">
                  <tr>
                    <th scope="col" className="sticky top-0 z-[1] border-b border-slate-200 bg-slate-50 px-3 py-2.5 font-semibold">Row</th>
                    <th scope="col" className="sticky top-0 z-[1] border-b border-slate-200 bg-slate-50 px-3 py-2.5 font-semibold">Status</th>
                    <th scope="col" className="sticky top-0 z-[1] border-b border-slate-200 bg-slate-50 px-3 py-2.5 font-semibold">State</th>
                    <th scope="col" className="sticky top-0 z-[1] border-b border-slate-200 bg-slate-50 px-3 py-2.5 font-semibold">Article</th>
                    <th scope="col" className="sticky top-0 z-[1] border-b border-slate-200 bg-slate-50 px-3 py-2.5 font-semibold">First Party</th>
                    <th scope="col" className="sticky top-0 z-[1] border-b border-slate-200 bg-slate-50 px-3 py-2.5 font-semibold">Second Party</th>
                    <th scope="col" className="sticky top-0 z-[1] border-b border-slate-200 bg-slate-50 px-3 py-2.5 font-semibold">Document / Property</th>
                    <th scope="col" className="sticky top-0 z-[1] border-b border-slate-200 bg-slate-50 px-3 py-2.5 font-semibold text-right">Consideration</th>
                    <th scope="col" className="sticky top-0 z-[1] border-b border-slate-200 bg-slate-50 px-3 py-2.5 font-semibold">Paid By</th>
                    <th scope="col" className="sticky top-0 z-[1] border-b border-slate-200 bg-slate-50 px-3 py-2.5 font-semibold text-center">Qty</th>
                    <th scope="col" className="sticky top-0 z-[1] border-b border-slate-200 bg-slate-50 px-3 py-2.5 font-semibold text-right">Stamp Duty</th>
                    <th scope="col" className="sticky top-0 z-[1] border-b border-slate-200 bg-slate-50 px-3 py-2.5 font-semibold text-right">Fees & GST</th>
                    <th scope="col" className="sticky top-0 z-[1] border-b border-slate-200 bg-slate-50 px-3 py-2.5 font-semibold text-right">Total Amount</th>
                    <th scope="col" className="sticky top-0 z-[1] border-b border-slate-200 bg-slate-50 px-3 py-2.5 font-semibold">Notes</th>
                    <th scope="col" className="sticky top-0 z-[1] border-b border-slate-200 bg-slate-50 px-3 py-2.5 font-semibold"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((item) => {
                    const articleText = item.articleDetails?.title
                      ? `${item.articleDetails.code ? item.articleDetails.code + " - " : ""}${item.articleDetails.title}`
                      : item.inputData?.articleId || "-";
                    const feesAndGst = (item.convenienceFee || 0) + (item.procurementFee || 99) + (item.gst || 0);
                    return (
                      <tr key={item._id} className="align-top transition-colors hover:bg-brand-50/40">
                        <td className="px-3 py-2.5 font-medium text-slate-900">{item.rowNumber}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <StatusBadge status={item.status} />
                          {item.isDuplicateSuspect && <span className="mt-1 block text-xs font-semibold text-marigold-700">duplicate?</span>}
                        </td>
                        <td className="px-3 py-2.5 font-medium text-slate-800 whitespace-nowrap">{item.inputData?.stateCode || "-"}</td>
                        <td className="px-3 py-2.5 max-w-[180px] truncate" title={articleText}>
                          <span className="text-slate-800 font-medium">{articleText}</span>
                        </td>
                        <td className="px-3 py-2.5 font-medium text-slate-800 whitespace-nowrap">{item.inputData?.firstParty || "-"}</td>
                        <td className="px-3 py-2.5 font-medium text-slate-800 whitespace-nowrap">{item.inputData?.secondParty || "-"}</td>
                        <td className="px-3 py-2.5 max-w-[200px]">
                          <div className="truncate font-medium text-slate-800" title={item.inputData?.descriptionOfDocument}>
                            {item.inputData?.descriptionOfDocument || "-"}
                          </div>
                          {item.inputData?.propertyDescription && (
                            <div className="truncate text-xs text-slate-500" title={item.inputData?.propertyDescription}>
                              {item.inputData?.propertyDescription}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-right font-medium text-slate-700 whitespace-nowrap">
                          {item.inputData?.considerationPrice != null ? formatCurrency(item.inputData.considerationPrice) : "-"}
                        </td>
                        <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap">{item.inputData?.stampDutyPaidBy || "-"}</td>
                        <td className="px-3 py-2.5 text-center font-medium text-slate-800">{item.inputData?.numberOfEStamps || 1}</td>
                        <td className="px-3 py-2.5 tabular-nums text-right font-medium text-slate-900 whitespace-nowrap">
                          {item.stampDuty != null ? formatCurrency(item.stampDuty) : (item.calculatedAmount != null ? formatCurrency(item.calculatedAmount) : "-")}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-right text-slate-600 whitespace-nowrap" title={`Conv: ₹${item.convenienceFee || 0}, Proc: ₹${item.procurementFee || 99}, GST: ₹${item.gst || 0}`}>
                          {formatCurrency(feesAndGst)}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-right font-semibold text-slate-900 whitespace-nowrap">
                          {item.totalAmount != null ? formatCurrency(item.totalAmount) : (item.calculatedAmount != null ? formatCurrency(item.calculatedAmount) : "-")}
                        </td>
                        <td className="min-w-[180px] px-3 py-2.5 text-xs text-slate-600">
                          {item.validationErrors?.length > 0 && <div>{item.validationErrors.join("; ")}</div>}
                          {item.failureReason && <div className="text-vermilion-700">{item.failureReason}</div>}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          {item.status === "CREATED" && item.requestId && (
                            <Link to={`/estamps/requests/${item.requestId}`} className="font-medium text-brand-700 hover:underline">
                              View Request
                            </Link>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 text-sm text-slate-500 border-t border-slate-100">
                <span>
                  Page {page} of {totalPages} ({itemsTotal} row(s))
                </span>
                <div className="space-x-2">
                  <button type="button" disabled={page <= 1} onClick={() => changePage(page - 1)} className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 text-slate-700 hover:bg-slate-50 disabled:opacity-40">
                    Previous
                  </button>
                  <button type="button" disabled={page >= totalPages} onClick={() => changePage(page + 1)} className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 text-slate-700 hover:bg-slate-50 disabled:opacity-40">
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
    <div className="rounded-lg bg-slate-50 px-3 py-2.5">
      <p className="text-xs text-slate-600">{label}</p>
      <p className="font-display text-lg font-semibold text-slate-900 tabular-nums">{value ?? 0}</p>
    </div>
  );
}
