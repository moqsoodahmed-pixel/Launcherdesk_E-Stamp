import { useEffect, useState, useCallback } from "react";
import { apiClient } from "../../api/client";
import { formatCurrency } from "../../utils/format";

const STATUS_LABEL = {
  AVAILABLE: { text: "Available", className: "bg-green-100 text-green-700" },
  NOT_CONFIGURED: { text: "Not configured", className: "bg-slate-100 text-slate-600" },
  UNAVAILABLE: { text: "Unavailable", className: "bg-amber-100 text-amber-700" },
  ERROR: { text: "Error", className: "bg-red-100 text-red-700" },
};

export default function EStampProviderPage() {
  const [balance, setBalance] = useState(null);
  const [usage, setUsage] = useState(null);
  const [groupBy, setGroupBy] = useState("organization");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([apiClient.get("/estamp-provider/balance"), apiClient.get("/estamp-provider/usage", { params: { groupBy } })])
      .then(([balanceRes, usageRes]) => {
        setBalance(balanceRes.data.data);
        setUsage(usageRes.data.data);
      })
      .catch((err) => setError(err?.response?.data?.message || "Failed to load E-Stamp provider information."))
      .finally(() => setLoading(false));
  }, [groupBy]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleRefresh() {
    setRefreshing(true);
    setError(null);
    try {
      const { data } = await apiClient.post("/estamp-provider/balance/refresh");
      setBalance(data.data);
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to refresh balance.");
    } finally {
      setRefreshing(false);
    }
  }

  if (loading) return <div className="p-8 text-center text-slate-500">Loading...</div>;

  const statusInfo = STATUS_LABEL[balance?.status] || STATUS_LABEL.UNAVAILABLE;
  const isMock = balance?.source === "mock";

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-900">E-Stamp Provider</h1>

      {error && <div className="rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>}

      {isMock && (
        <div className="rounded-lg bg-amber-50 text-amber-700 text-sm px-3 py-2">
          Development/test mode: the real E-Stamp provider is not configured. All balance/usage values below marked "mock" are simulated and never
          reflect a real government/vendor account.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <h2 className="font-medium text-slate-900 mb-2">Provider status</h2>
          <span className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${statusInfo.className}`}>{statusInfo.text}</span>
          {balance?.source && <p className="text-xs text-slate-400 mt-2">Source: {balance.source}</p>}
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <h2 className="font-medium text-slate-900 mb-2">Available balance</h2>
          {balance?.status === "AVAILABLE" ? (
            <p className="text-3xl font-semibold text-slate-900">
              {balance.currency || ""} {balance.available?.toLocaleString()}
            </p>
          ) : (
            <p className="text-lg text-slate-400">
              {balance?.status === "NOT_CONFIGURED" ? "Real E-Stamp provider is not configured. Balance unavailable." : "Balance unavailable."}
            </p>
          )}
          <p className="text-xs text-slate-400 mt-2">Last updated: {balance?.fetchedAt ? new Date(balance.fetchedAt).toLocaleString() : "never"}</p>
          {balance?.errorMessage && <p className="text-xs text-red-600 mt-1">{balance.errorMessage}</p>}
          <button onClick={handleRefresh} disabled={refreshing} className="mt-4 bg-brand-600 hover:bg-brand-700 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">
            {refreshing ? "Refreshing..." : "Refresh Balance"}
          </button>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-slate-900">Internal usage (LauncherDesk)</h2>
          <select aria-label="Group by" value={groupBy} onChange={(e) => setGroupBy(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
            <option value="organization">By organization</option>
            <option value="state">By state</option>
            <option value="article">By article</option>
          </select>
        </div>

        {usage && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <SummaryCard label="Total Orders" value={usage.totals.totalOrders} />
              <SummaryCard label="Issued" value={usage.totals.issued} />
              <SummaryCard label="Processing" value={usage.totals.processing} />
              <SummaryCard label="Failed" value={usage.totals.failed} />
              <SummaryCard label="Total Stamp Value" value={formatCurrency(usage.totals.totalStampValue)} span />
            </div>
            <p className="text-xs text-slate-400 mb-3">
              Range: {new Date(usage.from).toLocaleDateString()} - {new Date(usage.to).toLocaleDateString()} (last 30 days by default)
            </p>

            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                  <tr>
                    <th className="text-left px-4 py-3">{groupBy === "organization" ? "Organization" : groupBy === "state" ? "State" : "Article"}</th>
                    <th className="text-left px-4 py-3">Orders</th>
                    <th className="text-left px-4 py-3">Issued</th>
                    <th className="text-left px-4 py-3">Processing</th>
                    <th className="text-left px-4 py-3">Failed</th>
                    <th className="text-left px-4 py-3">Stamp Value</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.breakdown.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                        No usage in this range.
                      </td>
                    </tr>
                  )}
                  {usage.breakdown.map((row) => (
                    <tr key={row.key} className="border-t border-slate-100">
                      <td className="px-4 py-3 font-mono text-xs text-slate-600">{row.key}</td>
                      <td className="px-4 py-3">{row.totalOrders}</td>
                      <td className="px-4 py-3">{row.issued}</td>
                      <td className="px-4 py-3">{row.processing}</td>
                      <td className="px-4 py-3">{row.failed}</td>
                      <td className="px-4 py-3">{formatCurrency(row.totalStampValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SummaryCard({ label, value, span }) {
  return (
    <div className={`bg-white rounded-2xl border border-slate-200 p-4 ${span ? "col-span-2 md:col-span-1" : ""}`}>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}
