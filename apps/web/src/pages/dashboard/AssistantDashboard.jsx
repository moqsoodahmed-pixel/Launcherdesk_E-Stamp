import { useEffect, useState, useCallback } from "react";
import { apiClient } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { PERMISSIONS, hasPermission } from "../../utils/permissions";
import { formatCurrency, errorMessage } from "../../utils/format";
import KpiCard from "../../components/dashboard/KpiCard";
import { KpiSkeleton } from "../../components/dashboard/LoadingSkeleton";
import ChartCard from "../../components/dashboard/ChartCard";
import DateRangeFilter from "../../components/dashboard/DateRangeFilter";
import RecentActivityTable from "../../components/dashboard/RecentActivityTable";
import AttentionPanel from "../../components/dashboard/AttentionPanel";
import QuickActionButton from "../../components/dashboard/QuickActionButton";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

// Phase 21 - Assistant Master Admin's dashboard: the SAME composition
// pattern as Master Admin's, but every widget is conditionally rendered
// based on the permissions this specific assistant actually holds (never
// shown-then-403'd). An assistant without REPORT_GLOBAL_VIEW must supply an
// explicit organizationId to any of the new report endpoints (same rule
// report.controller.js's resolveScope enforces server-side) - mirrored here
// with the same organization-id input ReportsPage.jsx already established.
export default function AssistantDashboard() {
  const { user } = useAuth();
  const canReport = hasPermission(user, PERMISSIONS.REPORT_VIEW);
  const canGlobal = hasPermission(user, PERMISSIONS.REPORT_GLOBAL_VIEW);
  const canFinancial = hasPermission(user, PERMISSIONS.REPORT_FINANCIAL_VIEW);
  const canProvider = hasPermission(user, PERMISSIONS.ESTAMP_PROVIDER_VIEW);
  const canSettings = hasPermission(user, PERMISSIONS.SETTINGS_VIEW);
  const canEstampView = hasPermission(user, PERMISSIONS.ESTAMP_VIEW);
  const canOrderView = hasPermission(user, PERMISSIONS.ORDER_VIEW);

  const [orgFilter, setOrgFilter] = useState("");
  const orgRequired = canReport && !canGlobal;
  const scopeReady = !orgRequired || !!orgFilter.trim();
  const scopeParams = orgFilter.trim() ? { organizationId: orgFilter.trim() } : {};

  const [preset, setPreset] = useState("last30days");
  const [summary, setSummary] = useState(null);
  const [summaryErr, setSummaryErr] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [requests, setRequests] = useState(null);
  const [requestsErr, setRequestsErr] = useState(null);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [financial, setFinancial] = useState(null);
  const [financialErr, setFinancialErr] = useState(null);
  const [financialLoading, setFinancialLoading] = useState(false);
  const [activity, setActivity] = useState(null);
  const [activityErr, setActivityErr] = useState(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [providerLow, setProviderLow] = useState(null);

  const load = useCallback(() => {
    if (!canReport || !scopeReady) return;
    setSummaryLoading(true);
    apiClient
      .get("/reports/dashboard", { params: scopeParams })
      .then((r) => setSummary(r.data.data))
      .catch((err) => setSummaryErr(errorMessage(err, "Failed to load summary.")))
      .finally(() => setSummaryLoading(false));

    setRequestsLoading(true);
    apiClient
      .get("/reports/requests", { params: { ...scopeParams, preset } })
      .then((r) => setRequests(r.data.data))
      .catch((err) => setRequestsErr(errorMessage(err, "Failed to load request analytics.")))
      .finally(() => setRequestsLoading(false));

    setActivityLoading(true);
    apiClient
      .get("/reports/recent-activity", { params: { ...scopeParams, limit: 5 } })
      .then((r) => setActivity(r.data.data))
      .catch((err) => setActivityErr(errorMessage(err, "Failed to load recent activity.")))
      .finally(() => setActivityLoading(false));

    if (canFinancial) {
      setFinancialLoading(true);
      apiClient
        .get("/reports/financial", { params: { ...scopeParams, preset } })
        .then((r) => setFinancial(r.data.data))
        .catch((err) => setFinancialErr(errorMessage(err, "Failed to load financial data.")))
        .finally(() => setFinancialLoading(false));
    }

    if (canProvider && canSettings) {
      Promise.all([apiClient.get("/reports/provider"), apiClient.get("/settings/ESTAMP_PROVIDER_LOW_BALANCE_THRESHOLD")])
        .then(([providerRes, settingRes]) => {
          const balance = providerRes.data.data.current?.available;
          const threshold = settingRes.data.data.value;
          setProviderLow(balance != null && threshold != null && balance < threshold ? { balance, threshold } : null);
        })
        .catch(() => setProviderLow(null));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canReport, scopeReady, orgFilter, preset, canFinancial, canProvider, canSettings]);

  useEffect(() => {
    load();
  }, [load]);

  const alerts = [];
  if (summary) {
    if (summary.orders.failed > 0) alerts.push({ level: "warning", text: `${summary.orders.failed} order(s) have failed processing.` });
    if (summary.financial && summary.financial.failedPaymentsCount > 0) {
      alerts.push({ level: "warning", text: `${summary.financial.failedPaymentsCount} payment(s) have failed.` });
    }
  }
  if (providerLow) {
    alerts.push({ level: "critical", text: `E-Stamp provider balance (${providerLow.balance}) is below the configured threshold (${providerLow.threshold}).` });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 mb-1">Welcome back, {user?.name}</h1>
        <p className="text-sm text-slate-500">Assistant Master Admin overview</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {hasPermission(user, PERMISSIONS.CLIENT_VIEW) && <QuickActionButton to="/organizations" label="Clients" icon="🏢" />}
        {canEstampView && <QuickActionButton to="/estamps/requests" label="E-Stamp Requests" icon="📄" />}
        {canOrderView && <QuickActionButton to="/orders" label="Orders" icon="📦" />}
        {canReport && <QuickActionButton to="/reports" label="Full Reports" icon="📊" />}
      </div>

      {!canReport && (
        <div className="rounded-lg bg-slate-100 text-slate-500 text-sm px-4 py-3">
          You do not currently hold report-viewing access, so dashboard analytics are hidden. Use the quick actions above for what you can access.
        </div>
      )}

      {canReport && orgRequired && !orgFilter.trim() && (
        <div className="rounded-lg bg-amber-50 text-amber-700 text-sm px-3 py-2 flex flex-wrap items-center gap-2">
          You do not hold platform-wide report access - enter a specific organization&apos;s ID to view its dashboard.
          <input
            value={orgFilter}
            onChange={(e) => setOrgFilter(e.target.value)}
            placeholder="Organization ID"
            className="rounded-lg border border-amber-300 px-2 py-1 text-sm w-64"
          />
        </div>
      )}

      {canReport && scopeReady && (
        <>
          {orgRequired && (
            <div className="flex items-center gap-2">
              <input
                value={orgFilter}
                onChange={(e) => setOrgFilter(e.target.value)}
                placeholder="Organization ID"
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm w-72"
              />
            </div>
          )}

          {summaryErr && <div className="rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">{summaryErr}</div>}
          {summaryLoading && <KpiSkeleton count={4} />}
          {!summaryLoading && summary && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <KpiCard label="Total requests" value={summary.requests.total} />
              <KpiCard label="Total orders" value={summary.orders.total} />
              <KpiCard label="Issued orders" value={summary.orders.issued} />
              <KpiCard label="Failed orders" value={summary.orders.failed} />
              {canFinancial && summary.financial && <KpiCard label="Successful payments" value={formatCurrency(summary.financial.successfulPaymentsAmount)} />}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ChartCard
              title="Requests over time"
              action={<DateRangeFilter value={preset} onChange={setPreset} />}
              loading={requestsLoading}
              error={requestsErr}
              empty={!requests?.dailyTrend?.length}
              emptyText="No requests in this range."
            >
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={requests?.dailyTrend || []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="count" stroke="#4f46e5" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Request status distribution" loading={requestsLoading} error={requestsErr} empty={!requests?.statusDistribution?.length} emptyText="No requests in this range.">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={requests?.statusDistribution || []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="status" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={60} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#4f46e5" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          <AttentionPanel alerts={alerts} loading={summaryLoading} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <RecentActivityTable
              title="Recent requests"
              loading={activityLoading}
              error={activityErr}
              rows={activity?.requests}
              rowLinkPrefix="/estamps/requests"
              columns={[
                { key: "requestNumber", label: "Request #" },
                ...(canGlobal ? [{ key: "organizationName", label: "Organization", render: (r) => r.organizationName || "-" }] : []),
                { key: "status", label: "Status" },
                { key: "calculatedStampDuty", label: "Value", render: (r) => formatCurrency(r.calculatedStampDuty) },
              ]}
            />
            <RecentActivityTable
              title="Recent orders"
              loading={activityLoading}
              error={activityErr}
              rows={activity?.orders}
              rowLinkPrefix="/orders"
              columns={[
                { key: "orderNumber", label: "Order #" },
                ...(canGlobal ? [{ key: "organizationName", label: "Organization", render: (r) => r.organizationName || "-" }] : []),
                { key: "eStampStatus", label: "Status" },
                { key: "amount", label: "Amount", render: (r) => formatCurrency(r.amount) },
              ]}
            />
          </div>
        </>
      )}
    </div>
  );
}
