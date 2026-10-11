import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { apiClient } from "../../api/client";

const inputClass =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500";

function fmtDate(d) {
  return d ? new Date(d).toLocaleString() : "-";
}
function money(n) {
  return n === null || n === undefined ? "-" : `₹${Number(n).toLocaleString("en-IN")}`;
}

export default function EStampsPage() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const limit = 10;
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [downloadingId, setDownloadingId] = useState(null);
  const [downloadError, setDownloadError] = useState(null);

  // debounce the search box
  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1);
      setSearch(searchInput.trim());
    }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiClient
      .get("/orders", {
        params: {
          page,
          limit,
          eStampStatus: "ISSUED", // only orders the provider has actually issued
          sortBy: "updatedAt",
          sortDir: "desc",
          search: search || undefined,
          stateCode: stateCode.trim().toUpperCase() || undefined,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
        },
      })
      .then(({ data }) => {
        if (cancelled) return;
        setItems(data.data.items || []);
        setTotal(data.data.total || 0);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err?.response?.status === 403
            ? "You do not have permission to view E-Stamps."
            : err?.response?.data?.message || "Failed to load E-Stamps."
        );
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [page, search, stateCode, dateFrom, dateTo]);

  useEffect(() => load(), [load]);

  async function download(orderId) {
    setDownloadError(null);
    setDownloadingId(orderId);
    try {
      const { data: res } = await apiClient.get(`/files/estamp/${orderId}/download`);
      // Same handling as OrderDetailPage: the API returns { url, filename } (a short-lived signed URL).
      const { url, filename } = res.data;
      const blobResponse = await fetch(url);
      if (!blobResponse.ok) throw new Error("Download failed");
      const blob = await blobResponse.blob();
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = filename || "estamp-certificate";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(href);
    } catch (err) {
      setDownloadError(
        err?.response?.status === 403
          ? "You do not have permission to download certificates."
          : err?.response?.data?.message || "Certificate download failed. Please try again."
      );
    } finally {
      setDownloadingId(null);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">E-Stamps</h1>
        <p className="text-sm text-slate-500">Issued E-Stamp certificates.</p>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input aria-label="Search order number" className={inputClass + " w-64"} placeholder="Search order # or reference" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
        <input aria-label="State code" className={inputClass + " w-28"} placeholder="State (KA)" maxLength={10} value={stateCode} onChange={(e) => { setPage(1); setStateCode(e.target.value); }} />
        <input aria-label="From date" type="date" className={inputClass} value={dateFrom} onChange={(e) => { setPage(1); setDateFrom(e.target.value); }} />
        <span className="text-sm text-slate-500">to</span>
        <input aria-label="To date" type="date" className={inputClass} value={dateTo} onChange={(e) => { setPage(1); setDateTo(e.target.value); }} />
      </div>

      {downloadError && <p role="alert" className="mb-3 rounded-lg bg-red-50 text-red-700 text-sm p-3">{downloadError}</p>}

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-slate-500 bg-slate-50">
              <th className="px-4 py-3">Order</th>
              <th className="px-4 py-3">State</th>
              <th className="px-4 py-3">Amount</th>
              <th className="px-4 py-3">Issued</th>
              <th className="px-4 py-3">Certificate</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">Loading...</td></tr>
            )}
            {!loading && error && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-red-600">
                  {error}{" "}
                  <button type="button" className="underline font-medium" onClick={load}>Retry</button>
                </td>
              </tr>
            )}
            {!loading && !error && items.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">No issued E-Stamps yet.</td></tr>
            )}
            {!loading && !error && items.map((o) => (
              <tr key={o._id} className="border-t border-slate-100">
                <td className="px-4 py-3 font-medium">
                  <Link className="text-brand-600 hover:underline" to={`/orders/${o._id}`}>{o.orderNumber}</Link>
                </td>
                <td className="px-4 py-3">{o.stateCode || "-"}</td>
                <td className="px-4 py-3">{money(o.amount)}</td>
                <td className="px-4 py-3">{fmtDate(o.issuedAt || o.updatedAt)}</td>
                <td className="px-4 py-3">{String(o.downloadStatus || "NOT_AVAILABLE").replace(/_/g, " ")}</td>
                <td className="px-4 py-3 text-right">
                  {o.downloadStatus && o.downloadStatus !== "NOT_AVAILABLE" ? (
                    <button type="button" disabled={downloadingId === o._id} onClick={() => download(o._id)} className="text-brand-600 hover:underline disabled:opacity-60">
                      {downloadingId === o._id ? "Downloading..." : "Download"}
                    </button>
                  ) : (
                    <span className="text-slate-400">Not available</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between mt-4 text-sm text-slate-600">
        <span>{total} E-Stamp{total === 1 ? "" : "s"}</span>
        <div className="flex items-center gap-3">
          <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-lg border border-slate-300 px-3 py-1.5 disabled:opacity-50">Previous</button>
          <span>Page {page} of {totalPages}</span>
          <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-slate-300 px-3 py-1.5 disabled:opacity-50">Next</button>
        </div>
      </div>
    </div>
  );
}