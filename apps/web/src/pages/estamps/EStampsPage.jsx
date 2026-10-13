import { Download, Stamp } from "lucide-react";
import StampCard from "../../components/ui/StampCard";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiClient } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { isManualFulfilment } from "../../utils/fulfilment";
import { useApi } from "../../hooks/useApi";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { hasPermission, PERMISSIONS } from "../../utils/permissions";
import { actionErrorMessage, formatCurrency } from "../../utils/format";
import PageHeader from "../../components/common/PageHeader";
import LoadingState from "../../components/common/LoadingState";
import ErrorState from "../../components/common/ErrorState";
import EmptyState from "../../components/common/EmptyState";

const LIMIT = 20;
const inputClass = "input w-auto";
const CERTIFICATE_LABELS = { NOT_AVAILABLE: "Not available", AVAILABLE: "Available", DOWNLOADED: "Downloaded" };

function fmt(date) {
  return date ? new Date(date).toLocaleDateString() : "-";
}

// Issued E-Stamps = orders whose processing status is ISSUED. Listing is
// read-only for every role; Download needs estamp.download.
export default function EStampsPage() {
  const { user } = useAuth();
  const canDownload = hasPermission(user, PERMISSIONS.ESTAMP_DOWNLOAD);

  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [states, setStates] = useState([]);
  const [downloadingId, setDownloadingId] = useState(null);
  const [downloadError, setDownloadError] = useState(null);
  const search = useDebouncedValue(searchInput.trim(), 400);

  useEffect(() => {
    apiClient
      .get("/articles/states")
      .then((res) => setStates(Array.isArray(res.data.data) ? res.data.data : []))
      .catch(() => setStates([]));
  }, []);

  // Any filter change returns to the first page.
  useEffect(() => setPage(1), [search, stateCode, dateFrom, dateTo]);

  const { data, loading, error, refetch } = useApi(
    (signal) =>
      apiClient
        .get("/orders", {
          signal,
          params: {
            eStampStatus: "ISSUED",
            page,
            limit: LIMIT,
            sortBy: "createdAt",
            sortDir: "desc",
            search: search || undefined,
            stateCode: stateCode || undefined,
            dateFrom: dateFrom || undefined,
            dateTo: dateTo || undefined,
          },
        })
        .then((r) => r.data.data),
    [page, search, stateCode, dateFrom, dateTo],
    { errorMessage: "Failed to load E-Stamps." }
  );

  async function handleDownload(order) {
    setDownloadError(null);
    setDownloadingId(order._id);
    try {
      const { data: res } = await apiClient.get(`/files/estamp/${order._id}/download`);
      const { url, filename } = res.data;
      // Fetch the short-lived signed URL as a blob and save it under our
      // own sanitized filename - never navigate to the raw storage URL.
      const blobResponse = await fetch(url);
      if (!blobResponse.ok) throw new Error("Download failed");
      const blob = await blobResponse.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename || "estamp-certificate";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      setDownloadError(actionErrorMessage(err, `Certificate download failed for ${order.orderNumber}. Please try again.`));
    } finally {
      setDownloadingId(null);
    }
  }

  const items = data?.items || [];
  const total = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));
  const hasFilters = !!(search || stateCode || dateFrom || dateTo);

  return (
    <div>
      <PageHeader title="E-Stamps" subtitle="Issued E-Stamp certificates" />

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <label htmlFor="estamps-search" className="mb-1.5 block text-sm font-medium text-slate-800">
            Search
          </label>
          <input id="estamps-search" placeholder={isManualFulfilment(user) ? "Order # or stamp reference" : "Order # or provider reference"} value={searchInput} onChange={(e) => setSearchInput(e.target.value)} className={`${inputClass} w-full sm:w-72`} />
        </div>
        <div>
          <label htmlFor="estamps-state" className="mb-1.5 block text-sm font-medium text-slate-800">
            State
          </label>
          {states.length > 0 ? (
            <select id="estamps-state" value={stateCode} onChange={(e) => setStateCode(e.target.value)} className={inputClass}>
              <option value="">All states</option>
              {states.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          ) : (
            <input id="estamps-state" placeholder="State code" value={stateCode} onChange={(e) => setStateCode(e.target.value)} className={`${inputClass} w-28`} />
          )}
        </div>
        <div>
          <label htmlFor="estamps-from" className="mb-1.5 block text-sm font-medium text-slate-800">
            From
          </label>
          <input id="estamps-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label htmlFor="estamps-to" className="mb-1.5 block text-sm font-medium text-slate-800">
            To
          </label>
          <input id="estamps-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={inputClass} />
        </div>
        {hasFilters && (
          <button
            type="button"
            onClick={() => {
              setSearchInput("");
              setStateCode("");
              setDateFrom("");
              setDateTo("");
            }}
            className="min-h-[44px] text-sm text-slate-600 hover:text-slate-900 hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {downloadError && (
        <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
          {downloadError}
        </div>
      )}

      {loading && <LoadingState text="Loading E-Stamps..." />}
      {!loading && error && <ErrorState message={error} onRetry={refetch} />}
      {!loading && !error && items.length === 0 && (
        <div className="card">
          <EmptyState title={hasFilters ? "No E-Stamps match these filters" : "No issued E-Stamps yet"} />
        </div>
      )}
      {!loading && !error && items.length > 0 && (
        <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3" aria-label="Issued E-Stamp certificates">
          {items.map((o) => (
            <li key={o._id}>
              <StampCard className="h-full" innerClassName="flex h-full flex-col gap-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link to={`/orders/${o._id}`} className="font-display text-lg font-semibold text-slate-900 hover:text-brand-700 hover:underline">
                      {o.orderNumber}
                    </Link>
                    <p className="mt-0.5 text-sm text-slate-600">{o.stateCode || "-"}</p>
                  </div>
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
                    <Stamp size={20} strokeWidth={1.75} aria-hidden="true" />
                  </span>
                </div>
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-slate-500">Amount</dt>
                    <dd className="font-medium text-slate-900 tabular-nums">{formatCurrency(o.amount)}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Issued</dt>
                    <dd className="font-medium text-slate-900 tabular-nums">{fmt(o.issuedAt)}</dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-slate-500">Certificate</dt>
                    <dd className="font-medium text-slate-900">{CERTIFICATE_LABELS[o.downloadStatus] || o.downloadStatus || "-"}</dd>
                  </div>
                </dl>
                {canDownload && o.downloadStatus && o.downloadStatus !== "NOT_AVAILABLE" && (
                  <button
                    type="button"
                    onClick={() => handleDownload(o)}
                    disabled={downloadingId === o._id}
                    aria-label={`Download certificate for ${o.orderNumber}`}
                    className="mt-auto inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
                  >
                    <Download size={16} aria-hidden="true" />
                    {downloadingId === o._id ? "Downloading..." : "Download"}
                  </button>
                )}
              </StampCard>
            </li>
          ))}
        </ul>
      )}

      {!error && total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 mt-4 text-sm text-slate-500">
          <span>
            Page {page} of {totalPages} ({total} total)
          </span>
          <div className="space-x-2">
            <button disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)} className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 text-slate-700 hover:bg-slate-50 disabled:opacity-40">
              Previous
            </button>
            <button disabled={page >= totalPages || loading} onClick={() => setPage((p) => p + 1)} className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 text-slate-700 hover:bg-slate-50 disabled:opacity-40">
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
