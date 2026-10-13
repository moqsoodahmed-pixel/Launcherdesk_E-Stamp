import { FilePlus2, Files, Users, BarChart3, FileText, Package, BadgeCheck, XCircle, Timer, Hourglass, Wallet, BadgeIndianRupee, Clock } from "lucide-react";
import DashboardHeader, { inWindowCount } from "../../components/dashboard/DashboardHeader";
import StatusBadge from "../../components/estamps/StatusBadge";
import Tabs from "../../components/ui/Tabs";
import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { apiClient } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { PERMISSIONS, hasPermission } from "../../utils/permissions";
import { formatCurrency, errorMessage } from "../../utils/format";
import KpiCard from "../../components/dashboard/KpiCard";
import ClientBalanceCard from "../../components/dashboard/ClientBalanceCard";
import { KpiSkeleton } from "../../components/dashboard/LoadingSkeleton";
import ChartCard from "../../components/dashboard/ChartCard";
import DateRangeFilter from "../../components/dashboard/DateRangeFilter";
import RecentActivityTable from "../../components/dashboard/RecentActivityTable";
import AttentionPanel from "../../components/dashboard/AttentionPanel";
import ErrorState from "../../components/common/ErrorState";
import QuickActionButton from "../../components/dashboard/QuickActionButton";
import EStampWorkspace from "../../components/dashboard/EStampWorkspace";
import { LineChart, Line, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { CHART_COLORS, STATUS_COLORS, gridProps, axisProps, yAxisProps, tooltipProps, barProps, lineProps } from "../../components/dashboard/chartTheme";

// Phase 21 - Super Admin's dashboard: an organization-scoped version of the
// same KPI/chart/attention/recent-activity composition Master Admin gets.
// Every fetch is automatically tenant-scoped server-side (report.controller.js's
// resolveScope forces a tenant actor to req.user.organizationId, never
// trusting a client-supplied organizationId) - no org selector needed here.
// Bar colours follow the status they show (issued, being prepared, failed).
const ORDER_STATUS_FILLS = [STATUS_COLORS.issued, STATUS_COLORS.preparing, STATUS_COLORS.failed];

export default function SuperAdminDashboard() {
  const { user } = useAuth();
  const canFinancial = hasPermission(user, PERMISSIONS.REPORT_FINANCIAL_VIEW);

  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get("tab") === "estamp" ? "estamp" : "overview";
  const [activeTab, setActiveTab] = useState(initialTab);

  useEffect(() => {
    const tabParam = searchParams.get("tab");
    if (tabParam === "estamp" && activeTab !== "estamp") {
      setActiveTab("estamp");
    }
  }, [searchParams, activeTab]);

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
    setSummaryErr(null);
    apiClient
      .get("/reports/dashboard")
      .then((r) => setSummary(r.data.data))
      .catch((err) => setSummaryErr(errorMessage(err, "Failed to load summary.")))
      .finally(() => setSummaryLoading(false));
  }, []);

  const loadRequests = useCallback(() => {
    setRequestsLoading(true);
    setRequestsErr(null);
    apiClient
      .get("/reports/requests", { params: { preset } })
      .then((r) => setRequests(r.data.data))
      .catch((err) => setRequestsErr(errorMessage(err, "Failed to load request analytics.")))
      .finally(() => setRequestsLoading(false));
  }, [preset]);

  const loadFinancial = useCallback(() => {
    if (!canFinancial) return;
    setFinancialLoading(true);
    setFinancialErr(null);
    apiClient
      .get("/reports/financial", { params: { preset } })
      .then((r) => setFinancial(r.data.data))
      .catch((err) => setFinancialErr(errorMessage(err, "Failed to load financial data.")))
      .finally(() => setFinancialLoading(false));
  }, [preset, canFinancial]);

  const loadActivity = useCallback(() => {
    setActivityLoading(true);
    setActivityErr(null);
    apiClient
      .get("/reports/recent-activity", { params: { limit: 5 } })
      .then((r) => setActivity(r.data.data))
      .catch((err) => setActivityErr(errorMessage(err, "Failed to load recent activity.")))
      .finally(() => setActivityLoading(false));
  }, []);

  useEffect(() => {
    loadSummary();
    loadActivity();
    const handleSync = () => {
      loadSummary();
      loadFinancial();
      loadActivity();
    };
    window.addEventListener("ld:payment_success", handleSync);
    return () => window.removeEventListener("ld:payment_success", handleSync);
  }, [loadSummary, loadActivity, loadFinancial]);
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
      <DashboardHeader
        name={user?.name}
        subtitle="Organization overview"
        actions={
          <>
            {hasPermission(user, PERMISSIONS.ESTAMP_CREATE) && <QuickActionButton to="/estamps/requests/new" label="New E-Stamp Request" icon={FilePlus2} primary />}
            {hasPermission(user, PERMISSIONS.ESTAMP_BULK_CREATE) && <QuickActionButton to="/estamps/bulk" label="Bulk Request" icon={Files} />}
            {hasPermission(user, PERMISSIONS.USER_VIEW) && <QuickActionButton to="/users?role=USER" label="Manage Users" icon={Users} />}
            {hasPermission(user, PERMISSIONS.REPORT_VIEW) && <QuickActionButton to="/reports" label="Full Reports" icon={BarChart3} />}
          </>
        }
      />

      <Tabs
        label="Dashboard view"
        value={activeTab}
        onChange={(id) => {
          setActiveTab(id);
          setSearchParams(id === "estamp" ? { tab: "estamp" } : {});
        }}
        tabs={[
          { id: "overview", label: "Dashboard Overview" },
          { id: "estamp", label: "E-Stamp Workspace" },
        ]}
      />

      {activeTab === "estamp" ? (
        <EStampWorkspace
          user={user}
          onStateChanged={() => {
            loadSummary();
            loadFinancial();
            loadActivity();
          }}
        />
      ) : (
        <>
          {hasPermission(user, PERMISSIONS.WALLET_VIEW) && <ClientBalanceCard canAddMoney={hasPermission(user, PERMISSIONS.PAYMENT_MANAGE)} showLedgerLink={hasPermission(user, PERMISSIONS.WALLET_VIEW)} />}

          {summaryErr && <ErrorState message={summaryErr} onRetry={loadSummary} />}
          {summaryLoading && <KpiSkeleton count={5} />}
          {!summaryLoading && summary && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard label="In the 20-minute window" value={inWindowCount(summary)} icon={Timer} tone="blue" />
              <KpiCard label="Being prepared" value={summary.orders.processing} icon={Hourglass} tone="violet" />
              {summary.orders.issuedThisMonth !== undefined && <KpiCard label="Issued this month" value={summary.orders.issuedThisMonth} icon={BadgeCheck} tone="emerald" />}
              {summary.payments && <KpiCard label="Awaiting balance update" value={summary.payments.awaitingBalanceUpdate} icon={Clock} tone="marigold" />}
              <KpiCard label="Issued orders" value={summary.orders.issued} icon={BadgeCheck} tone="emerald" />
              <KpiCard label="Failed orders" value={summary.orders.failed} icon={XCircle} tone="vermilion" />
              <KpiCard label="Total requests" value={summary.requests.total} icon={FileText} tone="grey" />
              <KpiCard label="Total orders" value={summary.orders.total} icon={Package} tone="grey" />
              {canFinancial && summary.financial && (
                <KpiCard
                  icon={Wallet}
                  tone="teal"
                  label="Ledger balance"
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
              error={requestsErr} onRetry={loadRequests}
              empty={!requests?.dailyTrend?.length}
              emptyText="No requests in this range."
            >
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={requests?.dailyTrend || []}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="date" {...axisProps} />
                  <YAxis allowDecimals={false} {...yAxisProps} />
                  <Tooltip {...tooltipProps} />
                  <Line {...lineProps} dataKey="count" name="Requests" stroke={CHART_COLORS[0]} />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Order status" loading={summaryLoading} error={summaryErr} onRetry={loadSummary} empty={!summary || summary.orders.total === 0} emptyText="No orders yet.">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart
                  data={
                    summary
                      ? [
                          { status: "Issued", count: summary.orders.issued },
                          { status: "Being prepared", count: summary.orders.processing },
                          { status: "Failed", count: summary.orders.failed },
                        ]
                      : []
                  }
                >
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="status" {...axisProps} />
                  <YAxis allowDecimals={false} {...yAxisProps} />
                  <Tooltip {...tooltipProps} />
                  <Bar dataKey="count" name="Orders" {...barProps}>
                    {ORDER_STATUS_FILLS.map((fill) => (
                      <Cell key={fill} fill={fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {canFinancial && (
            <ChartCard
              title="Payment activity"
              loading={financialLoading}
              error={financialErr} onRetry={loadFinancial}
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
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="label" {...axisProps} />
                  <YAxis {...yAxisProps} width={72} tickFormatter={(v) => formatCurrency(v)} />
                  <Tooltip {...tooltipProps} formatter={(v) => formatCurrency(v)} />
                  <Bar dataKey="amount" name="Amount" {...barProps}>
                    <Cell fill={STATUS_COLORS.issued} />
                    <Cell fill={STATUS_COLORS.failed} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          )}

          <AttentionPanel alerts={alerts} loading={summaryLoading} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <RecentActivityTable
              title="Recent requests"
              loading={activityLoading}
              error={activityErr} onRetry={loadActivity}
              rows={activity?.requests}
              rowLinkPrefix="/estamps/requests"
              columns={[
                { key: "requestNumber", label: "Request #", render: (r) => <span className="font-medium text-slate-900">{r.requestNumber}</span> },
                { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} remainingSeconds={typeof r.windowRemainingSeconds === "number" ? r.windowRemainingSeconds : undefined} deadline={r.windowExpiresAt || r.modificationDeadline} /> },
                { key: "calculatedStampDuty", label: "Value", render: (r) => <span className="tabular-nums">{formatCurrency(r.calculatedStampDuty)}</span> },
              ]}
            />
            <RecentActivityTable
              title="Recent orders"
              loading={activityLoading}
              error={activityErr} onRetry={loadActivity}
              rows={activity?.orders}
              rowLinkPrefix="/orders"
              columns={[
                { key: "orderNumber", label: "Order #", render: (r) => <span className="font-medium text-slate-900">{r.orderNumber}</span> },
                { key: "eStampStatus", label: "Status", render: (r) => <StatusBadge status={r.eStampStatus} /> },
                { key: "amount", label: "Amount", render: (r) => <span className="tabular-nums">{formatCurrency(r.amount)}</span> },
              ]}
            />
          </div>
        </>
      )}
    </div>
  );
}
