import { useEffect, useState, useCallback } from "react";
import { apiClient } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

// @launcherdesk/shared is a CommonJS package built around a runtime
// `__exportStar` re-export loop (see packages/shared/src/index.js) that
// Rollup's production build cannot statically analyze for named imports -
// `getEffectivePermissions`/`Permission` fail to resolve at `vite build`
// time even though they work fine under Node/Vitest. Rather than fight the
// bundler, the two permission values this page needs are mirrored here in
// sync with packages/shared/src/permissions.js's DEFAULT_ROLE_PERMISSIONS.
// If that file's REPORT_FINANCIAL_VIEW/REPORT_GLOBAL_VIEW defaults ever
// change, update this map to match.
const REPORT_FINANCIAL_VIEW = "report.financial_view";
const REPORT_GLOBAL_VIEW = "report.global_view";
const ESTAMP_PROVIDER_VIEW = "estamp_provider.view";
const ROLE_DEFAULT_HAS = {
  MASTER_ADMIN: { financial: true, global: true, provider: true }, // all-permissions rule
  SUPER_ADMIN: { financial: true, global: false, provider: false },
  ADMIN: { financial: false, global: false, provider: false },
  USER: { financial: false, global: false, provider: false },
};
// getEffectivePermissions()'s exact rule: ASSISTANT_MASTER_ADMIN has ONLY
// its own explicitly-stored grants, no role defaults; every other role is
// defaults UNION its own extra grants.
function hasEffectivePermission(user, permission) {
  if (!user) return false;
  const own = user.permissions || [];
  if (user.role === "ASSISTANT_MASTER_ADMIN") return own.includes(permission);
  const defaults = ROLE_DEFAULT_HAS[user.role] || { financial: false, global: false, provider: false };
  const byDefault = permission === REPORT_FINANCIAL_VIEW ? defaults.financial : permission === REPORT_GLOBAL_VIEW ? defaults.global : permission === ESTAMP_PROVIDER_VIEW ? defaults.provider : false;
  return byDefault || own.includes(permission);
}

const PRESETS = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last7days", label: "Last 7 days" },
  { value: "last30days", label: "Last 30 days" },
  { value: "currentMonth", label: "This month" },
  { value: "previousMonth", label: "Previous month" },
  { value: "custom", label: "Custom range" },
];

function isInternalRole(role) {
  return role === "MASTER_ADMIN" || role === "ASSISTANT_MASTER_ADMIN";
}

function errorMessage(err, fallback) {
  if (err?.response?.status === 403) return "You do not have permission to view this.";
  return err?.response?.data?.message || fallback;
}

