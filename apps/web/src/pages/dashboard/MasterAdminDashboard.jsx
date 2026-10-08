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

// Phase 21 - Master Admin's dashboard: genuine platform-wide KPIs/charts,
// composed entirely from Phase 13's existing report.service.js endpoints
// (plus the new bounded /reports/recent-activity added this phase) - no
// fabricated numbers, no invented trend percentages. Every fetch is
// independent (its own try/catch) so one failing widget never takes the
// rest of the page down with it.
export default function MasterAdminDashboard() {
  const { user } = useAuth();
  const canFinancial = hasPermission(user, PERMISSIONS.REPORT_FINANCIAL_VIEW);
  const canProvider = hasPermission(user, PERMISSIONS.ESTAMP_PROVIDER_VIEW);
  const canSettings = hasPermission(user, PERMISSIONS.SETTINGS_VIEW);

  const [preset, setPreset] = useState("last30days");

  const [summary, setSummary] = useState(null);
  const [summaryErr, setSummaryErr] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(true);

  const [requests, setRequests] = useState(null);
  const [requestsErr, setRequestsErr] = useState(null);
  const [requestsLoading, setRequestsLoading] = useState(true);

  const [financial, setFinancial] = useState(null);
  const [financialErr, setFinancialErr] = useState(null);
  const [financialLoading, setFinancialLoading] = useState(canFinancial);

  const [activity, setActivity] = useState(null);
  const [activityErr, setActivityErr] = useState(null);
  const [activityLoading, setActivityLoading] = useState(true);

  const [providerLow, setProviderLow] = useState(null); // { balance, threshold } | null | "unavailable"

  const loadSummary = useCallback(() => {
    setSummaryLoading(true);
    apiClient
      .get("/reports/dashboard")
      .then((r) => setSummary(r.data.data))
      .catch((err) => setSummaryErr(errorMessage(err, "Failed to load platform summary.")))
      .finally(() => setSummaryLoading(false));
  }, []);

  const loadRequests = useCallback(() => {
    setRequestsLoading(true);
    apiClient
      .get("/reports/requests", { params: { preset } })
      .then((r) => setRequests(r.data.data))
      .catch((err) => setRequestsErr(errorMessage(err, "Failed to load request analytics.")))
      .finally(() => setRequestsLoading(false));
  }, [preset]);

  const loadFinancial = useCallback(() => {
    if (!canFinancial) return;
    setFinancialLoading(true);
    apiClient
      .get("/reports/financial", { params: { preset } })
      .then((r) => setFinancial(r.data.data))
      .catch((err) => setFinancialErr(errorMessage(err, "Failed to load financial data.")))
      .finally(() => setFinancialLoading(false));
  }, [preset, canFinancial]);

  const loadActivity = useCallback(() => {
    setActivityLoading(true);
    apiClient
      .get("/reports/recent-activity", { params: { limit: 5 } })
      .then((r) => setActivity(r.data.data))
      .catch((err) => setActivityErr(errorMessage(err, "Failed to load recent activity.")))
      .finally(() => setActivityLoading(false));
  }, []);

  const loadProviderAlert = useCallback(() => {
    if (!canProvider || !canSettings) return;
    Promise.all([apiClient.get("/reports/provider"), apiClient.get("/settings/ESTAMP_PROVIDER_LOW_BALANCE_THRESHOLD")])
      .then(([providerRes, settingRes]) => {
        const balance = providerRes.data.data.current?.available;
        const threshold = settingRes.data.data.value;
        if (balance === null || balance === undefined || threshold === null || threshold === undefined) {
          setProviderLow(null);
          return;
        }
        setProviderLow(balance < threshold ? { balance, threshold } : null);
      })
      .catch(() => setProviderLow(null));
  }, [canProvider, canSettings]);

  useEffect(() => {
    loadSummary();
    loadFinancial();
    loadActivity();
    loadProviderAlert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    loadRequests();
  }, [loadRequests]);
  useEffect(() => {
    loadFinancial();
  }, [loadFinancial]);

  const alerts = [];
  if (summary) {
    if (summary.orders.failed > 0) alerts.push({ level: "warning", text: `${summary.orders.failed} order(s) have failed processing.` });
    if (summary.financial && summary.financial.failedPaymentsCount > 0) {
      alerts.push({ level: "warning", text: `${summary.financial.failedPaymentsCount} payment(s) have failed.` });
    }
    if (summary.organizations && summary.organizations.inactive > 0) {
      alerts.push({ level: "warning", text: `${summary.organizations.inactive} organization(s) are not currently active.` });
    }
  }
  if (providerLow) {
    alerts.push({ level: "critical", text: `E-Stamp provider balance (${providerLow.balance}) is below the configured threshold (${providerLow.threshold}).` });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 mb-1">Welcome back, {user?.name}</h1>
        <p className="text-sm text-slate-500">Platform-wide overview - Master Admin</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <QuickActionButton to="/organizations/new" label="New Organization" icon="🏢" />
        <QuickActionButton to="/estamps/requests" label="View Requests" icon="📄" />
        <QuickActionButton to="/reports" label="Full Reports" icon="📊" />
        <QuickActionButton to="/settings" label="Settings" icon="⚙️" />
      </div>

      {summaryErr && <div className="rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">{summaryErr}</div>}
      {summaryLoading && <KpiSkeleton count={8} />}
      {!summaryLoading && summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <KpiCard label="Total requests" value={summary.requests.total} />
          <KpiCard label="Total orders" value={summary.orders.total} />
          <KpiCard label="Issued orders" value={summary.orders.issued} />
          <KpiCard label="Failed orders" value={summary.orders.failed} />
          {summary.organizations && (
            <>
              <KpiCard label="Organizations" value={summary.organizations.total} />
              <KpiCard label="Active organizations" value={summary.organizations.active} />
            </>
          )}
          {canFinancial && summary.financial && (
            <>
              <KpiCard label="Successful payments" value={formatCurrency(summary.financial.successfulPaymentsAmount)} />
              <KpiCard label="Failed payments" value={summary.financial.failedPaymentsCount} />
            </>
          )}
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard title="Order status" loading={summaryLoading} error={summaryErr} empty={!summary || summary.orders.total === 0} emptyText="No orders yet.">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart
              data={
                summary
                  ? [
                      { status: "Issued", count: summary.orders.issued },
                      { status: "Processing", count: summary.orders.processing },
                      { status: "Failed", count: summary.orders.failed },
                    ]
                  : []
              }
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="status" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="count" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {canFinancial && (
          <ChartCard
            title="Payment activity"
            action={<DateRangeFilter value={preset} onChange={setPreset} />}
            loading={financialLoading}
            error={financialErr}
            empty={!financial || financial.payments.successfulCount + financial.payments.failedCount === 0}
            emptyText="No payments in this range."
          >
            <ResponsiveContainer width="100%" height={200}>
              <BarChart
                data={
                  financial
                    ? [
                        { label: "Successful", amount: financial.payments.successfulAmount },
                        { label: "Failed", amount: financial.payments.failedAmount },
                      ]
                    : []
                }
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => formatCurrency(v)} />
                <Bar dataKey="amount" fill="#16a34a" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        )}
      </div>

      <AttentionPanel alerts={alerts} loading={summaryLoading} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RecentActivityTable
          title="Recent requests (all organizations)"
          loading={activityLoading}
          error={activityErr}
          rows={activity?.requests}
          rowLinkPrefix="/estamps/requests"
          columns={[
            { key: "requestNumber", label: "Request #" },
            { key: "organizationName", label: "Organization", render: (r) => r.organizationName || "-" },
            { key: "status", label: "Status" },
            { key: "calculatedStampDuty", label: "Value", render: (r) => formatCurrency(r.calculatedStampDuty) },
          ]}
        />
        <RecentActivityTable
          title="Recent orders (all organizations)"
          loading={activityLoading}
          error={activityErr}
          rows={activity?.orders}
          rowLinkPrefix="/orders"
          columns={[
            { key: "orderNumber", label: "Order #" },
            { key: "organizationName", label: "Organization", render: (r) => r.organizationName || "-" },
            { key: "eStampStatus", label: "Status" },
            { key: "amount", label: "Amount", render: (r) => formatCurrency(r.amount) },
          ]}
        />
      </div>
    </div>
  );
}
