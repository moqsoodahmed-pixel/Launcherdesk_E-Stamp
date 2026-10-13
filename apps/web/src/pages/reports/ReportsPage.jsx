import { BadgeCheck, BarChart3, Building2, FileText, Files, Package, PlugZap, RefreshCw, Wallet, XCircle } from "lucide-react";
import EmptyState from "../../components/dashboard/EmptyState";
import { TILE_TONES } from "../../components/ui/StatTile";
import Toast from "../../components/ui/Toast";
import { useState } from "react";
import { apiClient } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { CHART_COLORS, gridProps, axisProps, yAxisProps, tooltipProps, barProps, lineProps } from "../../components/dashboard/chartTheme";
import { isClientRole, statusMeta } from "../../components/ui/status";
import { getErrorMessage } from "../../utils/errors";
import { useApi } from "../../hooks/useApi";
import LoadingState from "../../components/common/LoadingState";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { isManualFulfilment } from "../../utils/fulfilment";

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
  return getErrorMessage(err, fallback);
}

export default function ReportsPage() {
  const { user } = useAuth();
  const canViewFinancial = hasEffectivePermission(user, REPORT_FINANCIAL_VIEW);
  const canViewGlobal = hasEffectivePermission(user, REPORT_GLOBAL_VIEW);
  // There is no provider report in manual fulfilment mode.
  const canViewProvider = hasEffectivePermission(user, ESTAMP_PROVIDER_VIEW) && !isManualFulfilment(user);
  const internal = isInternalRole(user?.role);
  const orgRequired = internal && !canViewGlobal;

  const [preset, setPreset] = useState("last30days");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [orgFilter, setOrgFilter] = useState("");

  const dateParams = preset === "custom" ? { from: customFrom || undefined, to: customTo || undefined } : { preset };
  // Only a complete organization id (24-hex ObjectId), once typing pauses, is
  // sent - a partial id would just produce a 400 on every section.
  const debouncedOrg = useDebouncedValue(orgFilter.trim(), 400);
  const appliedOrg = /^[a-f0-9]{24}$/i.test(debouncedOrg) ? debouncedOrg : "";
  const orgInvalid = !!orgFilter.trim() && debouncedOrg === orgFilter.trim() && !appliedOrg;
  const scopeParams = appliedOrg ? { organizationId: appliedOrg } : {};
  const canLoadScoped = (!orgRequired || !!appliedOrg) && !orgInvalid;

  // Every section loads independently: a failing (or slow, now bounded by
  // the API client's timeout) section shows its own error and never blocks
  // the others. useApi aborts the previous batch when filters change, so a
  // stale response can never overwrite a newer one.
  const { data, loading, refetch: load } = useApi(
    async (signal) => {
      const errors = {};
      let disabledMessage = null;
      const section = (key, enabled, url, params, fallback) =>
        enabled
          ? apiClient
              .get(url, { params, signal })
              .then((r) => r.data.data)
              .catch((err) => {
                if (signal.aborted) throw err;
                // REPORTS_ENABLED=false answers 503 on every section: report it once.
                if (err?.response?.status === 503) disabledMessage = err.response.data?.message || "Reports are currently disabled.";
                errors[key] = errorMessage(err, fallback);
                return null;
              })
          : Promise.resolve(null);
      const [dashboard, requests, orders, financial, organizations, bulk, provider] = await Promise.all([
        section("dashboard", true, "/reports/dashboard", scopeParams, "Failed to load dashboard summary."),
        section("requests", true, "/reports/requests", { ...scopeParams, ...dateParams }, "Failed to load request analytics."),
        section("orders", true, "/reports/orders", { ...scopeParams, ...dateParams }, "Failed to load order analytics."),
        section("financial", canViewFinancial, "/reports/financial", { ...scopeParams, ...dateParams }, "Failed to load financial report."),
        section("organizations", canViewGlobal, "/reports/organizations", { limit: 10 }, "Failed to load organizations report."),
        section("bulk", true, "/reports/bulk", { ...scopeParams, ...dateParams }, "Failed to load bulk E-Stamp report."),
        section("provider", canViewProvider, "/reports/provider", dateParams, "Failed to load provider report."),
      ]);
      return { dashboard, requests, orders, financial, organizations, bulk, provider, errors, disabledMessage };
    },
    [preset, customFrom, customTo, appliedOrg, canViewFinancial, canViewGlobal, canViewProvider],
    { enabled: canLoadScoped }
  );
  const { dashboard = null, requests = null, orders = null, financial = null, organizations = null, bulk = null, provider = null, errors = {}, disabledMessage = null } = data || {};

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-slate-900">Reports & Analytics</h1>
          <p className="mt-1 text-sm text-slate-600">Requests, orders and payments for the range you choose.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {internal && (
            <input
              aria-label="Organization ID"
              placeholder={orgRequired ? "Organization ID (required)" : "Organization ID (optional filter)"}
              value={orgFilter}
              onChange={(e) => setOrgFilter(e.target.value)}
              className="input w-full sm:w-64"
            />
          )}
          <select aria-label="Date range" value={preset} onChange={(e) => setPreset(e.target.value)} className="input w-auto">
            {PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          {preset === "custom" && (
            <>
              <input type="date" aria-label="From date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="input w-auto" />
              <span className="text-sm text-slate-600">to</span>
              <input type="date" aria-label="To date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="input w-auto" />
            </>
          )}
          <button onClick={load} className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 sm:min-h-[40px]">
            <RefreshCw size={16} aria-hidden="true" />
            Refresh
          </button>
        </div>
      </div>

      {orgInvalid && (
        <Toast tone="warning">Enter the full 24-character organization ID.</Toast>
      )}

      {orgRequired && !orgFilter.trim() && (
        <Toast tone="warning">
          You do not hold platform-wide report access - enter a specific organization's ID above to view its reports.
        </Toast>
      )}

      {canLoadScoped && loading && <LoadingState text="Loading reports..." />}

      {canLoadScoped && !loading && disabledMessage && (
        <div role="status" className="card flex flex-col items-center p-8 text-center">
          <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-500">
            <BarChart3 size={20} aria-hidden="true" />
          </span>
          <h2 className="mb-1 font-display text-base font-semibold text-slate-900">Reports are unavailable</h2>
          <p className="text-sm text-slate-600">{disabledMessage} Please check back later or contact your administrator.</p>
        </div>
      )}

      {canLoadScoped && !loading && !disabledMessage && (
        <>
          <KpiSection dashboard={dashboard} error={errors.dashboard} canViewFinancial={canViewFinancial} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ChartCard title="Requests over time" error={errors.requests}>
              {requests?.dailyTrend?.length ? (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={requests.dailyTrend}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="date" {...axisProps} />
                    <YAxis allowDecimals={false} {...yAxisProps} />
                    <Tooltip {...tooltipProps} />
                    <Line {...lineProps} dataKey="count" name="Requests" stroke={CHART_COLORS[0]} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState text="No requests in this range." />
              )}
            </ChartCard>

            <ChartCard title="Request status distribution" error={errors.requests}>
              {requests?.statusDistribution?.length ? (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={statusChartData(requests.statusDistribution, isClientRole(user?.role))}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="status" {...axisProps} interval={0} angle={-20} textAnchor="end" height={60} />
                    <YAxis allowDecimals={false} {...yAxisProps} />
                    <Tooltip {...tooltipProps} />
                    <Bar dataKey="count" name="Requests" fill={CHART_COLORS[0]} {...barProps} />
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
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="stateCode" {...axisProps} />
                  <YAxis allowDecimals={false} {...yAxisProps} />
                  <Tooltip {...tooltipProps} />
                  <Bar dataKey="count" name="Requests" fill={CHART_COLORS[1]} {...barProps} />
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

          <section className="card p-5 sm:p-6">
            <h2 className="mb-4 flex items-center gap-2 font-display text-base font-semibold text-slate-900">
              <Package size={18} strokeWidth={1.75} className="text-slate-500" aria-hidden="true" />
              Order processing
            </h2>
            {errors.orders && <div className="mb-3 text-sm text-vermilion-700">{errors.orders}</div>}
            {orders && (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <StatCard label="Total orders" value={orders.totals.totalOrders} />
                <StatCard label="Issued" value={orders.totals.issued} />
                <StatCard label={isClientRole(user?.role) ? "Being prepared" : "Processing"} value={orders.totals.processing} />
                <StatCard label="Failed" value={orders.totals.failed} />
                <StatCard label="Issuance success rate" value={formatRate(orders.issuanceSuccessRate)} />
                <StatCard label="Avg retry count" value={orders.retryStats.avg?.toFixed(2) ?? "0"} />
                <StatCard label="Max retry count" value={orders.retryStats.max ?? 0} />
                <StatCard label="Avg time to issue" value={formatSeconds(orders.timing?.createdToIssuedSeconds)} />
              </div>
            )}
          </section>

          <section className="card p-5 sm:p-6">
            <h2 className="mb-4 flex items-center gap-2 font-display text-base font-semibold text-slate-900">
              <Files size={18} strokeWidth={1.75} className="text-slate-500" aria-hidden="true" />
              Bulk E-Stamp
            </h2>
            {errors.bulk && <div className="mb-3 text-sm text-vermilion-700">{errors.bulk}</div>}
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
          </section>

          {canViewProvider && (
            <section className="card p-5 sm:p-6">
              <h2 className="mb-4 flex items-center gap-2 font-display text-base font-semibold text-slate-900">
              <PlugZap size={18} strokeWidth={1.75} className="text-slate-500" aria-hidden="true" />
              E-Stamp Provider
            </h2>
              {errors.provider && <div className="mb-3 text-sm text-vermilion-700">{errors.provider}</div>}
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
                  <p className="mt-3 text-xs text-slate-500">Last updated: {provider.current?.fetchedAt ? new Date(provider.current.fetchedAt).toLocaleString() : "never"}</p>
                </>
              )}
            </section>
          )}

          {canViewFinancial && (
            <section className="card p-5 sm:p-6">
              <h2 className="mb-4 flex items-center gap-2 font-display text-base font-semibold text-slate-900">
              <Wallet size={18} strokeWidth={1.75} className="text-slate-500" aria-hidden="true" />
              Financial
            </h2>
              {errors.financial && <div className="mb-3 text-sm text-vermilion-700">{errors.financial}</div>}
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
            </section>
          )}

          {canViewGlobal && (
            <div className="card overflow-hidden">
              <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
                <h2 className="flex items-center gap-2 font-display text-base font-semibold text-slate-900">
                  <Building2 size={18} strokeWidth={1.75} className="text-slate-500" aria-hidden="true" />
                  Organizations
                </h2>
              </div>
              {errors.organizations && <div className="px-6 py-3 text-sm text-vermilion-700">{errors.organizations}</div>}
              {organizations && (
                <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-600">
                    <tr>
                      <th className="whitespace-nowrap px-4 py-2.5 text-left font-semibold">Name</th>
                      <th className="whitespace-nowrap px-4 py-2.5 text-left font-semibold">Status</th>
                      <th className="whitespace-nowrap px-4 py-2.5 text-left font-semibold">Requests</th>
                      <th className="whitespace-nowrap px-4 py-2.5 text-left font-semibold">Orders</th>
                      <th className="whitespace-nowrap px-4 py-2.5 text-left font-semibold">Wallet balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {organizations.items.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 py-10 text-center text-slate-500">
                          No organizations found.
                        </td>
                      </tr>
                    )}
                    {organizations.items.map((o) => (
                      <tr key={o._id} className="border-t border-slate-100 transition-colors hover:bg-brand-50/40">
                        <td className="px-4 py-3 font-medium text-slate-900">{o.name}</td>
                        <td className="px-4 py-3 text-slate-500">{o.status}</td>
                        <td className="px-4 py-3">{o.requestCount}</td>
                        <td className="px-4 py-3">{o.orderCount}</td>
                        <td className="px-4 py-3 tabular-nums">{o.walletBalance === null ? "N/A" : `₹${o.walletBalance.toLocaleString("en-IN")}`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
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
      {error && <Toast tone="error" className="mb-3">{error}</Toast>}
      {dashboard && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total requests" value={dashboard.requests.total} icon={FileText} tone="blue" />
          <StatCard label="Total orders" value={dashboard.orders.total} icon={Package} tone="teal" />
          <StatCard label="Issued" value={dashboard.orders.issued} icon={BadgeCheck} tone="emerald" />
          <StatCard label="Failed" value={dashboard.orders.failed} icon={XCircle} tone="vermilion" />
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
    <section className="card p-5 sm:p-6">
      <h2 className="mb-4 font-display text-base font-semibold text-slate-900">{title}</h2>
      {error && <div className="mb-3 text-sm text-vermilion-700">{error}</div>}
      {children}
    </section>
  );
}

// With an icon: a top-level KPI tile. Without: a quiet tile inside a section.
function StatCard({ label, value, icon: IconCmp, tone = "blue" }) {
  if (IconCmp) {
    return (
      <div className="card flex items-start gap-3 p-4">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${TILE_TONES[tone]}`}>
          <IconCmp size={20} strokeWidth={1.75} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-sm text-slate-600">{label}</p>
          <p className="font-display text-2xl font-semibold text-slate-900 tabular-nums">{value ?? 0}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <p className="text-xs text-slate-600">{label}</p>
      <p className="font-display text-xl font-semibold text-slate-900 tabular-nums">{value ?? 0}</p>
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

// Clients see request statuses by their plain label; internal stages merge
// into one "Being prepared" bar. Staff see each enum.
function statusChartData(rows, client) {
  if (!client) return rows;
  const byLabel = new Map();
  for (const r of rows) {
    const label = statusMeta(r.status, { client: true }).label;
    byLabel.set(label, (byLabel.get(label) || 0) + r.count);
  }
  return [...byLabel].map(([status, count]) => ({ status, count }));
}
