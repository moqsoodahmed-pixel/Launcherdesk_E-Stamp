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

// Phase 21 - Super Admin's dashboard: an organization-scoped version of the
// same KPI/chart/attention/recent-activity composition Master Admin gets.
// Every fetch is automatically tenant-scoped server-side (report.controller.js's
// resolveScope forces a tenant actor to req.user.organizationId, never
// trusting a client-supplied organizationId) - no org selector needed here.
export default function SuperAdminDashboard() {
  const { user } = useAuth();
  const canFinancial = hasPermission(user, PERMISSIONS.REPORT_FINANCIAL_VIEW);

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

  const loadSummary = useCallback(() => {
    setSummaryLoading(true);
    apiClient
      .get("/reports/dashboard")
      .then((r) => setSummary(r.data.data))
      .catch((err) => setSummaryErr(errorMessage(err, "Failed to load summary.")))
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

  useEffect(() => {
    loadSummary();
    loadActivity();
  }, [loadSummary, loadActivity]);
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
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 mb-1">Welcome back, {user?.name}</h1>
        <p className="text-sm text-slate-500">Organization overview</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <QuickActionButton to="/estamps/requests/new" label="New E-Stamp Request" icon="✍️" />
        <QuickActionButton to="/estamps/bulk" label="Bulk Request" icon="📚" />
        <QuickActionButton to="/users?role=USER" label="Manage Users" icon="👥" />
        <QuickActionButton to="/reports" label="Full Reports" icon="📊" />
      </div>

      {summaryErr && <div className="rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">{summaryErr}</div>}
      {summaryLoading && <KpiSkeleton count={5} />}
      {!summaryLoading && summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <KpiCard label="Total requests" value={summary.requests.total} />
          <KpiCard label="Total orders" value={summary.orders.total} />
          <KpiCard label="Issued orders" value={summary.orders.issued} />
          <KpiCard label="Failed orders" value={summary.orders.failed} />
          {canFinancial && summary.financial && (
            <KpiCard
              label="Available balance"
              value={summary.financial.currentWalletBalance === null ? "N/A" : formatCurrency(summary.financial.currentWalletBalance)}
            />
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

        <ChartCard title="Order status" loading={summaryLoading} error={summaryErr} empty={!summary || summary.orders.total === 0} emptyText="No orders yet.">
          <ResponsiveContainer width="100%" height={220}>
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
      </div>

      {canFinancial && (
        <ChartCard
          title="Payment activity"
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
            { key: "eStampStatus", label: "Status" },
            { key: "amount", label: "Amount", render: (r) => formatCurrency(r.amount) },
          ]}
        />
      </div>
    </div>
  );
}