export default function ReportsPage() {
  const { user } = useAuth();
  const canViewFinancial = hasEffectivePermission(user, REPORT_FINANCIAL_VIEW);
  const canViewGlobal = hasEffectivePermission(user, REPORT_GLOBAL_VIEW);
  const canViewProvider = hasEffectivePermission(user, ESTAMP_PROVIDER_VIEW);
  const internal = isInternalRole(user?.role);
  const orgRequired = internal && !canViewGlobal;

  const [preset, setPreset] = useState("last30days");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [orgFilter, setOrgFilter] = useState("");

  const [dashboard, setDashboard] = useState(null);
  const [requests, setRequests] = useState(null);
  const [orders, setOrders] = useState(null);
  const [financial, setFinancial] = useState(null);
  const [organizations, setOrganizations] = useState(null);
  const [bulk, setBulk] = useState(null);
  const [provider, setProvider] = useState(null);

  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState({});

  const dateParams = preset === "custom" ? { from: customFrom || undefined, to: customTo || undefined } : { preset };
  const scopeParams = orgFilter ? { organizationId: orgFilter.trim() } : {};
  const canLoadScoped = !orgRequired || !!orgFilter.trim();

  const load = useCallback(() => {
    if (!canLoadScoped) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const nextErrors = {};

    const dashboardP = apiClient
      .get("/reports/dashboard", { params: scopeParams })
      .then((r) => setDashboard(r.data.data))
      .catch((err) => {
        nextErrors.dashboard = errorMessage(err, "Failed to load dashboard summary.");
        setDashboard(null);
      });

    const requestsP = apiClient
      .get("/reports/requests", { params: { ...scopeParams, ...dateParams } })
      .then((r) => setRequests(r.data.data))
      .catch((err) => {
        nextErrors.requests = errorMessage(err, "Failed to load request analytics.");
        setRequests(null);
      });

    const ordersP = apiClient
      .get("/reports/orders", { params: { ...scopeParams, ...dateParams } })
      .then((r) => setOrders(r.data.data))
      .catch((err) => {
        nextErrors.orders = errorMessage(err, "Failed to load order analytics.");
        setOrders(null);
      });

    const financialP = canViewFinancial
      ? apiClient
          .get("/reports/financial", { params: { ...scopeParams, ...dateParams } })
          .then((r) => setFinancial(r.data.data))
          .catch((err) => {
            nextErrors.financial = errorMessage(err, "Failed to load financial report.");
            setFinancial(null);
          })
      : Promise.resolve();

    const organizationsP = canViewGlobal
      ? apiClient
          .get("/reports/organizations", { params: { limit: 10 } })
          .then((r) => setOrganizations(r.data.data))
          .catch((err) => {
            nextErrors.organizations = errorMessage(err, "Failed to load organizations report.");
            setOrganizations(null);
          })
      : Promise.resolve();

    const bulkP = apiClient
      .get("/reports/bulk", { params: { ...scopeParams, ...dateParams } })
      .then((r) => setBulk(r.data.data))
      .catch((err) => {
        nextErrors.bulk = errorMessage(err, "Failed to load bulk E-Stamp report.");
        setBulk(null);
      });

    const providerP = canViewProvider
      ? apiClient
          .get("/reports/provider", { params: dateParams })
          .then((r) => setProvider(r.data.data))
          .catch((err) => {
            nextErrors.provider = errorMessage(err, "Failed to load provider report.");
            setProvider(null);
          })
      : Promise.resolve();

    Promise.all([dashboardP, requestsP, ordersP, financialP, organizationsP, bulkP, providerP]).finally(() => {
      setErrors(nextErrors);
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, customFrom, customTo, orgFilter, canViewFinancial, canViewGlobal, canViewProvider, canLoadScoped]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-900">Reports & Analytics</h1>
        <div className="flex flex-wrap items-center gap-2">
          {internal && (
            <input
              placeholder={orgRequired ? "Organization ID (required)" : "Organization ID (optional filter)"}
              value={orgFilter}
              onChange={(e) => setOrgFilter(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          )}
          <select value={preset} onChange={(e) => setPreset(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
            {PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          {preset === "custom" && (
            <>
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              <span className="text-slate-400 text-sm">to</span>
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </>
          )}
          <button onClick={load} className="text-sm text-slate-500 hover:underline">
            Refresh
          </button>
        </div>
      </div>

      {orgRequired && !orgFilter.trim() && (
        <div className="rounded-lg bg-amber-50 text-amber-700 text-sm px-3 py-2">
          You do not hold platform-wide report access - enter a specific organization's ID above to view its reports.
        </div>
      )}

      {!orgRequired && loading && <div className="p-8 text-center text-slate-500">Loading reports...</div>}

      {canLoadScoped && !loading && (
        <>
          <KpiSection dashboard={dashboard} error={errors.dashboard} canViewFinancial={canViewFinancial} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ChartCard title="Requests over time" error={errors.requests}>
              {requests?.dailyTrend?.length ? (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={requests.dailyTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="count" stroke="#4f46e5" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState text="No requests in this range." />
              )}
            </ChartCard>

            <ChartCard title="Request status distribution" error={errors.requests}>
              {requests?.statusDistribution?.length ? (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={requests.statusDistribution}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="status" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={60} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#4f46e5" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState text="No requests in this range." />
              )}
            </ChartCard>
          </div>

          <ChartCard title="Requests by state" error={errors.requests}>
            {requests?.stateDistribution?.length ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={requests.stateDistribution}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="stateCode" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState text="No requests in this range." />
            )}
          </ChartCard>

          {requests && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard label="Total requests" value={requests.total} />
              <StatCard label="Cancellation rate" value={formatRate(requests.cancellationRate)} />
              <StatCard label="Modification rate" value={formatRate(requests.modificationRate)} />
            </div>
          )}

          <div className="bg-white rounded-2xl border border-slate-200 p-6">
            <h2 className="text-sm font-semibold text-slate-900 mb-4">Order processing</h2>
            {errors.orders && <div className="text-sm text-red-600 mb-3">{errors.orders}</div>}
            {orders && (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <StatCard label="Total orders" value={orders.totals.totalOrders} />
                <StatCard label="Issued" value={orders.totals.issued} />
                <StatCard label="Processing" value={orders.totals.processing} />
                <StatCard label="Failed" value={orders.totals.failed} />
                <StatCard label="Issuance success rate" value={formatRate(orders.issuanceSuccessRate)} />
                <StatCard label="Avg retry count" value={orders.retryStats.avg?.toFixed(2) ?? "0"} />
                <StatCard label="Max retry count" value={orders.retryStats.max ?? 0} />
                <StatCard label="Avg time to issue" value={formatSeconds(orders.timing?.createdToIssuedSeconds)} />
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-6">
            <h2 className="text-sm font-semibold text-slate-900 mb-4">Bulk E-Stamp</h2>
            {errors.bulk && <div className="text-sm text-red-600 mb-3">{errors.bulk}</div>}
            {bulk && bulk.totals.batchCount === 0 && !errors.bulk && <EmptyState text="No bulk batches in this range." />}
            {bulk && bulk.totals.batchCount > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard label="Batches" value={bulk.totals.batchCount} />
                <StatCard label="Requests created" value={bulk.totals.createdRequests} />
                <StatCard label="Valid rows" value={bulk.totals.validRows} />
                <StatCard label="Invalid / failed rows" value={bulk.totals.invalidRows + bulk.totals.failedRows} />
                <StatCard label="Bulk stamp duty value" value={`₹${bulk.totals.totalStampDuty.toLocaleString("en-IN")}`} />
              </div>
            )}
          </div>

          {canViewProvider && (
            <div className="bg-white rounded-2xl border border-slate-200 p-6">
              <h2 className="text-sm font-semibold text-slate-900 mb-4">E-Stamp Provider</h2>
              {errors.provider && <div className="text-sm text-red-600 mb-3">{errors.provider}</div>}
              {provider && (
                <>
                  {provider.current?.status !== "AVAILABLE" ? (
                    <p className="text-sm text-slate-500">
                      {provider.current?.status === "NOT_CONFIGURED" ? "Real E-Stamp provider is not configured. Balance unavailable." : provider.current?.errorMessage || "Balance unavailable."}
                    </p>
                  ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      <StatCard label="Available balance" value={`${provider.current.available?.toLocaleString("en-IN") ?? "N/A"} ${provider.current.unit || ""}`} />
                      <StatCard label="Source" value={provider.current.source === "mock" ? "Mock (dev/test)" : provider.current.source} />
                      <StatCard label="Balance snapshots" value={provider.history?.length ?? 0} />
                    </div>
                  )}
                  <p className="text-xs text-slate-400 mt-3">Last updated: {provider.current?.fetchedAt ? new Date(provider.current.fetchedAt).toLocaleString() : "never"}</p>
                </>
              )}
            </div>
          )}

          {canViewFinancial && (
            <div className="bg-white rounded-2xl border border-slate-200 p-6">
              <h2 className="text-sm font-semibold text-slate-900 mb-4">Financial</h2>
              {errors.financial && <div className="text-sm text-red-600 mb-3">{errors.financial}</div>}
              {financial && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <StatCard label="Successful payments" value={`₹${financial.payments.successfulAmount.toLocaleString("en-IN")}`} />
                  <StatCard label="Failed payments" value={financial.payments.failedCount} />
                  <StatCard label="Wallet balance" value={financial.wallet.currentBalance === null ? "N/A (multi-org)" : `₹${financial.wallet.currentBalance.toLocaleString("en-IN")}`} />
                  <StatCard label="Wallet credits" value={`₹${financial.walletTransactions.totalCredits.toLocaleString("en-IN")}`} />
                  <StatCard label="Wallet debits" value={`₹${financial.walletTransactions.totalDebits.toLocaleString("en-IN")}`} />
                  <StatCard label="Total stamp duty value" value={`₹${financial.requestValue.totalCalculatedStampDuty.toLocaleString("en-IN")}`} />
                </div>
              )}
            </div>
          )}

          {canViewGlobal && (
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100">
                <h2 className="text-sm font-semibold text-slate-900">Organizations</h2>
              </div>
              {errors.organizations && <div className="text-sm text-red-600 px-6 py-3">{errors.organizations}</div>}
              {organizations && (
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                    <tr>
                      <th className="text-left px-4 py-3">Name</th>
                      <th className="text-left px-4 py-3">Status</th>
                      <th className="text-left px-4 py-3">Requests</th>
                      <th className="text-left px-4 py-3">Orders</th>
                      <th className="text-left px-4 py-3">Wallet balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {organizations.items.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                          No organizations found.
                        </td>
                      </tr>
                    )}
                    {organizations.items.map((o) => (
                      <tr key={o._id} className="border-t border-slate-100">
                        <td className="px-4 py-3 font-medium text-slate-900">{o.name}</td>
                        <td className="px-4 py-3 text-slate-500">{o.status}</td>
                        <td className="px-4 py-3">{o.requestCount}</td>
                        <td className="px-4 py-3">{o.orderCount}</td>
                        <td className="px-4 py-3">{o.walletBalance === null ? "N/A" : `₹${o.walletBalance.toLocaleString("en-IN")}`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function KpiSection({ dashboard, error, canViewFinancial }) {
  return (
    <div>
      {error && <div className="mb-3 rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>}
      {dashboard && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total requests" value={dashboard.requests.total} />
          <StatCard label="Total orders" value={dashboard.orders.total} />
          <StatCard label="Issued" value={dashboard.orders.issued} />
          <StatCard label="Failed" value={dashboard.orders.failed} />
          {canViewFinancial && dashboard.financial && (
            <>
              <StatCard label="Successful payments" value={`₹${dashboard.financial.successfulPaymentsAmount.toLocaleString("en-IN")}`} />
              <StatCard label="Wallet balance" value={dashboard.financial.currentWalletBalance === null ? "N/A" : `₹${dashboard.financial.currentWalletBalance.toLocaleString("en-IN")}`} />
            </>
          )}
          {dashboard.organizations && (
            <>
              <StatCard label="Organizations" value={dashboard.organizations.total} />
              <StatCard label="Active organizations" value={dashboard.organizations.active} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ChartCard({ title, children, error }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6">
      <h2 className="text-sm font-semibold text-slate-900 mb-3">{title}</h2>
      {error && <div className="text-sm text-red-600 mb-3">{error}</div>}
      {children}
    </div>
  );
}

function EmptyState({ text }) {
  return <p className="text-sm text-slate-400 py-12 text-center">{text}</p>;
}

function StatCard({ label, value }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-xl font-semibold text-slate-900">{value ?? 0}</p>
    </div>
  );
}

function formatRate(rate) {
  if (rate === null || rate === undefined) return "N/A";
  return `${(rate * 100).toFixed(1)}%`;
}

function formatSeconds(timing) {
  if (!timing || timing.avgSeconds === null || timing.avgSeconds === undefined) return "N/A";
  const s = timing.avgSeconds;
  if (s < 60) return `${s.toFixed(0)}s`;
  if (s < 3600) return `${(s / 60).toFixed(1)}m`;
  return `${(s / 3600).toFixed(1)}h`;
}
