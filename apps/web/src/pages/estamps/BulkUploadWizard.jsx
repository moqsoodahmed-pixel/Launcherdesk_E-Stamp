import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiClient } from "../../api/client";
import { errorMessage, formatCurrency } from "../../utils/format";
import StatusBadge from "../../components/estamps/StatusBadge";

const STEPS = ["Upload", "Validation & Preview", "Financial Review", "Confirm"];

// Phase 23 - the guided upload wizard (/estamps/bulk/new), replacing the
// old single page's cramped upload-form-plus-everything. "Validation" and
// "Preview" are deliberately the SAME real batch state (PREVIEW_READY) -
// there is no separate backend validation step to frame as its own screen,
// so this file does not invent one; it just presents that one real state's
// data (counts + row-level detail) together. Every number shown comes
// straight from the batch/wallet API responses - nothing here is a
// fabricated progress percentage.
export default function BulkUploadWizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [batch, setBatch] = useState(null);
  const [items, setItems] = useState([]);
  const [itemsTotal, setItemsTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(25);
  const [balance, setBalance] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    apiClient.get("/wallet/balance").then((res) => setBalance(res.data.data.balance)).catch(() => setBalance(null));
  }, []);

  function loadItemsPage(batchId, pageNum) {
    return apiClient
      .get(`/bulk-estamps/${batchId}`, { params: { page: pageNum, limit } })
      .then((res) => {
        setItems(res.data.data.items);
        setItemsTotal(res.data.data.itemsTotal);
      })
      .catch(() => {});
  }

  async function handleUpload(e) {
    e.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError("Please choose a CSV or XLSX file first.");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const { data } = await apiClient.post("/bulk-estamps/upload", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setBatch(data.data.batch);
      await loadItemsPage(data.data.batch._id, 1);
      setPage(1);
      setStep(1);
    } catch (err) {
      // A structural failure (bad headers, too many rows, etc.) still
      // returns a batch record on the backend - if it's included, show it
      // (as a failed batch, in the same Validation step) rather than only
      // surfacing a bare error message.
      const data = err?.response?.data;
      setError(errorMessage(err, "Upload failed."));
      if (data?.details?.batch) {
        setBatch(data.details.batch);
        setItems([]);
        setItemsTotal(0);
        setStep(1);
      }
    } finally {
      setUploading(false);
    }
  }

  async function handleConfirm() {
    if (!batch) return;
    if (
      !window.confirm(
        `Confirm this batch? ${formatCurrency(batch.totalStampDuty || 0)} will be charged to your wallet for ${batch.validRows} valid row(s).`
      )
    ) {
      return;
    }
    setConfirming(true);
    setError(null);
    try {
      await apiClient.post(`/bulk-estamps/${batch._id}/confirm`);
      // The batch detail page owns all post-confirm display (including
      // PROCESSING polling) - never a second copy of that logic here.
      navigate(`/estamps/bulk/${batch._id}`);
    } catch (err) {
      setError(errorMessage(err, "Confirm failed."));
      // Even a rejected confirm (e.g. insufficient balance) updates the
      // batch server-side - send the user to the real, current state
      // rather than leaving them on a stale wizard screen.
      navigate(`/estamps/bulk/${batch._id}`);
    } finally {
      setConfirming(false);
    }
  }

  function changeItemsPage(next) {
    setPage(next);
    if (batch) loadItemsPage(batch._id, next);
  }

  const totalPages = Math.max(1, Math.ceil(itemsTotal / limit));
  const canConfirm = batch && batch.status === "PREVIEW_READY" && batch.validRows > 0;
  const insufficientBalance = batch && typeof balance === "number" && balance < (batch.totalStampDuty || 0);

  return (
    <div className="max-w-4xl pb-24">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-xl font-semibold text-slate-900">Create Bulk E-Stamp Request</h1>
        <a href={`${apiClient.defaults.baseURL}/bulk-estamps/template`} className="text-sm text-brand-600 hover:underline">
          Download CSV template
        </a>
      </div>

      <Stepper step={step} />

      {error && <div className="mb-4 rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>}

      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        {step === 0 && (
          <form onSubmit={handleUpload} className="space-y-4">
            <p className="text-sm text-slate-600">
              Upload a CSV or XLSX file to create many E-Stamp requests at once. Each row is validated server-side before anything is
              charged. Large files or row counts may be rejected by the server; the exact reason will be shown here if that happens.
            </p>
            <label htmlFor="bulk-upload-file" className="block text-xs font-medium text-slate-700 mb-1">
              CSV or XLSX file
            </label>
            <input
              id="bulk-upload-file"
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="text-sm block"
            />
            <button
              type="submit"
              disabled={uploading}
              className="bg-brand-600 hover:bg-brand-700 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {uploading ? "Uploading..." : "Upload & Validate"}
            </button>
          </form>
        )}

        {step === 1 && batch && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm text-slate-500">Batch</p>
                <p className="text-lg font-semibold text-slate-900">{batch.batchNumber}</p>
              </div>
              <StatusBadge status={batch.status} />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
              <Stat label="Total rows" value={batch.totalRows} />
              <Stat label="Valid rows" value={batch.validRows} />
              <Stat label="Invalid rows" value={batch.invalidRows} />
            </div>

            {batch.errorSummary && <p className="text-sm text-red-600">{batch.errorSummary}</p>}

            {items.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                    <tr>
                      <th className="text-left px-3 py-2">Row</th>
                      <th className="text-left px-3 py-2">Status</th>
                      <th className="text-left px-3 py-2">First Party</th>
                      <th className="text-left px-3 py-2">Second Party</th>
                      <th className="text-left px-3 py-2">Amount</th>
                      <th className="text-left px-3 py-2">Problem</th>
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
                        <td className="px-3 py-2 text-red-600">{item.validationErrors?.join("; ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {totalPages > 1 && (
                  <div className="flex items-center justify-between mt-3 text-sm text-slate-500">
                    <span>
                      Page {page} of {totalPages} ({itemsTotal} row(s))
                    </span>
                    <div className="space-x-2">
                      <button type="button" disabled={page <= 1} onClick={() => changeItemsPage(page - 1)} className="px-3 py-1 rounded-lg border border-slate-300 disabled:opacity-40">
                        Previous
                      </button>
                      <button type="button" disabled={page >= totalPages} onClick={() => changeItemsPage(page + 1)} className="px-3 py-1 rounded-lg border border-slate-300 disabled:opacity-40">
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {step === 2 && batch && (
          <div className="space-y-4 text-sm">
            <p className="text-slate-600">
              {batch.status === "PREVIEW_READY"
                ? "Estimated total, recalculated from scratch (and only for currently-valid rows) at the moment you confirm. It may change slightly if prices or rules change before then."
                : "This batch is no longer awaiting confirmation."}
            </p>
            <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3 space-y-2">
              <Row label="Valid rows to be submitted" value={batch.validRows} />
              <Row label="Estimated total" value={formatCurrency(batch.totalStampDuty || 0)} />
              <Row label="Current wallet balance" value={balance !== null ? formatCurrency(balance) : "Unknown"} />
              {balance !== null && (
                <Row label="Remaining after confirmation" value={formatCurrency(Math.max(0, balance - (batch.totalStampDuty || 0)))} />
              )}
            </div>
            {insufficientBalance && (
              <div className="rounded-lg bg-red-50 text-red-700 px-3 py-2">
                Insufficient wallet balance for this batch's estimated total. Add funds to your organization's wallet before
                confirming.
              </div>
            )}
          </div>
        )}

        {step === 3 && batch && (
          <div className="space-y-4 text-sm">
            <p className="text-slate-600">
              Confirming will charge your organization's wallet for every currently-valid row and create one E-Stamp request per row,
              the same way a single request is created.
            </p>
            <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3">
              <Row label="Batch" value={batch.batchNumber} />
              <Row label="Valid rows" value={batch.validRows} />
              <Row label="Amount to be charged" value={formatCurrency(batch.totalStampDuty || 0)} />
            </div>
          </div>
        )}

        <div className="sticky bottom-0 -mx-6 -mb-6 mt-6 bg-white border-t border-slate-200 px-6 py-4 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
            className="text-sm text-slate-600 border border-slate-300 rounded-lg px-4 py-2 disabled:opacity-40"
          >
            Back
          </button>
          {step < STEPS.length - 1 ? (
            <button
              key="next-btn"
              type="button"
              disabled={step === 0 || !batch}
              onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
              className="bg-brand-600 hover:bg-brand-700 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              Next
            </button>
          ) : (
            <button
              key="confirm-btn"
              type="button"
              disabled={!canConfirm || confirming || insufficientBalance}
              onClick={handleConfirm}
              className="bg-brand-600 hover:bg-brand-700 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {confirming ? "Confirming..." : `Confirm & charge ${formatCurrency(batch.totalStampDuty || 0)}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Stepper({ step }) {
  return (
    <ol className="flex flex-wrap gap-2 mb-4 text-xs">
      {STEPS.map((label, i) => (
        <li
          key={label}
          className={`rounded-full px-3 py-1 font-medium ${
            i === step ? "bg-brand-600 text-white" : i < step ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"
          }`}
        >
          {i + 1}. {label}
        </li>
      ))}
    </ol>
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

function Row({ label, value }) {
  return (
    <div className="flex justify-between border-b border-slate-100 pb-2 last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-900">{value}</span>
    </div>
  );
}
